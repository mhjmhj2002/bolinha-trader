import { randomUUID } from 'node:crypto';
import { config, logger, sessionPhase } from '@bolinha/core';
import { makeSnapshot } from '@bolinha/market-data';
import { OpenRouterClient, buildPrompt } from '@bolinha/ai';
import { applyRisk } from '@bolinha/risk-engine';
import { BinanceTestnetClient, type BinanceGateway, type ExchangeOrder } from '@bolinha/exchange';
import { executionAccounting } from '@bolinha/database';
import { TradingRepository } from '@bolinha/database';

type Severity = 'INFO' | 'WARN' | 'ERROR';

export class TradingService {
  constructor(
    private repo = new TradingRepository(),
    private exchange: BinanceGateway = new BinanceTestnetClient(
      config.BINANCE_API_KEY,
      config.BINANCE_API_SECRET,
      config.SYMBOL,
    ),
    private ai = new OpenRouterClient(
      config.OPENROUTER_API_KEY,
      config.OPENROUTER_MODELS.split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ) {}

  private async event(severity: Severity, type: string, message: string, metadata?: unknown) {
    await this.repo.event(severity, type, message, metadata);
    logger.info({ event: type, severity, metadata }, message);
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

  private async persistExecution(
    local: { id: number; clientOrderId: string },
    order: Pick<ExchangeOrder, 'orderId' | 'side' | 'executedQty' | 'cummulativeQuoteQty' | 'commission' | 'transactTime'> & { fills?: ExchangeOrder['fills'] },
    eventType: 'normal' | 'reconciliation' = 'normal',
  ) {
    const outcome = await this.repo.recordExecution({
      id: local.id,
      binanceOrderId: order.orderId,
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
    return outcome;
  }

  /** Rebuild the conceptual ledger from known application orders only. */
  async reconcileStateOnStartup() {
    return this.exclusive(() => this.reconcileStateOnStartupLocked());
  }

  private async reconcileStateOnStartupLocked() {
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

    await this.repo.ensureAccount(config.INITIAL_BANK_USDT);
    const metricsRepo = this.repo as TradingRepository & { recordReconciliationRun?: () => Promise<void> };
    await metricsRepo.recordReconciliationRun?.();
    await reconciliationRepo.reconciliationStarted();
    try {
      await this.event('INFO', 'reconciliation_started', 'Startup reconciliation started');
      // These reads intentionally happen before handling orders: PostgreSQL is
      // the conceptual source of truth; Binance balances are never inspected.
      await Promise.all([this.repo.account(), this.repo.openPosition()]);
      const pendingOrders = await reconciliationRepo.pendingOrders();
      for (const pending of pendingOrders) {
        let remote;
        try {
          remote = await this.exchange.orderByClientId(pending.clientOrderId);
        } catch (error) {
          throw new Error(`Binance unavailable while reconciling ${pending.clientOrderId}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        if (!remote) {
          await this.repo.markOrderRejected(pending.id, 'Binance confirmed no order exists for clientOrderId during startup reconciliation');
          await this.event('INFO', 'pending_order_reconciled', 'Pending order rejected after Binance confirmed it does not exist', {
            clientOrderId: pending.clientOrderId,
            outcome: 'REJECTED',
          });
          continue;
        }
        if (remote.status !== 'FILLED') {
          const reason = `Binance order ${pending.clientOrderId} is still ${remote.status}`;
          await this.event('ERROR', 'state_inconsistency_detected', 'Pending order remains ambiguous on Binance', {
            clientOrderId: pending.clientOrderId,
            status: remote.status,
          });
          throw new Error(reason);
        }
        const reconciledQuantity = remote.side === 'SELL'
          ? executionAccounting(remote.side, remote.executedQty, remote.cummulativeQuoteQty, remote.fills ?? []).positionQuantity
          : remote.executedQty;
        if (remote.side !== pending.side || (pending.requestedQuantity !== null && Math.abs(reconciledQuantity - pending.requestedQuantity) > 1e-12)) {
          const reason = `Binance execution for ${pending.clientOrderId} does not match the local pending order`;
          await this.event('ERROR', 'state_inconsistency_detected', reason, { clientOrderId: pending.clientOrderId });
          throw new Error(reason);
        }
        const result = await this.persistExecution(pending, remote, 'reconciliation');
        await this.event('INFO', 'pending_order_reconciled', 'Pending order reconciled from Binance execution', {
          clientOrderId: pending.clientOrderId,
        outcome: result.applied ? 'FILLED' : 'ALREADY_RECONCILED',
        });
      }
      const consistency = await reconciliationRepo.stateConsistency();
      if (!consistency.consistent) {
        await this.event('ERROR', 'state_inconsistency_detected', 'Ledger consistency check failed after reconciliation', { reason: consistency.reason });
        throw new Error(consistency.reason ?? 'Ledger consistency check failed');
      }
      await reconciliationRepo.reconciliationCompleted();
      await this.event('INFO', 'reconciliation_completed', 'Startup reconciliation completed', { pendingOrderCount: 0 });
      return { status: 'OK' as const, pendingOrders: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
      await reconciliationRepo.reconciliationFailed(message);
      await this.event('ERROR', 'reconciliation_failed', 'Startup reconciliation failed; trading remains blocked', { error: message });
      throw error;
    }
  }

  private async submitAndPersistOrder(side: 'BUY' | 'SELL', quantity: number, amountUsdt: number) {
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
        order = await this.exchange.placeMarketOrder(side, quantity, clientOrderId);
      }
    } catch (error) {
      order = await this.exchange.orderByClientId(clientOrderId);
      if (!order) {
        const message = error instanceof Error ? error.message : 'Unknown order submission error';
        await this.event('ERROR', 'external_service_error', 'Testnet order could not be verified', {
          service: 'binance',
          clientOrderId,
          error: message,
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

  async runOnce(at = new Date()) {
    return this.exclusive(() => this.runOnceLocked(at));
  }

  private async runOnceLocked(at: Date) {
    await this.repo.ensureAccount(config.INITIAL_BANK_USDT);
    await this.repo.heartbeat();
    const ready = await this.tradingReady();
    if (!ready.ready) {
      await this.event('WARN', 'cycle_skipped', 'Trading cycle blocked pending reconciliation', { reason: ready.reason });
      return { action: 'HOLD' as const, reason: ready.reason };
    }
    const phase = sessionPhase(at, undefined, Boolean(await this.repo.openPosition()));
    if (phase === 'BEFORE_START' || phase === 'FINISHED') {
      await this.event('INFO', 'cycle_skipped', 'Trading cycle skipped outside the daily session', { phase });
      return { action: 'HOLD' as const, reason: `Session phase is ${phase}` };
    }
    if (phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING') return this.forceClosePositionLocked();
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
          { service: 'binance', error: message },
        );
        throw error;
      }
      const [one, five, fifteen, account, position, rules, pending] = market;
      const snapshot = makeSnapshot(config.SYMBOL, { '1m': one, '5m': five, '15m': fifteen });
      const snapshotId = await this.repo.saveSnapshot(snapshot);
      // One compact point per cycle keeps dashboard charts historical without
      // making the browser poll Binance or the database directly.
      const dashboardRepo = this.repo as TradingRepository & { saveAccountSnapshot?: (price: number, at: Date) => Promise<void> };
      if (dashboardRepo.saveAccountSnapshot)
        await dashboardRepo.saveAccountSnapshot(snapshot.intervals['1m'].price, at);
      const response = await this.ai.decide(buildPrompt(snapshot, account, position));
      if (response.usage.fallbackUsed)
        await this.event('WARN', 'ai_fallback', 'OpenRouter fallback model was used', {
          model: response.usage.modelRequested,
        });
      if (response.usage.error)
        await this.event('ERROR', 'ai_error', 'OpenRouter did not return a usable decision', {
          error: response.usage.error,
        });
      let risk = applyRisk({
        action: response.decision.action,
        requestedUsdt: response.decision.amountUsdt,
        price: snapshot.intervals['1m'].price,
        account,
        position,
        rules,
        maxPositionPercent: config.MAX_POSITION_PERCENT,
        duplicateOrderPending: pending,
      });
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
      if (risk.action === 'BUY' && sessionPhase(new Date()) !== 'TRADING') {
        risk = { action: 'HOLD', amountUsdt: 0, quantity: 0, rejectionReason: 'New positions are blocked for today' };
        await this.event('WARN', 'new_positions_blocked', 'BUY blocked after revalidating the cutoff before submission', {
          phaseAtSubmission: sessionPhase(new Date()),
          requestedAction: response.decision.action,
        });
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
      const order = await this.submitAndPersistOrder(risk.action, risk.quantity, risk.amountUsdt);
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

  async forceClosePosition() {
    return this.exclusive(() => this.forceClosePositionLocked());
  }

  private async forceClosePositionLocked() {
    await this.repo.ensureAccount(config.INITIAL_BANK_USDT);
    const ready = await this.tradingReady();
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
    const risk = applyRisk({
      action: 'SELL',
      requestedUsdt: position.quantity * price,
      price,
      account,
      position,
      rules,
      maxPositionPercent: config.MAX_POSITION_PERCENT,
      // A pending SELL is retried with its persisted client id below. A pending
      // BUY is never retried during the close-only window.
      duplicateOrderPending: pending ? pending.side !== 'SELL' : await this.repo.pendingOrder(),
    });
    if (risk.action === 'HOLD') {
      await this.event('WARN', 'decision_rejected_by_risk', 'Forced close rejected by risk engine', {
        reason: risk.rejectionReason,
      });
      return risk;
    }
    const order = await this.submitAndPersistOrder('SELL', risk.quantity, risk.amountUsdt);
    await this.event('WARN', 'force_close_completed', 'Forced close completed', { orderId: order.orderId });
    return { action: 'SELL', orderId: order.orderId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown force-close error';
      await this.event('ERROR', 'force_close_failed', 'Forced close failed and will be retried while the window is open', { error: message });
      throw error;
    }
  }

  async smokeTestTestnet() {
    if (config.BINANCE_ENV !== 'testnet')
      throw new Error('Smoke test refuses any Binance environment except testnet');
    await this.repo.health();
    await this.repo.ensureAccount(config.INITIAL_BANK_USDT);
    const initialAccount = await this.repo.account();
    if (await this.repo.openPosition())
      throw new Error('Smoke test aborted: a conceptual BTC position is already open');
    if (initialAccount.cashUsdt <= 0) throw new Error('Smoke test aborted: conceptual cash is not positive');

    let rules;
    let price;
    try {
      [rules, price] = await Promise.all([this.exchange.rules(), this.exchange.price()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Binance rules error';
      await this.event(
        'ERROR',
        'external_service_error',
        'Smoke test could not retrieve Binance Testnet rules',
        { service: 'binance', error: message },
      );
      throw error;
    }
    const requestedUsdt = Math.min(6.5, initialAccount.cashUsdt);
    if (requestedUsdt > initialAccount.cashUsdt)
      throw new Error('Smoke test requested more than conceptual cash');
    const risk = applyRisk({
      action: 'BUY',
      requestedUsdt,
      price,
      account: initialAccount,
      position: null,
      rules,
      maxPositionPercent: config.MAX_POSITION_PERCENT,
      duplicateOrderPending: await this.repo.pendingOrder(),
    });
    if (risk.action !== 'BUY') throw new Error(`Smoke test technical BUY rejected: ${risk.rejectionReason}`);

    await this.event('INFO', 'smoke_test_started', 'Real Binance Spot Testnet smoke test started', {
      symbol: config.SYMBOL,
      requestedUsdt,
      amountAfterRiskUsdt: risk.amountUsdt,
    });
    let positionOpened = false;
    try {
      const buyOrder = await this.submitAndPersistOrder('BUY', risk.quantity, risk.amountUsdt);
      const buyAccounting = executionAccounting('BUY', buyOrder.executedQty, buyOrder.cummulativeQuoteQty, buyOrder.fills ?? []);
      positionOpened = true;
      const accountAfterBuy = await this.repo.account();
      const positionAfterBuy = await this.repo.openPosition();
      if (
        !positionAfterBuy ||
        positionAfterBuy.costUsdt <= 0 ||
        accountAfterBuy.cashUsdt >= initialAccount.cashUsdt
      )
        throw new Error('Smoke test BUY persistence verification failed');

      const close = await this.forceClosePosition();
      const sellOrderId = 'orderId' in close && typeof close.orderId === 'string' ? close.orderId : null;
      if (close.action !== 'SELL' || !sellOrderId)
        throw new Error('Smoke test SELL did not close the position');
      const finalAccount = await this.repo.account();
      const finalPosition = await this.repo.openPosition();
      const [orders, trades, events] = await Promise.all([
        this.repo.orders(),
        this.repo.trades(),
        this.repo.events(),
      ]);
      const expectedEvents = ['order_submitted', 'order_executed', 'position_opened', 'position_closed'];
      if (
        finalPosition ||
        orders.length < 2 ||
        trades.length < 2 ||
        !expectedEvents.every((type) => events.some((entry) => entry.event === type))
      )
        throw new Error('Smoke test final persistence verification failed');
      const pnl = finalAccount.realizedPnlUsdt - initialAccount.realizedPnlUsdt;
      const sellTrade = trades.find((trade) => trade.side === 'SELL');
      await this.event('INFO', 'smoke_test_completed', 'Real Binance Spot Testnet smoke test completed', {
        buyOrderId: buyOrder.orderId,
        sellOrderId,
        realizedPnlUsdt: pnl,
      });
      return {
        initialCashUsdt: initialAccount.cashUsdt,
        requestedUsdt,
        buyGrossQuantity: buyOrder.executedQty,
        buyFeesByAsset: buyAccounting.byAsset,
        buyNetPositionQuantity: positionAfterBuy.quantity,
        buyQuantity: buyOrder.executedQty,
        buyCostUsdt: positionAfterBuy.costUsdt,
        cashAfterBuy: accountAfterBuy.cashUsdt,
        positionCostUsdt: positionAfterBuy.costUsdt,
        sellQuantity: Number(sellTrade?.quantity ?? positionAfterBuy.quantity),
        sellGrossReceivedUsdt: Number(sellTrade?.quote_amount ?? finalAccount.cashUsdt - accountAfterBuy.cashUsdt),
        sellFeesByAsset: sellTrade?.fees_by_asset ?? {},
        sellReceivedUsdt: Number(sellTrade?.net_quote_amount ?? finalAccount.cashUsdt - accountAfterBuy.cashUsdt),
        grossPnlUsdt: Number(sellTrade?.gross_pnl_usdt ?? pnl),
        netPnlUsdt: Number(sellTrade?.net_pnl_usdt ?? pnl),
        tradePnlUsdt: pnl,
        cashAfterSell: finalAccount.cashUsdt,
        realizedPnlUsdt: finalAccount.realizedPnlUsdt,
        orderCount: orders.length,
        tradeCount: trades.length,
      };
    } catch (error) {
      if (positionOpened && (await this.repo.openPosition())) {
        try {
          await this.forceClosePosition();
        } catch (closeError) {
          logger.error({ err: closeError }, 'Smoke test cleanup could not close conceptual position');
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown smoke test error';
      try {
        await this.event('ERROR', 'unexpected_error', 'Smoke test failed', { error: message });
      } catch (eventError) {
        logger.error({ err: eventError }, 'Could not persist smoke test failure');
      }
      throw error;
    }
  }
}
