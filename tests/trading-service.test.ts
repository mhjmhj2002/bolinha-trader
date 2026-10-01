import { describe, expect, it } from 'vitest';
import { TradingService } from '../apps/worker/src/service.ts';
import type { Candle } from '@bolinha/market-data';

const candles = Array.from({ length: 30 }, (_, i): Candle => ({ openTime: i, closeTime: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 }));
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
    const repo = { ensureAccount: async () => {}, event: async () => {}, openPosition: async () => position, account: async () => ({ initialBankUsdt: 20, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }), pendingOrder: async () => false, createPendingOrder: async () => 1, markOrderRejected: async () => {}, recordExecution: async () => { position = null; } };
    const exchange = { rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), price: async () => 10_000, placeMarketOrder: async () => { submitted++; return { orderId: 'one', side: 'SELL' as const, executedQty: .001, cummulativeQuoteQty: 10, commission: 0, transactTime: new Date() }; }, orderByClientId: async () => null };
    const service = new TradingService(repo as never, exchange as never, {} as never);
    await service.forceClosePosition(); await service.forceClosePosition();
    expect(submitted).toBe(1);
  });
});
