import { describe, expect, it } from 'vitest';
import { nextCycleAt, reconciliationRetryDelay } from '../apps/worker/src/scheduler.ts';

describe('worker scheduler', () => {
  it('uses stable wall-clock slots and skips a delayed slot without a full extra interval', () => {
    expect(nextCycleAt('TRADING', new Date('2026-10-01T12:00:03Z')).toISOString()).toBe('2026-10-01T12:03:00.000Z');
    // A cycle that ends at 09:04 São Paulo resumes at the 09:06 expected slot,
    // not at 09:07 after another full three-minute interval.
    expect(nextCycleAt('TRADING', new Date('2026-10-01T12:04:00Z')).toISOString()).toBe('2026-10-01T12:06:00.000Z');
  });

  it('caps a normal cycle at the next session boundary', () => {
    expect(nextCycleAt('TRADING', new Date('2026-10-01T20:49:59Z')).toISOString()).toBe('2026-10-01T20:50:00.000Z');
  });

  it('keeps reconciliation retries continuous with a capped backoff', () => {
    expect(reconciliationRetryDelay(1)).toBe(30_000);
    expect(reconciliationRetryDelay(3)).toBe(120_000);
    expect(reconciliationRetryDelay(4)).toBe(240_000);
    expect(reconciliationRetryDelay(5)).toBe(300_000);
    expect(reconciliationRetryDelay(20)).toBe(300_000);
  });
});
