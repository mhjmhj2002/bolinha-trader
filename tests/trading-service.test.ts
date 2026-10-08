import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradingService } from '../apps/worker/src/service.ts';
import type { Candle } from '@bolinha/market-data';

const candles = Array.from({ length: 30 }, (_, i): Candle => ({ openTime: i, closeTime: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 }));
afterEach(() => vi.useRealTimers());
describe('one trading cycle', () => {
  it('persists a mocked HOLD and its operational events without submitting an order', async () => {
    const saved: { snapshot: boolean; decision: boolean; events: string[] } = { snapshot: false, decision: false, events: [] };
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, account: async () => ({ initialBankUsdt: 20, cashUsdt: 20, realizedPnlUsdt: 0, aiCostUsd: 0 }), openPosition: async () => null, pendingOrder: async () => false, saveSnapshot: async () => { saved.snapshot = true; return 1; }, saveDecision: async () => { saved.decision = true; return 1; }, event: async (_severity: string, type: string) => { saved.events.push(type); } };
    const exchange = { candles: async () => candles, rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), placeMarketOrder: async () => { throw new Error('must not submit'); }, orderByClientId: async () => null };
    const ai = { decide: async () => ({ decision: { action: 'HOLD' as const, amountUsdt: 0, confidence: 1, reason: 'mock hold', rawResponse: null }, usage: { modelRequested: 'mock', modelReturned: 'mock', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, latencyMs: 1, error: null, fallbackUsed: false } }) };
    const result = await new TradingService(repo as never, exchange as never, ai as never).runOnce(new Date('2026-10-01T12:00:00Z'));
    expect(result.action).toBe('HOLD'); expect(saved.snapshot).toBe(true); expect(saved.decision).toBe(true); expect(saved.events).toEqual(['cycle_started', 'decision_created', 'cycle_completed']);
  });

  it('force close is idempotent and sells only the persisted conceptual position', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .001, entryPrice: 10_000, costUsdt: 10, openedAt: new Date() };
    let submitted = 0;
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {}, openPosition: async () => position, account: async () => ({ initialBankUsdt: 20, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }), pendingOrder: async () => false, createPendingOrder: async () => 1, markOrderRejected: async () => {}, recordExecution: async () => { position = null; } };
    const exchange = { rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), price: async () => 10_000, placeMarketOrder: async () => { submitted++; return { orderId: 'one', status: 'FILLED', side: 'SELL' as const, executedQty: .001, cummulativeQuoteQty: 10, commission: 0, transactTime: new Date() }; }, orderByClientId: async () => null };
    const service = new TradingService(repo as never, exchange as never, {} as never);
    await service.runOnce(new Date('2026-10-01T20:59:00Z'));
    await service.runOnce(new Date('2026-10-01T20:59:00Z'));
    expect(submitted).toBe(1);
  });

  it('a normal AI SELL ignores a partial amount and persists exactly the quantity sent to Binance', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .0015, entryPrice: 10_000, costUsdt: 15, openedAt: new Date() };
    const sent: number[] = [];
    const recorded: number[] = [];
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {}, account: async () => ({ initialBankUsdt: 20, cashUsdt: 5, realizedPnlUsdt: 0, aiCostUsd: 0 }), openPosition: async () => position, pendingOrder: async () => false, saveSnapshot: async () => 1, saveDecision: async () => 1, createPendingOrder: async () => 1, markOrderRejected: async () => {}, recordExecution: async (order: { quantity: number }) => { recorded.push(order.quantity); position = null; } };
    const exchange = { candles: async () => candles.map((c) => ({ ...c, open: 10_000, high: 10_001, low: 9_999, close: 10_000 })), rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), placeMarketOrder: async (_side: string, quantity: number) => { sent.push(quantity); return { orderId: 'one', status: 'FILLED', side: 'SELL' as const, executedQty: quantity, cummulativeQuoteQty: quantity * 10_000, commission: 0, transactTime: new Date() }; }, orderByClientId: async () => null };
    const ai = { decide: async () => ({ decision: { action: 'SELL' as const, amountUsdt: 1, confidence: 1, reason: 'sell only one USDT', rawResponse: null }, usage: { modelRequested: 'mock', modelReturned: 'mock', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, latencyMs: 1, error: null, fallbackUsed: false } }) };
    const result = await new TradingService(repo as never, exchange as never, ai as never).runOnce(new Date('2026-10-01T12:00:00Z'));
    expect(result.action).toBe('SELL');
    expect(sent).toEqual([.0015]);
    expect(recorded).toEqual(sent);
    expect(position).toBeNull();
  });

  it('retries the same pending SELL after 17:55 and only closes after Binance confirms it', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .001, entryPrice: 10_000, costUsdt: 10, openedAt: new Date() };
    let pending: { id: number; clientOrderId: string; side: 'SELL'; requestedAmount: number; requestedQuantity: number } | null = null;
    const clientIds: string[] = [];
    let attempts = 0;
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {}, account: async () => ({ initialBankUsdt: 20, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }), openPosition: async () => position, pendingOrder: async () => Boolean(pending), pendingOrderDetails: async () => pending, createPendingOrder: async (clientOrderId: string, side: 'SELL', amount: number, quantity: number) => { pending = { id: 1, clientOrderId, side, requestedAmount: amount, requestedQuantity: quantity }; return 1; }, markOrderRejected: async () => {}, recordExecution: async () => { position = null; pending = null; } };
    const exchange = { rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), price: async () => 10_000, placeMarketOrder: async (_side: string, quantity: number, clientOrderId: string) => { clientIds.push(clientOrderId); attempts++; if (attempts === 1) throw new Error('temporary Binance outage'); return { orderId: 'one', status: 'FILLED', side: 'SELL' as const, executedQty: quantity, cummulativeQuoteQty: quantity * 10_000, commission: 0, transactTime: new Date() }; }, orderByClientId: async () => null };
    const service = new TradingService(repo as never, exchange as never, {} as never);
    await expect(service.runOnce(new Date('2026-10-01T20:59:00Z'))).rejects.toThrow('temporary Binance outage');
    expect(position).not.toBeNull();
    await service.runOnce(new Date('2026-10-01T21:03:00Z'));
    expect(position).toBeNull();
    expect(clientIds).toHaveLength(2);
    expect(new Set(clientIds).size).toBe(1);
  });

  it('at 18:10 after restart, an open position is still closed instead of being treated as FINISHED', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .001, entryPrice: 10_000, costUsdt: 10, openedAt: new Date() };
    let submitted = 0;
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {}, account: async () => ({ initialBankUsdt: 20, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }), openPosition: async () => position, pendingOrder: async () => false, createPendingOrder: async () => 1, markOrderRejected: async () => {}, recordExecution: async () => { position = null; } };
    const exchange = { rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), price: async () => 10_000, placeMarketOrder: async () => { submitted++; return { orderId: 'one', status: 'FILLED', side: 'SELL' as const, executedQty: .001, cummulativeQuoteQty: 10, commission: 0, transactTime: new Date() }; }, orderByClientId: async () => null };
    await new TradingService(repo as never, exchange as never, {} as never).runOnce(new Date('2026-10-01T21:10:00Z'));
    expect(submitted).toBe(1);
    expect(position).toBeNull();
  });

  it('turns a BUY into HOLD when analysis crosses the 17:50 cutoff before submission', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T20:50:01Z'));
    let submitted = 0;
    const savedActions: string[] = [];
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {}, account: async () => ({ initialBankUsdt: 20, cashUsdt: 20, realizedPnlUsdt: 0, aiCostUsd: 0 }), openPosition: async () => null, pendingOrder: async () => false, saveSnapshot: async () => 1, saveDecision: async (_decision: unknown, _usage: unknown, action: string) => { savedActions.push(action); return 1; }, createPendingOrder: async () => 1, markOrderRejected: async () => {}, recordExecution: async () => {} };
    const exchange = { candles: async () => candles.map((c) => ({ ...c, open: 10_000, high: 10_001, low: 9_999, close: 10_000 })), rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), placeMarketOrder: async () => { submitted++; throw new Error('must not submit after cutoff'); }, orderByClientId: async () => null };
    const ai = { decide: async () => ({ decision: { action: 'BUY' as const, amountUsdt: 10, confidence: 1, reason: 'buy', rawResponse: null }, usage: { modelRequested: 'mock', modelReturned: 'mock', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, latencyMs: 1, error: null, fallbackUsed: false } }) };

    const result = await new TradingService(repo as never, exchange as never, ai as never).runOnce(new Date('2026-10-01T20:49:59Z'));
    expect(result.action).toBe('HOLD');
    expect(savedActions).toEqual(['HOLD']);
    expect(submitted).toBe(0);
  });

  it('records a force-close without a position as a NOOP, not as a forced close', async () => {
    const events: string[] = [];
    const repo = { ensureAccount: async () => {}, event: async (_severity: string, type: string) => { events.push(type); }, openPosition: async () => null, account: async () => ({ initialBankUsdt: 20, cashUsdt: 20, realizedPnlUsdt: 0, aiCostUsd: 0 }), pendingOrder: async () => false };
    const result = await new TradingService(repo as never, {} as never, {} as never).forceClosePosition();
    expect(result).toMatchObject({ action: 'HOLD', reason: 'No open conceptual position' });
    expect(events).toEqual(['force_close_noop']);
  });

  it('marks pending order as REJECTED when Binance rejects submission with HTTP 400 and order does not exist', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 7, quantity: 0.00024, entryPrice: 82941.72, costUsdt: 19.906, openedAt: new Date() };
    let orderStatus = '';
    let rejectedReason = '';
    const events: string[] = [];
    const repo = {
      ensureAccount: async () => {},
      heartbeat: async () => {},
      event: async (_severity: string, type: string) => { events.push(type); },
      account: async () => ({ initialBankUsdt: 20, cashUsdt: 0.1, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => position,
      pendingOrder: async () => orderStatus === 'PENDING',
      pendingOrderDetails: async () => null,
      createPendingOrder: async () => {
        orderStatus = 'PENDING';
        return 17;
      },
      markOrderRejected: async (_id: number, reason: string) => {
        orderStatus = 'REJECTED';
        rejectedReason = reason;
      },
      recordExecution: async () => { position = null; },
    };
    const exchange = {
      rules: async () => ({ minNotional: 10, minQty: 0.00001, stepSize: 0.00001 }),
      price: async () => 82900,
      placeMarketOrder: async () => {
        throw new Error('Binance Testnet HTTP 400 (-1021): Timestamp for this request is outside of the recvWindow.');
      },
      orderByClientId: async () => null,
    };

    const service = new TradingService(repo as never, exchange as never, {} as never);
    await expect(service.forceClosePosition()).rejects.toThrow('Timestamp for this request is outside of the recvWindow');

    expect(orderStatus).toBe('REJECTED');
    expect(rejectedReason).toContain('Binance Testnet HTTP 400 (-1021)');
    expect(position).not.toBeNull(); // A posição permanece aberta para tentar no próximo ciclo
    expect(events).toContain('pending_order_reconciled');
  });
});
