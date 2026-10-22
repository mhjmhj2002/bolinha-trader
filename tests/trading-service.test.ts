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

  it('a normal AI SELL ignores a partial amount and persists exactly the quantity sent to B3', async () => {
    // PnL de +2,04% (acima da banda de ruído de 0,4%): a IA pode vender de verdade.
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .0015, entryPrice: 9_800, costUsdt: 14.7, openedAt: new Date() };
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

  it('writes an account snapshot right after an executed SELL, so the dashboard is not stale (BUG-10 parte C)', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .0015, entryPrice: 9_800, costUsdt: 14.7, openedAt: new Date() };
    const snapshots: Array<{ price: number; at: Date }> = [];
    const repo = {
      ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {},
      account: async () => ({ initialBankUsdt: 20, cashUsdt: 5, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => position, pendingOrder: async () => false,
      saveSnapshot: async () => 1, saveDecision: async () => 1, createPendingOrder: async () => 1,
      markOrderRejected: async () => {},
      saveAccountSnapshot: async (price: number, at: Date) => { snapshots.push({ price, at }); },
      recordExecution: async () => { position = null; },
    };
    // Snapshot de 1m em R$ 10.000, execução em R$ 10.100 (slippage favorável).
    const exchange = {
      candles: async () => candles.map((c) => ({ ...c, open: 10_000, high: 10_001, low: 9_999, close: 10_000 })),
      rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }),
      price: async () => 10_000,
      placeMarketOrder: async (_side: string, quantity: number) => ({ orderId: 'one', status: 'FILLED', side: 'SELL' as const, executedQty: quantity, cummulativeQuoteQty: quantity * 10_100, commission: 0, transactTime: new Date('2026-10-01T12:00:30Z') }),
      orderByClientId: async () => null,
    };
    const ai = { decide: async () => ({ decision: { action: 'SELL' as const, amountUsdt: 15, confidence: 1, reason: 'take profit', rawResponse: null }, usage: { modelRequested: 'mock', modelReturned: 'mock', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, latencyMs: 1, error: null, fallbackUsed: false } }) };

    const result = await new TradingService(repo as never, exchange as never, ai as never).runOnce(new Date('2026-10-01T12:00:00Z'));

    expect(result.action).toBe('SELL');
    expect(position).toBeNull();
    // The decision cycle writes one point at the 1m price; the execution must
    // add the post-sale point priced at the fill itself.
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].price).toBe(10_000);
    expect(snapshots.at(-1)).toEqual({ price: 10_100, at: new Date('2026-10-01T12:00:30Z') });
  });

  it('writes an account snapshot after a force close even when no decision cycle follows (BUG-10 parte C)', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: 3, entryPrice: 29.92, costUsdt: 89.76, openedAt: new Date() };
    const snapshots: Array<{ price: number; at: Date }> = [];
    const events: string[] = [];
    const repo = {
      ensureAccount: async () => {}, heartbeat: async () => {},
      event: async (_severity: string, type: string) => { events.push(type); },
      account: async () => ({ initialBankUsdt: 100, cashUsdt: 10.24, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => position, pendingOrder: async () => false, createPendingOrder: async () => 1,
      markOrderRejected: async () => {},
      saveAccountSnapshot: async (price: number, at: Date) => { snapshots.push({ price, at }); },
      recordExecution: async () => { position = null; },
    };
    const exchange = {
      rules: async () => ({ minNotional: 1, minQty: 1, stepSize: 1 }),
      price: async () => 30.25,
      placeMarketOrder: async () => ({ orderId: 'close-1', status: 'FILLED', side: 'SELL' as const, executedQty: 3, cummulativeQuoteQty: 90.75, commission: 0, transactTime: new Date('2026-10-01T20:55:00Z') }),
      orderByClientId: async () => null,
    };

    const result = await new TradingService(repo as never, exchange as never, {} as never).runOnce(new Date('2026-10-01T20:59:00Z'));

    expect(result).toMatchObject({ action: 'SELL', orderId: 'close-1' });
    expect(position).toBeNull();
    expect(events).toContain('force_close_completed');
    expect(snapshots.length).toBeGreaterThan(0);
    // 90,75 / 3 = R$ 30,25: the post-sale cash/zero-position point.
    expect(snapshots.at(-1)).toEqual({ price: 30.25, at: new Date('2026-10-01T20:55:00Z') });
  });

  it('keeps an executed order when the account snapshot write fails (fail-safe)', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: 3, entryPrice: 29.92, costUsdt: 89.76, openedAt: new Date() };
    let snapshotAttempts = 0;
    const events: string[] = [];
    const repo = {
      ensureAccount: async () => {}, heartbeat: async () => {},
      event: async (_severity: string, type: string) => { events.push(type); },
      account: async () => ({ initialBankUsdt: 100, cashUsdt: 10.24, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => position, pendingOrder: async () => false, createPendingOrder: async () => 1,
      markOrderRejected: async () => {},
      saveAccountSnapshot: async () => { snapshotAttempts++; throw new Error('dashboard writer unavailable'); },
      recordExecution: async () => { position = null; },
    };
    const exchange = {
      rules: async () => ({ minNotional: 1, minQty: 1, stepSize: 1 }),
      price: async () => 30.25,
      placeMarketOrder: async () => ({ orderId: 'close-2', status: 'FILLED', side: 'SELL' as const, executedQty: 3, cummulativeQuoteQty: 90.75, commission: 0, transactTime: new Date('2026-10-01T20:55:00Z') }),
      orderByClientId: async () => null,
    };

    const result = await new TradingService(repo as never, exchange as never, {} as never).runOnce(new Date('2026-10-01T20:59:00Z'));

    // The ledger keeps the sale; only the dashboard point is reported as failed.
    expect(result).toMatchObject({ action: 'SELL', orderId: 'close-2' });
    expect(position).toBeNull();
    expect(snapshotAttempts).toBeGreaterThan(0);
    expect(events).toContain('account_snapshot_failed');
    expect(events).toContain('force_close_completed');
  });

  it('retries the same pending SELL after 17:55 and only closes after B3 confirms it', async () => {
    let position: { id: number; quantity: number; entryPrice: number; costUsdt: number; openedAt: Date } | null = { id: 1, quantity: .001, entryPrice: 10_000, costUsdt: 10, openedAt: new Date() };
    let pending: { id: number; clientOrderId: string; side: 'SELL'; requestedAmount: number; requestedQuantity: number } | null = null;
    const clientIds: string[] = [];
    let attempts = 0;
    const repo = { ensureAccount: async () => {}, heartbeat: async () => {}, event: async () => {}, account: async () => ({ initialBankUsdt: 20, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }), openPosition: async () => position, pendingOrder: async () => Boolean(pending), pendingOrderDetails: async () => pending, createPendingOrder: async (clientOrderId: string, side: 'SELL', amount: number, quantity: number) => { pending = { id: 1, clientOrderId, side, requestedAmount: amount, requestedQuantity: quantity }; return 1; }, markOrderRejected: async () => {}, recordExecution: async () => { position = null; pending = null; } };
    const exchange = { rules: async () => ({ minNotional: 10, minQty: .0001, stepSize: .0001 }), price: async () => 10_000, placeMarketOrder: async (_side: string, quantity: number, clientOrderId: string) => { clientIds.push(clientOrderId); attempts++; if (attempts === 1) throw new Error('temporary B3 outage'); return { orderId: 'one', status: 'FILLED', side: 'SELL' as const, executedQty: quantity, cummulativeQuoteQty: quantity * 10_000, commission: 0, transactTime: new Date() }; }, orderByClientId: async () => null };
    const service = new TradingService(repo as never, exchange as never, {} as never);
    await expect(service.runOnce(new Date('2026-10-01T20:59:00Z'))).rejects.toThrow('temporary B3 outage');
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

  it('downgrades an AI BUY to HOLD when the multi-timeframe entry confluence is not met', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T13:00:00Z'));
    const events: Array<{ type: string; metadata?: unknown }> = [];
    const savedActions: string[] = [];
    const savedReasons: Array<string | null> = [];
    let submitted = 0;
    const repo = {
      ensureAccount: async () => {},
      heartbeat: async () => {},
      event: async (_severity: string, type: string, _message: string, metadata?: unknown) => { events.push({ type, metadata }); },
      account: async () => ({ initialBankUsdt: 100, cashUsdt: 100, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => null,
      pendingOrder: async () => false,
      saveSnapshot: async () => 1,
      saveDecision: async (_decision: unknown, _usage: unknown, action: string, _amount: number, reason: string | null) => { savedActions.push(action); savedReasons.push(reason); return 1; },
      createPendingOrder: async () => 1,
      markOrderRejected: async () => {},
      recordExecution: async () => {},
    };
    // Série em queda nos três timeframes: EMA9 < EMA21 => sem confluência de alta.
    const fallingCloses = [30];
    for (let i = 0; i < 21; i++) fallingCloses.push(30);
    for (let i = 0; i < 21; i++) fallingCloses.push(Number((fallingCloses.at(-1)! + [-0.05, -0.05, 0.05][i % 3]).toFixed(4)));
    const falling: Candle[] = fallingCloses.map((close, i) => ({ openTime: i, closeTime: i, open: close, high: close, low: close, close, volume: 100 }));
    const exchange = {
      candles: async () => falling,
      rules: async () => ({ minNotional: 1, minQty: 1, stepSize: 1 }),
      placeMarketOrder: async () => { submitted++; throw new Error('BUY must not be submitted without confluence'); },
      orderByClientId: async () => null,
    };
    const ai = { decide: async () => ({ decision: { action: 'BUY' as const, amountUsdt: 100, confidence: 0.9, reason: 'ai wants to buy the top', rawResponse: null }, usage: { modelRequested: 'mock', modelReturned: 'mock', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, latencyMs: 1, error: null, fallbackUsed: false } }) };

    const result = await new TradingService(repo as never, exchange as never, ai as never).runOnce(new Date('2026-10-01T12:00:00Z'));

    expect(result.action).toBe('HOLD');
    expect(savedActions).toEqual(['HOLD']);
    expect(savedReasons[0]).toContain('multi-timeframe entry filter');
    expect(submitted).toBe(0);
    expect(events.some((entry) => entry.type === 'entry_confluence_blocked_buy')).toBe(true);
  });

  it('holds without submitting when a timeframe has insufficient candles for the entry filter', async () => {
    let submitted = 0;
    const repo = {
      ensureAccount: async () => {},
      heartbeat: async () => {},
      event: async () => {},
      account: async () => ({ initialBankUsdt: 100, cashUsdt: 100, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => null,
      pendingOrder: async () => false,
      saveSnapshot: async () => 1,
      saveDecision: async () => 1,
      createPendingOrder: async () => 1,
      markOrderRejected: async () => {},
      recordExecution: async () => {},
    };
    // 5m com apenas 5 candles: indicadores impossíveis => fail-closed.
    const exchange = {
      candles: async (interval: string) => (interval === '5m' ? candles.slice(0, 5) : candles),
      rules: async () => ({ minNotional: 1, minQty: 1, stepSize: 1 }),
      placeMarketOrder: async () => { submitted++; throw new Error('BUY must never be submitted on bad data'); },
      orderByClientId: async () => null,
    };
    const ai = { decide: async () => ({ decision: { action: 'BUY' as const, amountUsdt: 100, confidence: 0.9, reason: 'buy on incomplete data', rawResponse: null }, usage: { modelRequested: 'mock', modelReturned: 'mock', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, latencyMs: 1, error: null, fallbackUsed: false } }) };

    const result = await new TradingService(repo as never, exchange as never, ai as never).runOnce(new Date('2026-10-01T12:00:00Z'));

    expect(result.action).toBe('HOLD');
    expect(submitted).toBe(0);
  });

  it('records a force-close without a position as a NOOP, not as a forced close', async () => {    const events: string[] = [];
    const repo = { ensureAccount: async () => {}, event: async (_severity: string, type: string) => { events.push(type); }, openPosition: async () => null, account: async () => ({ initialBankUsdt: 20, cashUsdt: 20, realizedPnlUsdt: 0, aiCostUsd: 0 }), pendingOrder: async () => false };
    const result = await new TradingService(repo as never, {} as never, {} as never).forceClosePosition();
    expect(result).toMatchObject({ action: 'HOLD', reason: 'No open conceptual position' });
    expect(events).toEqual(['force_close_noop']);
  });

  it('marks pending order as REJECTED when B3 rejects submission with HTTP 400 and order does not exist', async () => {
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
        throw new Error('B3 Testnet HTTP 400 (-1021): Timestamp for this request is outside of the recvWindow.');
      },
      orderByClientId: async () => null,
    };

    const service = new TradingService(repo as never, exchange as never, {} as never);
    await expect(service.forceClosePosition()).rejects.toThrow('Timestamp for this request is outside of the recvWindow');

    expect(orderStatus).toBe('REJECTED');
    expect(rejectedReason).toContain('B3 Testnet HTTP 400 (-1021)');
    expect(position).not.toBeNull(); // A posição permanece aberta para tentar no próximo ciclo
    expect(events).toContain('pending_order_reconciled');
  });

  it('marks pending order as REJECTED when submission fails with network error (fetch failed) and B3 confirms order does not exist', async () => {
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
        return 19;
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
        throw new Error('fetch failed');
      },
      orderByClientId: async () => null,
    };

    const service = new TradingService(repo as never, exchange as never, {} as never);
    await expect(service.forceClosePosition()).rejects.toThrow('fetch failed');

    expect(orderStatus).toBe('REJECTED');
    expect(rejectedReason).toContain('fetch failed');
    expect(events).toContain('pending_order_reconciled');
  });

  it('automatically triggers runtime reconciliation and unblocks trading cycle when pending orders exist', async () => {
    let pendingOrdersList = [{ id: 10, clientOrderId: 'pending-network-order', side: 'BUY' as const, requestedQuantity: 0.00024 }];
    const events: string[] = [];
    let stateConsistent = false;
    const repo = {
      ensureAccount: async () => {},
      heartbeat: async () => {},
      event: async (_severity: string, type: string) => { events.push(type); },
      account: async () => ({ initialBankUsdt: 20, cashUsdt: 20, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => null,
      pendingOrder: async () => pendingOrdersList.length > 0,
      pendingOrders: async () => pendingOrdersList,
      pendingOrderCount: async () => pendingOrdersList.length,
      reconciliationState: async () => ({ status: 'OK' as const, stateConsistent: pendingOrdersList.length === 0, lastError: null }),
      reconciliationStarted: async () => {},
      reconciliationCompleted: async () => { stateConsistent = true; },
      reconciliationFailed: async () => {},
      stateConsistency: async () => ({ consistent: pendingOrdersList.length === 0, reason: null }),
      saveSnapshot: async () => 1,
      saveDecision: async () => 1,
      markOrderRejected: async (id: number) => {
        pendingOrdersList = pendingOrdersList.filter(o => o.id !== id);
      },
      recordExecution: async () => ({ applied: true }),
    };

    const exchange = {
      rules: async () => ({ minNotional: 10, minQty: 0.00001, stepSize: 0.00001 }),
      price: async () => 82900,
      candles: async () => candles,
      orderByClientId: async () => null, // B3 confirma que a ordem pendente não existe
    };

    const ai = {
      decide: async () => ({
        decision: { action: 'HOLD' as const, amountUsdt: 0, confidence: 0.9, reason: 'hold test', rawResponse: null },
        usage: { modelRequested: 'test-model', latencyMs: 50, promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, error: null, fallbackUsed: false },
      }),
    };

    const service = new TradingService(repo as never, exchange as never, ai as never);
    // Força data dentro da sessão de trading
    const tradingDate = new Date('2026-03-25T14:00:00Z');
    const result = await service.runOnce(tradingDate);

    expect(pendingOrdersList).toHaveLength(0);
    expect(stateConsistent).toBe(true);
    expect(events).toContain('pending_order_reconciled');
    expect(events).toContain('reconciliation_completed');
  });

  it('blocks SELL decision with HOLD via Slippage Guard when broker price is significantly below snapshot price', async () => {
    const events: Array<{ type: string; metadata?: any }> = [];
    let savedDecisionAction: string | null = null;
    let orderPlaced = false;

    // Posição comprada a R$ 30.00
    const position = { id: 1, ticker: 'PETR4', quantity: 3, entryPrice: 30.0, costUsdt: 90.0, openedAt: new Date() };

    const repo = {
      ensureAccount: async () => {},
      heartbeat: async () => {},
      account: async () => ({ initialBankUsdt: 100, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }),
      openPosition: async () => position,
      pendingOrder: async () => false,
      saveSnapshot: async () => 1,
      saveDecision: async (_d: any, _u: any, action: string) => {
        savedDecisionAction = action;
        return 1;
      },
      event: async (_sev: string, type: string, _msg: string, metadata?: any) => {
        events.push({ type, metadata });
      },
    };

    // Snapshot indica fechamento em R$ 31.00 (+3.3% de lucro)
    const candles31 = candles.map((c) => ({ ...c, close: 31.0 }));

    // Mas no momento da execução, o broker reporta R$ 29.80 (queda para prejuízo)
    const exchange = {
      candles: async () => candles31,
      rules: async () => ({ minNotional: 1, minQty: 1, stepSize: 1 }),
      price: async () => 29.80, // Preço desabou abaixo de snapshot e de entry
      placeMarketOrder: async () => {
        orderPlaced = true;
        throw new Error('Must not place order');
      },
      orderByClientId: async () => null,
    };

    const ai = {
      decide: async () => ({
        decision: { action: 'SELL' as const, amountUsdt: 93.0, confidence: 0.95, reason: 'take profit at 31', rawResponse: null },
        usage: { modelRequested: 'test-model', latencyMs: 50, promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, error: null, fallbackUsed: false },
      }),
    };

    const service = new TradingService(repo as never, exchange as never, ai as never);
    const result = await service.runOnce(new Date('2026-10-01T12:00:00Z'));

    expect(result.action).toBe('HOLD');
    expect(savedDecisionAction).toBe('HOLD');
    expect(orderPlaced).toBe(false);
    expect(events.some(e => e.type === 'decision_rejected_by_risk' && String(e.metadata?.brokerPrice) === '29.8')).toBe(true);
  });
});
