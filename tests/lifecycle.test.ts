import { describe, expect, it } from 'vitest';
import { finishDailyIfPositionClosed } from '../apps/worker/src/lifecycle.ts';

describe('daily finalization', () => {
  it('does not create a daily result while a conceptual position remains open', async () => {
    let open = true;
    let createCalls = 0;
    let priceCalls = 0;
    const repo = {
      openPosition: async () => open ? { id: 1 } : null,
      dailyResult: async () => null,
      createDailyResult: async (price: number) => { createCalls++; expect(price).toBe(99_999); return { session_day: '2026-10-01' }; },
      event: async () => {},
    };
    const exchange = { price: async () => { priceCalls++; return 99_999; } };
    expect(await finishDailyIfPositionClosed(repo, exchange as never, new Date('2026-10-01T21:00:00Z'))).toBe(false);
    expect(createCalls).toBe(0);
    open = false;
    expect(await finishDailyIfPositionClosed(repo, exchange as never, new Date('2026-10-01T21:03:00Z'))).toBe(true);
    expect(createCalls).toBe(1);
    expect(priceCalls).toBe(1);
  });

  it('leaves no pending consolidation marker after the session ends (BUG-10 parte C)', async () => {
    // Mirrors the real repository: the pending marker is written before the
    // consolidation transaction, which flips the status to OK on success.
    let consolidationStatus: 'PENDING' | 'OK' | 'ERROR' | null = 'PENDING';
    const events: string[] = [];
    const repo = {
      openPosition: async () => null,
      dailyResult: async () => null,
      markDailyResultPending: async () => { consolidationStatus = 'PENDING'; },
      markDailyResultOk: async () => { consolidationStatus = 'OK'; },
      markDailyResultFailed: async () => { consolidationStatus = 'ERROR'; },
      createDailyResult: async () => ({ session_day: '2026-10-01' }),
      event: async (_level: string, type: string) => { events.push(type); },
    };
    const exchange = { price: async () => 30.25 };

    expect(await finishDailyIfPositionClosed(repo, exchange as never, new Date('2026-10-01T21:05:00Z'))).toBe(true);

    expect(consolidationStatus).toBe('OK');
    expect(consolidationStatus).not.toBe('PENDING');
    expect(events).toContain('daily_result_created');
  });

  it('fails closed instead of reporting success when no daily_result row was persisted', async () => {
    // A void/null result used to be treated as success, which stranded the
    // session in `PENDING` with no scheduled retry. It must now raise so the
    // worker retries the consolidation instead of silently giving up.
    let consolidationStatus: 'PENDING' | 'OK' | 'ERROR' | null = 'PENDING';
    const events: string[] = [];
    const repo = {
      openPosition: async () => null,
      dailyResult: async () => null,
      markDailyResultPending: async () => { consolidationStatus = 'PENDING'; },
      markDailyResultOk: async () => { consolidationStatus = 'OK'; },
      markDailyResultFailed: async () => { consolidationStatus = 'ERROR'; },
      createDailyResult: async () => null,
      event: async (_level: string, type: string) => { events.push(type); },
    };
    const exchange = { price: async () => 30.25 };

    await expect(finishDailyIfPositionClosed(repo, exchange as never, new Date('2026-10-01T21:05:00Z')))
      .rejects.toThrow('no persisted daily_result');

    expect(consolidationStatus).toBe('ERROR');
    expect(events).toContain('daily_result_failed');
  });

  it('keeps an already consolidated day OK without rewriting the daily result', async () => {
    let consolidationStatus: 'PENDING' | 'OK' | 'ERROR' | null = 'PENDING';
    let createCalls = 0;
    const repo = {
      openPosition: async () => null,
      dailyResult: async () => ({ session_day: '2026-10-01' }),
      markDailyResultPending: async () => { consolidationStatus = 'PENDING'; },
      markDailyResultOk: async () => { consolidationStatus = 'OK'; },
      markDailyResultFailed: async () => { consolidationStatus = 'ERROR'; },
      createDailyResult: async () => { createCalls++; return { session_day: '2026-10-01' }; },
      event: async () => {},
    };
    const exchange = { price: async () => 30.25 };

    expect(await finishDailyIfPositionClosed(repo, exchange as never, new Date('2026-10-01T21:05:00Z'))).toBe(true);

    expect(createCalls).toBe(0);
    expect(consolidationStatus).toBe('OK');
  });
});
