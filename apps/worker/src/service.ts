import { randomUUID } from 'node:crypto';
import { config, logger, sessionPhase } from '@bolinha/core';
import { makeSnapshot } from '@bolinha/market-data';
import { OpenRouterClient, buildPrompt } from '@bolinha/ai';
import { applyRisk } from '@bolinha/risk-engine';
import { BinanceTestnetClient, type BinanceGateway } from '@bolinha/exchange';
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

  private async submitAndPersistOrder(side: 'BUY' | 'SELL', quantity: number, amountUsdt: number) {
    const clientOrderId = randomUUID();
    const orderId = await this.repo.createPendingOrder(clientOrderId, side, amountUsdt);
    await this.event('INFO', 'order_submitted', 'Testnet market order submitted', {
      clientOrderId,
      side,
      quantity,
      amountUsdt,
    });
    let order;
    try {
      order = await this.exchange.placeMarketOrder(side, quantity, clientOrderId);
    } catch (error) {
      order = await this.exchange.orderByClientId(clientOrderId);
      if (!order) {
        const message = error instanceof Error ? error.message : 'Unknown order submission error';
        await this.repo.markOrderRejected(orderId);
        await this.event('ERROR', 'external_service_error', 'Testnet order could not be verified', {
          service: 'binance',
          clientOrderId,
          error: message,
        });
        throw error;
      }
    }
    await this.repo.recordExecution({
      id: orderId,
      binanceOrderId: order.orderId,
      side: order.side,
      quantity: order.executedQty,
      quote: order.cummulativeQuoteQty,
      commission: order.commission,
      at: order.transactTime,
    });
    await this.event('INFO', 'order_executed', 'Testnet order executed', {
      side: order.side,
      orderId: order.orderId,
      clientOrderId,
      quantity: order.executedQty,
      quoteAmount: order.cummulativeQuoteQty,
    });
    await this.event(
      'INFO',
      order.side === 'BUY' ? 'position_opened' : 'position_closed',
      'Conceptual position updated',
      { side: order.side, quantity: order.executedQty, quoteAmount: order.cummulativeQuoteQty },
    );
    return order;
  }

  async runOnce(at = new Date()) {
    return this.exclusive(() => this.runOnceLocked(at));
  }

  private async runOnceLocked(at: Date) {
    await this.repo.ensureAccount(config.INITIAL_BANK_USDT);
    await this.repo.heartbeat();
    const phase = sessionPhase(at);
    if (phase === 'BEFORE_START' || phase === 'FINISHED') {
      await this.event('INFO', 'cycle_skipped', 'Trading cycle skipped outside the daily session', { phase });
      return { action: 'HOLD' as const, reason: `Session phase is ${phase}` };
    }
    if (phase === 'FORCE_CLOSE') return this.forceClosePositionLocked();
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
    await this.event('WARN', 'force_close_started', 'Forced close requested', { symbol: config.SYMBOL });
    try {
    const [position, account, rules, price] = await Promise.all([
      this.repo.openPosition(),
      this.repo.account(),
      this.exchange.rules(),
      this.exchange.price(),
    ]);
    if (!position) {
      await this.event('INFO', 'force_close_completed', 'No conceptual position to close', {
        action: 'HOLD',
      });
      return { action: 'HOLD', reason: 'No open conceptual position' };
    }
    const risk = applyRisk({
      action: 'SELL',
      requestedUsdt: position.quantity * price,
      price,
      account,
      position,
      rules,
      maxPositionPercent: config.MAX_POSITION_PERCENT,
      duplicateOrderPending: await this.repo.pendingOrder(),
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
      await this.event('INFO', 'smoke_test_completed', 'Real Binance Spot Testnet smoke test completed', {
        buyOrderId: buyOrder.orderId,
        sellOrderId,
        realizedPnlUsdt: pnl,
      });
      return {
        initialCashUsdt: initialAccount.cashUsdt,
        requestedUsdt,
        buyQuantity: buyOrder.executedQty,
        buyCostUsdt: buyOrder.cummulativeQuoteQty,
        cashAfterBuy: accountAfterBuy.cashUsdt,
        positionCostUsdt: positionAfterBuy.costUsdt,
        sellQuantity: positionAfterBuy.quantity,
        sellReceivedUsdt: finalAccount.cashUsdt - accountAfterBuy.cashUsdt,
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
