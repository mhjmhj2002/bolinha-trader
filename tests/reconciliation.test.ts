import { describe, expect, it } from 'vitest';
import { TradingService } from '../apps/worker/src/service.ts';

type Pending = {
  id: number;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  requestedQuantity: number;
};

function crashedExecutionFixture(pendingOrder: Pending, hasPosition = false) {
  let pending = [pendingOrder];
  let position = hasPosition ? { id: 7, quantity: pendingOrder.requestedQuantity, entryPrice: 10_000, costUsdt: 10, openedAt: new Date() } : null;
  let cash = hasPosition ? 10 : 20;
  let trades = 0;
  let recordCalls = 0;
  const events: string[] = [];
  const repo = {
    ensureAccount: async () => {},
    account: async () => ({ initialBankUsdt: 20, cashUsdt: cash, realizedPnlUsdt: 0, aiCostUsd: 0 }),
    openPosition: async () => position,
    pendingOrders: async () => pending,
    reconciliationStarted: async () => {},
    reconciliationCompleted: async () => {},
    reconciliationFailed: async () => {},
    stateConsistency: async () => ({ consistent: pending.length === 0 && trades === 1, reason: null }),
    markOrderRejected: async (id: number) => { pending = pending.filter((order) => order.id !== id); },
    recordExecution: async (execution: { id: number; side: 'BUY' | 'SELL'; quote: number; quantity: number }) => {
      recordCalls++;
      // Simulates the single database transaction used by the production repository.
      pending = pending.filter((order) => order.id !== execution.id);
      if (execution.side === 'BUY') { position = { id: 8, quantity: execution.quantity, entryPrice: execution.quote / execution.quantity, costUsdt: execution.quote, openedAt: new Date() }; cash -= execution.quote; }
      else { position = null; cash += execution.quote; }
      trades++;
      return { applied: true };
    },
    event: async (_level: string, event: string) => { events.push(event); },
  };
  const exchange = {
    orderByClientId: async (clientOrderId: string) => ({ orderId: `binance-${clientOrderId}`, clientOrderId, status: 'FILLED', side: pendingOrder.side, executedQty: pendingOrder.requestedQuantity, cummulativeQuoteQty: 10, commission: 0, transactTime: new Date() }),
  };
  return { repo, exchange, values: () => ({ position, cash, trades, recordCalls, events }) };
}

describe('startup reconciliation after a process crash', () => {
  it('records a Binance-filled BUY exactly once after crashing before recordExecution', async () => {
    const fixture = crashedExecutionFixture({ id: 1, clientOrderId: 'buy-after-crash', side: 'BUY', requestedQuantity: 0.001 });
    const service = new TradingService(fixture.repo as never, fixture.exchange as never, {} as never);

    await service.reconcileStateOnStartup();
    await service.reconcileStateOnStartup(); // Restart reconciliation is safe to repeat.

    expect(fixture.values()).toMatchObject({ cash: 10, trades: 1, recordCalls: 1 });
    expect(fixture.values().position).toMatchObject({ quantity: 0.001, costUsdt: 10 });
    expect(fixture.values().events).toContain('pending_order_reconciled');
  });

  it('closes a conceptual position and credits the SELL exactly once after a crash', async () => {
    const fixture = crashedExecutionFixture({ id: 2, clientOrderId: 'sell-after-crash', side: 'SELL', requestedQuantity: 0.001 }, true);
    const service = new TradingService(fixture.repo as never, fixture.exchange as never, {} as never);

    await service.reconcileStateOnStartup();
    await service.reconcileStateOnStartup();

    expect(fixture.values()).toMatchObject({ position: null, cash: 20, trades: 1, recordCalls: 1 });
    expect(fixture.values().events).toContain('position_closed');
  });

  it('can reconcile after more than three transient Binance failures, without a restart', async () => {
    const fixture = crashedExecutionFixture({ id: 3, clientOrderId: 'retry-after-outage', side: 'BUY', requestedQuantity: 0.001 });
    let available = false;
    fixture.exchange.orderByClientId = async (clientOrderId: string) => {
      if (!available) throw new Error('Binance temporarily unavailable');
      return { orderId: `binance-${clientOrderId}`, clientOrderId, status: 'FILLED', side: 'BUY', executedQty: 0.001, cummulativeQuoteQty: 10, commission: 0, transactTime: new Date() };
    };
    const service = new TradingService(fixture.repo as never, fixture.exchange as never, {} as never);

    await expect(service.reconcileStateOnStartup()).rejects.toThrow('Binance unavailable');
    await expect(service.reconcileStateOnStartup()).rejects.toThrow('Binance unavailable');
    await expect(service.reconcileStateOnStartup()).rejects.toThrow('Binance unavailable');
    available = true;
    await expect(service.reconcileStateOnStartup()).resolves.toMatchObject({ status: 'OK' });

    expect(fixture.values()).toMatchObject({ cash: 10, trades: 1, recordCalls: 1 });
  });
});
