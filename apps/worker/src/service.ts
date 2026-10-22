import { randomUUID } from 'node:crypto';
import { config, defaultTradingConfiguration, logger, sessionPhase, type TradingConfiguration } from '@bolinha/core';
import { evaluateCandlesEntryConfluence, makeSnapshot } from '@bolinha/market-data';
import { OpenRouterClient, buildB3Prompt } from '@bolinha/ai';
import { applyB3Risk } from '@bolinha/risk-engine';
import { createBrokerGateway, type BrokerGateway, type ExchangeOrder } from '@bolinha/exchange';
import { executionAccounting } from '@bolinha/database';
import { TradingRepository } from '@bolinha/database';

type Severity = 'INFO' | 'WARN' | 'ERROR';

export class TradingService {
  constructor(
    private repo = new TradingRepository(),
    private exchange: BrokerGateway = createBrokerGateway(config.SYMBOL),
    private ai = new OpenRouterClient(
      config.OPENROUTER_API_KEY,
      config.OPENROUTER_MODELS.split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      undefined,
      config.OPENROUTER_TIMEOUT_MS,
    ),
    private positionHighWatermark = new Map<string, number>(),
    /** Signature (price@time) of the last persisted dashboard point, to avoid duplicates. */
    private lastAccountSnapshot: string | null = null,
  ) {}

  private async event(severity: Severity, type: string, message: string, metadata?: unknown) {
    await this.repo.event(severity, type, message, metadata);
    logger.info({ event: type, severity, metadata }, message);
  }

