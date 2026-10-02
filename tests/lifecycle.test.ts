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
});