  private async operationalConfiguration(): Promise<TradingConfiguration> {
    const configurable = this.repo as TradingRepository & { configuration?: () => Promise<TradingConfiguration> };
    return configurable.configuration ? configurable.configuration() : { ...defaultTradingConfiguration };
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T | { action: 'HOLD'; reason: string }> {
    const lockable = this.repo as TradingRepository & { withTradingLock?: <V>(fn: () => Promise<V>) => Promise<V | null> };
    if (!lockable.withTradingLock) return work(); // Small test doubles intentionally do not need PostgreSQL.
    const result = await lockable.withTradingLock(work);
    if (result !== null) return result;
    await this.event('INFO', 'cycle_skipped', 'Trading cycle skipped because another worker owns the database lock');
    return { action: 'HOLD', reason: 'Another worker is executing a cycle' };
  }

  /**
   * The persisted flag is deliberately checked before every cycle.  A worker
   * restart is not the only way another process can leave an ambiguous order.
   */
  private async tradingReady(): Promise<{ ready: true } | { ready: false; reason: string }> {
    const reconciliationRepo = this.repo as TradingRepository & {
      reconciliationState?: () => Promise<{ status: 'OK' | 'RUNNING' | 'ERROR'; stateConsistent: boolean; lastError: string | null }>;
      pendingOrderCount?: () => Promise<number>;
    };
    // Unit-test repositories do not implement the operational state table.
    if (!reconciliationRepo.reconciliationState || !reconciliationRepo.pendingOrderCount) return { ready: true };
    const [state, pending] = await Promise.all([
      reconciliationRepo.reconciliationState(),
      reconciliationRepo.pendingOrderCount(),
    ]);
    if (state.status !== 'OK' || !state.stateConsistent || pending > 0)
      return {
        ready: false,
        reason: state.lastError ?? (pending > 0 ? `${pending} pending order(s) require reconciliation` : `Reconciliation is ${state.status}`),
      };
    return { ready: true };
  }

  /**
   * BUG-10 parte C: every executed order must produce a new dashboard point.
   * A force close (or any sale) that happens after the last decision cycle used
   * to leave the panel showing a phantom position/cash. A snapshot failure is
   * reported as an event but never discards an execution already committed to
   * the ledger, and a missing price is never replaced by a made-up value.
   */
  private async snapshotAfterExecution(price: number, at: Date) {
    const dashboardRepo = this.repo as TradingRepository & {
      saveAccountSnapshot?: (price: number, at: Date) => Promise<void>;
    };
    // Lightweight unit-test doubles intentionally omit the dashboard writer.
    if (!dashboardRepo.saveAccountSnapshot) return;
    if (!Number.isFinite(price) || price <= 0) {
      logger.warn({ price }, 'Account snapshot skipped after execution: no trustworthy price');
      return;
    }
    // The force close is funnelled through persistExecution and then writes an
    // explicit close-of-day point; the second call for the very same execution
    // is redundant, so it is skipped. Recorded only after success, so a failed
    // write is still retried by the next call site.
    const signature = `${price}@${at.getTime()}`;
    if (this.lastAccountSnapshot === signature) return;
    try {
      await dashboardRepo.saveAccountSnapshot(price, at);
      this.lastAccountSnapshot = signature;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown account snapshot error';
      try {
        await this.event('ERROR', 'account_snapshot_failed', 'Account snapshot after execution could not be persisted', {
          error: message,
          price,
        });
      } catch (eventError) {
        logger.error({ err: eventError }, 'Could not persist account_snapshot_failed event');
      }
    }
  }

  private async persistExecution(
    local: { id: number; clientOrderId: string },
    order: Pick<ExchangeOrder, 'orderId' | 'side' | 'executedQty' | 'cummulativeQuoteQty' | 'commission' | 'transactTime'> & { fills?: ExchangeOrder['fills'] },
    eventType: 'normal' | 'reconciliation' = 'normal',
  ) {
    const outcome = await this.repo.recordExecution({
      id: local.id,
      brokerOrderId: order.orderId,
      side: order.side,
      quantity: order.executedQty,
      quote: order.cummulativeQuoteQty,
      commission: order.commission,
      fills: order.fills,
      at: order.transactTime,
    });
    // Older lightweight test doubles return void; production repository always
    // returns the explicit idempotency outcome.
    const applied = outcome?.applied ?? true;
    await this.event('INFO', 'order_executed', 'Testnet order executed', {
      side: order.side,
      orderId: order.orderId,
      clientOrderId: local.clientOrderId,
      quantity: order.executedQty,
      quoteAmount: order.cummulativeQuoteQty,
      feesByAsset: executionAccounting(order.side, order.executedQty, order.cummulativeQuoteQty, order.fills ?? []).byAsset,
      alreadyReconciled: !applied,
      source: eventType,
    });
    if (applied)
      await this.event(
        'INFO',
        order.side === 'BUY' ? 'position_opened' : 'position_closed',
        'Conceptual position updated',
        { side: order.side, quantity: order.executedQty, netPositionQuantity: executionAccounting(order.side, order.executedQty, order.cummulativeQuoteQty, order.fills ?? []).positionQuantity, quoteAmount: order.cummulativeQuoteQty, source: eventType },
      );
    // The panel reads cash/position/unrealized from PostgreSQL for the current
    // day, but the time series still needs a point per executed order so a
    // closing sale is visible even when no further decision cycle happens.
    const executionPrice = order.executedQty > 0 ? order.cummulativeQuoteQty / order.executedQty : 0;
    await this.snapshotAfterExecution(executionPrice, order.transactTime);
    return outcome;
  }

  /** Rebuild the conceptual ledger from known application orders only. */
  async reconcileStateOnStartup() {
    return this.exclusive(() => this.reconcileStateLocked('startup'));
  }

  /** Attempt operational reconciliation when blocked by pending orders or after errors. */
  async reconcileOperationalState() {
    return this.exclusive(() => this.reconcileStateLocked('runtime'));
  }

  private async reconcileStateLocked(context: 'startup' | 'runtime' = 'startup') {
    const reconciliationRepo = this.repo as TradingRepository & {
      pendingOrders?: () => Promise<Array<{ id: number; clientOrderId: string; side: 'BUY' | 'SELL'; requestedQuantity: number | null }>>;
      reconciliationStarted?: () => Promise<void>;
      reconciliationCompleted?: () => Promise<void>;
      reconciliationFailed?: (error: string) => Promise<void>;
      stateConsistency?: () => Promise<{ consistent: boolean; reason: string | null }>;
    };
    // Keeps small unit-test doubles backwards compatible; real workers always
    // have all of these methods and therefore fail closed.
    if (!reconciliationRepo.pendingOrders || !reconciliationRepo.reconciliationStarted || !reconciliationRepo.reconciliationCompleted || !reconciliationRepo.reconciliationFailed || !reconciliationRepo.stateConsistency)
      return { status: 'OK' as const, pendingOrders: 0 };

    await this.repo.ensureAccount((await this.operationalConfiguration()).initialBankUsdt);
    const metricsRepo = this.repo as TradingRepository & { recordReconciliationRun?: () => Promise<void> };
    await metricsRepo.recordReconciliationRun?.();
    await reconciliationRepo.reconciliationStarted();
    try {
      await this.event('INFO', 'reconciliation_started', `${context === 'startup' ? 'Startup' : 'Runtime'} reconciliation started`);
      // These reads intentionally happen before handling orders: PostgreSQL is
      // the conceptual source of truth; broker balances are never inspected.
      await Promise.all([this.repo.account(), this.repo.openPosition()]);
      const pendingOrders = await reconciliationRepo.pendingOrders();
      for (const pending of pendingOrders) {
        let remote;
        try {
          remote = await this.exchange.orderByClientId(pending.clientOrderId);
        } catch (error) {
          throw new Error(`broker unavailable while reconciling ${pending.clientOrderId}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        if (!remote) {
          await this.repo.markOrderRejected(pending.id, `broker confirmed no order exists for clientOrderId during ${context} reconciliation`);
          await this.event('INFO', 'pending_order_reconciled', 'Pending order rejected after broker confirmed it does not exist', {
            clientOrderId: pending.clientOrderId,
            outcome: 'REJECTED',
            context,
          });
          continue;
        }
        if (remote.status !== 'FILLED') {
          const reason = `broker order ${pending.clientOrderId} is still ${remote.status}`;
          await this.event('ERROR', 'state_inconsistency_detected', 'Pending order remains ambiguous on broker', {
            clientOrderId: pending.clientOrderId,
            status: remote.status,
          });
          throw new Error(reason);
        }
        const reconciledQuantity = remote.side === 'SELL'
          ? executionAccounting(remote.side, remote.executedQty, remote.cummulativeQuoteQty, remote.fills ?? []).positionQuantity
          : remote.executedQty;
        if (remote.side !== pending.side || (pending.requestedQuantity !== null && Math.abs(reconciledQuantity - pending.requestedQuantity) > 1e-12)) {
          const reason = `broker execution for ${pending.clientOrderId} does not match the local pending order`;
          await this.event('ERROR', 'state_inconsistency_detected', reason, { clientOrderId: pending.clientOrderId });
          throw new Error(reason);
        }
        const result = await this.persistExecution(pending, remote, 'reconciliation');
        await this.event('INFO', 'pending_order_reconciled', 'Pending order reconciled from broker execution', {
          clientOrderId: pending.clientOrderId,
          outcome: result.applied ? 'FILLED' : 'ALREADY_RECONCILED',
          context,
        });
      }
      const consistency = await reconciliationRepo.stateConsistency();
      if (!consistency.consistent) {
        await this.event('ERROR', 'state_inconsistency_detected', 'Ledger consistency check failed after reconciliation', { reason: consistency.reason });
        throw new Error(consistency.reason ?? 'Ledger consistency check failed');
      }
      await reconciliationRepo.reconciliationCompleted();
      await this.event('INFO', 'reconciliation_completed', `${context === 'startup' ? 'Startup' : 'Runtime'} reconciliation completed`, { pendingOrderCount: 0 });
      return { status: 'OK' as const, pendingOrders: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
      await reconciliationRepo.reconciliationFailed(message);
      await this.event('ERROR', 'reconciliation_failed', `${context === 'startup' ? 'Startup' : 'Runtime'} reconciliation failed; trading remains blocked`, { error: message });
      throw error;
    }
  }

  private async submitAndPersistOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    amountUsdt: number,
    minPrice?: number,
  ) {
    const pendingRepository = this.repo as TradingRepository & {
      pendingOrderDetails?: () => Promise<{
        id: number;
        clientOrderId: string;
        side: 'BUY' | 'SELL';
        requestedAmount: number;
        requestedQuantity: number | null;
      } | null>;
    };
    const pending = pendingRepository.pendingOrderDetails ? await pendingRepository.pendingOrderDetails() : null;
    if (pending && pending.side !== side)
      throw new Error(`Cannot submit ${side} while pending ${pending.side} order ${pending.clientOrderId} is unresolved`);
    if (pending && pending.requestedQuantity !== null && Math.abs(pending.requestedQuantity - quantity) > 1e-12)
      throw new Error('Pending order quantity differs from the full conceptual position');
    const clientOrderId = pending?.clientOrderId ?? randomUUID();
    const orderId = pending?.id ?? await this.repo.createPendingOrder(clientOrderId, side, amountUsdt, quantity);
    if (!pending)
      await this.event('INFO', 'order_submitted', 'Testnet market order submitted', {
        clientOrderId,
        side,
        quantity,
        amountUsdt,
      });
    let order;
    try {
      order = pending ? await this.exchange.orderByClientId(clientOrderId) : null;
      if (!order) {
        if (pending)
          await this.event('WARN', 'pending_order_retry', 'Retrying unresolved Testnet order with the same client order id', {
            clientOrderId,
            side,
            quantity,
          });
        order = await this.exchange.placeMarketOrder(side, quantity, clientOrderId, minPrice);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown order submission error';
      try {
        order = await this.exchange.orderByClientId(clientOrderId);
      } catch (checkError) {
        // Se a consulta à broker também falhar (ex: rede fora), mantemos order como undefined/null
        // para falhar fechado (fail-closed) sem descartar uma possível ordem executada.
        const checkMessage = checkError instanceof Error ? checkError.message : 'Unknown order check error';
        await this.event('ERROR', 'external_service_error', 'Failed to query broker for order status after submission error', {
          service: 'broker',
          clientOrderId,
          submissionError: message,
          checkError: checkMessage,
        });
      }
      if (!order) {
        await this.event('ERROR', 'external_service_error', 'Testnet order could not be verified', {
          service: 'broker',
          clientOrderId,
          error: message,
        });
        // Se a consulta orderByClientId retornou null comprovando que a broker NÃO possui a ordem
        // (por rejeição HTTP 400 ou porque a falha de rede impediu a ordem de ser criada),
        // marcamos como REJECTED para desobstruir os ciclos futuros.
        await this.repo.markOrderRejected(orderId, `Order submission failed and broker confirmed order does not exist: ${message}`);
        await this.event('WARN', 'pending_order_reconciled', 'Pending order marked as rejected after broker confirmed no order exists', {
          clientOrderId,
          outcome: 'REJECTED',
          reason: message,
        });
        throw error;
      }
    }
    const fulfilledQuantity = order.side === 'SELL'
      ? executionAccounting(order.side, order.executedQty, order.cummulativeQuoteQty, order.fills ?? []).positionQuantity
      : order.executedQty;
    if (order.status !== 'FILLED' || order.side !== side || Math.abs(fulfilledQuantity - quantity) > 1e-12)
      throw new Error('Refusing to persist an execution that does not fully match the requested quantity');
    await this.persistExecution({ id: orderId, clientOrderId }, order);
    return order;
  }

  async runOnce(at = new Date(), configuration?: TradingConfiguration) {
    const effective = configuration ?? await this.operationalConfiguration();
    return this.exclusive(() => this.runOnceLocked(at, effective));
  }

  private async runOnceLocked(at: Date, configuration: TradingConfiguration) {
    await this.repo.ensureAccount(configuration.initialBankUsdt);
    await this.repo.heartbeat();
    let ready = await this.tradingReady();
    if (!ready.ready) {
      const blockedReason = ready.reason;
      // Se houver ordens pendentes bloqueando o ciclo, tenta auto-recuperação/reconciliação imediata com a exchange
      try {
        await this.reconcileStateLocked('runtime');
        ready = await this.tradingReady();
      } catch (reconcileError) {
        // Se a reconciliação falhar (ex: rede fora), mantém o log e bloqueio seguro fail-closed
        const recMsg = reconcileError instanceof Error ? reconcileError.message : 'Unknown reconciliation error';
        await this.event('WARN', 'cycle_skipped', 'Trading cycle blocked pending reconciliation; runtime reconciliation attempt failed', {
          reason: blockedReason,
          reconcileError: recMsg,
        });
        return { action: 'HOLD' as const, reason: blockedReason };
      }
    }
    if (!ready.ready) {
      await this.event('WARN', 'cycle_skipped', 'Trading cycle blocked pending reconciliation', { reason: ready.reason });
      return { action: 'HOLD' as const, reason: ready.reason };
    }
    const hasPosition = Boolean(await this.repo.openPosition());
    const phase = sessionPhase(at, configuration, hasPosition);
    if (phase === 'BEFORE_START' || phase === 'FINISHED') {
      await this.event('INFO', 'cycle_skipped', 'Trading cycle skipped outside the daily session', { phase });
      return { action: 'HOLD' as const, reason: `Session phase is ${phase}` };
    }
    if (phase === 'NO_NEW_POSITIONS' && !hasPosition) {
      await this.event('INFO', 'cycle_skipped', 'Trading cycle skipped during no-new-positions window without an open position', { phase });
      return { action: 'HOLD' as const, reason: `Session phase is ${phase} and there is no open position` };
    }
    if (phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING') return this.forceClosePositionLocked(configuration);
    await this.event('INFO', 'cycle_started', 'Trading cycle started', { symbol: config.SYMBOL });
    try {
      let market;
      try {
        market = await Promise.all([
          this.exchange.candles('1m'),
          this.exchange.candles('5m'),
          this.exchange.candles('15m'),
          this.repo.account(),
          this.repo.openPosition(),
          this.exchange.rules(),
          this.repo.pendingOrder(),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown market or database error';
        await this.event(
          'ERROR',
          'external_service_error',
          'Could not retrieve market data or exchange rules',
          { service: 'broker', error: message },
        );
        throw error;
      }
      const [one, five, fifteen, account, position, rules, pending] = market;

      // Filtro de entrada multi-timeframe (fail-closed): candle insuficiente,
      // série ausente, indicador NaN ou falta de confluência 1m/5m/15m => BUY vira HOLD.
      const entryConfluence = config.ENTRY_FILTER_ENABLED
        ? evaluateCandlesEntryConfluence(
            { '1m': one, '5m': five, '15m': fifteen },
            {
              timeframes: config.ENTRY_TIMEFRAMES,
              minConfluentTimeframes: config.ENTRY_MIN_CONFLUENT_TIMEFRAMES,
              rsiOverboughtThreshold: config.ENTRY_RSI_OVERBOUGHT,
            },
          )
        : null;

      let snapshot;
      try {
        snapshot = makeSnapshot(config.SYMBOL, { '1m': one, '5m': five, '15m': fifteen });
      } catch (error) {
        // Sem indicadores válidos não existe decisão confiável: HOLD observável, nunca BUY.
        const message = error instanceof Error ? error.message : 'Invalid market data';
        await this.event('WARN', 'cycle_skipped', 'Trading cycle held because market data is insufficient', {
          reason: message,
          entryConfluence: entryConfluence?.reason ?? null,
        });
        return { action: 'HOLD' as const, reason: `Insufficient market data: ${message}` };
      }
      const snapshotId = await this.repo.saveSnapshot(snapshot);
      // One compact point per cycle keeps dashboard charts historical without
      // making the browser poll broker or the database directly.
      const dashboardRepo = this.repo as TradingRepository & { saveAccountSnapshot?: (price: number, at: Date) => Promise<void> };
      if (dashboardRepo.saveAccountSnapshot)
        await dashboardRepo.saveAccountSnapshot(snapshot.intervals['1m'].price, at);
      const currentPrice = snapshot.intervals['1m'].price;
      const b3Account = { initialBankBrl: account.initialBankUsdt, cashBrl: account.cashUsdt, realizedPnlBrl: account.realizedPnlUsdt };
      const symbol = config.SYMBOL.toUpperCase();
      let highest = this.positionHighWatermark.get(symbol);
      if (position) {
        highest = Math.max(highest ?? position.entryPrice, currentPrice);
        this.positionHighWatermark.set(symbol, highest);
      } else {
        this.positionHighWatermark.delete(symbol);
      }

      const b3Position = position
        ? {
            ticker: config.SYMBOL,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            costBrl: position.costUsdt,
            highestPrice: highest,
          }
        : null;

      const response = await this.ai.decide(
        buildB3Prompt(snapshot, b3Account, b3Position, currentPrice, config.STOP_LOSS_PCT),
      );
      if (response.usage.fallbackUsed)
        await this.event('WARN', 'ai_fallback', 'OpenRouter fallback model was used', {
          model: response.usage.modelRequested,
          reason: response.usage.fallbackReason ?? 'Previous model failed',
        });
      if (response.usage.error)
        await this.event('ERROR', 'ai_error', 'OpenRouter did not return a usable decision', {
          error: response.usage.error,
        });

      const b3Res = applyB3Risk({
        action: response.decision.action,
        requestedBrl: response.decision.amountUsdt,
        price: currentPrice,
        account: b3Account,
        position: b3Position,
        rules,
        maxPositionPercent: configuration.maxPositionPercent,
        duplicateOrderPending: pending,
        isDayTradeCloseOnly: phase === 'NO_NEW_POSITIONS',
        maxStopLossPct: config.MAX_STOP_LOSS_PCT, // Proteção rígida intradiária calibrada
        breakevenTriggerPct: 0.008, // Ativa breakeven ao atingir +0.8%
        trailingStopPct: 0.006, // Trailing stop de 0.6% a partir do topo
        sellNoiseBandPct: 0.004, // SELL discricionário com |PnL| < 0.4% é ruído (atrito de slippage + taxas)
        entryConfluence,
      });
      let risk = { action: b3Res.action, amountUsdt: b3Res.amountBrl, quantity: b3Res.quantity, rejectionReason: b3Res.rejectionReason };
      if (response.decision.action === 'BUY' && risk.action !== 'BUY' && risk.rejectionReason?.startsWith('BUY rejected by multi-timeframe entry filter')) {
        await this.event('WARN', 'entry_confluence_blocked_buy', 'BUY downgraded to HOLD by the multi-timeframe entry confluence filter', {
          reason: risk.rejectionReason,
          requiredCount: entryConfluence?.requiredCount ?? null,
          confluentCount: entryConfluence?.confluentCount ?? null,
          confluentTimeframes: entryConfluence?.confluentTimeframes ?? [],
          checks: entryConfluence?.checks ?? [],
        });
      }
      if (phase === 'NO_NEW_POSITIONS' && risk.action === 'BUY') {
        risk = { action: 'HOLD', amountUsdt: 0, quantity: 0, rejectionReason: 'New positions are blocked for today' };
        await this.event('WARN', 'new_positions_blocked', 'BUY blocked during no-new-positions window', {
          phase,
          requestedAction: response.decision.action,
        });
      }
      // The cycle may have started seconds before the cutoff and spent enough
      // time fetching market data or asking the model to cross it. Re-read the
      // clock immediately before the order path; the phase captured above is
      // intentionally not trusted for a new position.
      if (risk.action === 'BUY' && sessionPhase(new Date(), configuration) !== 'TRADING') {
        risk = { action: 'HOLD', amountUsdt: 0, quantity: 0, rejectionReason: 'New positions are blocked for today' };
        await this.event('WARN', 'new_positions_blocked', 'BUY blocked after revalidating the cutoff before submission', {
          phaseAtSubmission: sessionPhase(new Date(), configuration),
          requestedAction: response.decision.action,
        });
      }

      let sellMinPrice: number | undefined;
      if (risk.action === 'SELL') {
        // Slippage Guard:
        // A decisão de venda da IA foi tomada baseada no snapshot de 1m (currentPrice).
        // Não permitir execução em patamar desfavorável em relação ao snapshot (tolerância de até 1%).
        const maxAdverseSlippagePct = 0.01;
        let minAcceptable = Number((currentPrice * (1 - maxAdverseSlippagePct)).toFixed(2));

        // Se a posição estava em lucro no snapshot (currentPrice > entryPrice),
        // proteger contra reversão em prejuízo inesperado por gap de execução.
        if (b3Position && currentPrice > b3Position.entryPrice) {
          const breakEvenPrice = Number((b3Position.entryPrice * 1.0006).toFixed(2));
          minAcceptable = Math.max(minAcceptable, Math.min(Number((currentPrice * 0.995).toFixed(2)), breakEvenPrice));
        }

        sellMinPrice = minAcceptable;

        // Pré-validação com a cotação mais recente do broker
        const latestPrice = typeof this.exchange.price === 'function' ? await this.exchange.price() : currentPrice;
        if (latestPrice < minAcceptable) {
          const reason = `Slippage guard: market price R$ ${latestPrice.toFixed(2)} is below minimum acceptable R$ ${minAcceptable.toFixed(2)} (snapshot: R$ ${currentPrice.toFixed(2)})`;
          risk = { action: 'HOLD', amountUsdt: 0, quantity: 0, rejectionReason: reason };
          await this.event('WARN', 'decision_rejected_by_risk', 'SELL blocked by slippage guard to prevent unexpected loss', {
            brokerPrice: latestPrice,
            snapshotPrice: currentPrice,
            minAcceptablePrice: minAcceptable,
            entryPrice: b3Position?.entryPrice,
          });
        }
      }

      await this.repo.saveDecision(
        response.decision,
        response.usage,
        risk.action,
        risk.amountUsdt,
        risk.rejectionReason,
        snapshotId,
      );
      await this.event('INFO', 'decision_created', 'AI decision persisted', {
        requestedAction: response.decision.action,
        actionAfterRisk: risk.action,
        requestedAmountUsdt: response.decision.amountUsdt,
        amountAfterRiskUsdt: risk.amountUsdt,
        confidence: response.decision.confidence,
      });
      if (risk.rejectionReason && risk.rejectionReason !== 'AI requested HOLD')
        await this.event('WARN', 'decision_rejected_by_risk', 'Decision changed to HOLD by risk engine', {
          reason: risk.rejectionReason,
          requestedAction: response.decision.action,
        });
      if (risk.action === 'HOLD') {
        await this.event('INFO', 'cycle_completed', 'Trading cycle completed without an order', {
          action: 'HOLD',
          reason: risk.rejectionReason,
        });
        return { action: 'HOLD' as const, reason: risk.rejectionReason };
      }
      const order = await this.submitAndPersistOrder(risk.action, risk.quantity, risk.amountUsdt, sellMinPrice);
      await this.event('INFO', 'cycle_completed', 'Trading cycle completed with an order', {
        action: risk.action,
        orderId: order.orderId,
      });
      return { action: risk.action, orderId: order.orderId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown cycle error';
      try {
        await this.event('ERROR', 'unexpected_error', 'Trading cycle failed', { error: message });
      } catch (eventError) {
        logger.error({ err: eventError }, 'Could not persist unexpected_error event');
      }
      logger.error({ err: error, event: 'cycle_error' }, 'Trading cycle failed');
      throw error;
    }
  }

  async forceClosePosition(configuration?: TradingConfiguration) {
    const effective = configuration ?? await this.operationalConfiguration();
    return this.exclusive(() => this.forceClosePositionLocked(effective));
  }

  private async forceClosePositionLocked(configuration: TradingConfiguration) {
    await this.repo.ensureAccount(configuration.initialBankUsdt);
    let ready = await this.tradingReady();
    if (!ready.ready) {
      const blockedReason = ready.reason;
      try {
        await this.reconcileStateLocked('runtime');
        ready = await this.tradingReady();
      } catch (reconcileError) {
        const recMsg = reconcileError instanceof Error ? reconcileError.message : 'Unknown reconciliation error';
        await this.event('WARN', 'force_close_blocked', 'Forced close blocked pending reconciliation; runtime reconciliation attempt failed', {
          reason: blockedReason,
          reconcileError: recMsg,
        });
        return { action: 'HOLD' as const, reason: blockedReason };
      }
    }
    if (!ready.ready) {
      await this.event('WARN', 'force_close_blocked', 'Forced close blocked pending reconciliation', { reason: ready.reason });
      return { action: 'HOLD' as const, reason: ready.reason };
    }
    try {
    const position = await this.repo.openPosition();
    if (!position) {
      const onceRepo = this.repo as TradingRepository & {
        eventOnceForSession?: (level: string, event: string, message: string, at?: Date, payload?: unknown) => Promise<boolean>;
      };
      if (onceRepo.eventOnceForSession)
        await onceRepo.eventOnceForSession('INFO', 'force_close_noop', 'No conceptual position to close', new Date(), { action: 'HOLD' });
      else await this.event('INFO', 'force_close_noop', 'No conceptual position to close', { action: 'HOLD' });
      return { action: 'HOLD', reason: 'No open conceptual position' };
    }
    const metricsRepo = this.repo as TradingRepository & { recordForceCloseAttempt?: () => Promise<void> };
    await metricsRepo.recordForceCloseAttempt?.();
    await this.event('WARN', 'force_close_started', 'Forced close requested for an open conceptual position', { symbol: config.SYMBOL });
    const [account, rules, price] = await Promise.all([
      this.repo.account(),
      this.exchange.rules(),
      this.exchange.price(),
    ]);
    const pendingRepository = this.repo as TradingRepository & {
      pendingOrderDetails?: () => Promise<{ side: 'BUY' | 'SELL' } | null>;
    };
    const pending = pendingRepository.pendingOrderDetails ? await pendingRepository.pendingOrderDetails() : null;
    const closeRisk = applyB3Risk({
      action: 'SELL',
      requestedBrl: position.quantity * price,
      price,
      account: { initialBankBrl: account.initialBankUsdt, cashBrl: account.cashUsdt, realizedPnlBrl: account.realizedPnlUsdt },
      position: { ticker: config.SYMBOL, quantity: position.quantity, entryPrice: position.entryPrice, costBrl: position.costUsdt },
      rules,
      maxPositionPercent: configuration.maxPositionPercent,
      // A pending SELL is retried with its persisted client id below. A pending
      // BUY is never retried during the close-only window.
      duplicateOrderPending: pending ? pending.side !== 'SELL' : await this.repo.pendingOrder(),
    });
    const risk = { action: closeRisk.action, amountUsdt: closeRisk.amountBrl, quantity: closeRisk.quantity, rejectionReason: closeRisk.rejectionReason };
    if (risk.action === 'HOLD') {
      await this.event('WARN', 'decision_rejected_by_risk', 'Forced close rejected by risk engine', {
        reason: risk.rejectionReason,
      });
      return risk;
    }
    const order = await this.submitAndPersistOrder('SELL', risk.quantity, risk.amountUsdt);
    await this.event('WARN', 'force_close_completed', 'Forced close completed', { orderId: order.orderId });
    // Explicit close-of-day point: the force close happens in a close-only tick
    // that is followed by no further decision cycle, so this snapshot is what
    // makes the post-sale cash/zero-position state visible to the dashboard.
    const closePrice = order.executedQty > 0 ? order.cummulativeQuoteQty / order.executedQty : price;
    await this.snapshotAfterExecution(closePrice, order.transactTime);
    return { action: 'SELL', orderId: order.orderId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown force-close error';
      await this.event('ERROR', 'force_close_failed', 'Forced close failed and will be retried while the window is open', { error: message });
      throw error;
    }
  }
}
