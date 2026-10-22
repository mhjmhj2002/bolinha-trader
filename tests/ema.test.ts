import { describe, expect, it } from 'vitest';
import { ema } from '@bolinha/market-data';

/**
 * Reference implementation used ONLY to assert the exact EMA semantics independently
 * from the production code (see `packages/market-data/src/index.ts`).
 * SMA seed over the first `period` values, then the standard recursive smoothing
 * factor k = 2 / (period + 1).
 */
function referenceEma(values: number[], period: number): number {
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return values.slice(period).reduce((e, v) => v * k + e * (1 - k), seed);
}

describe('ema', () => {
  // REGRESSION GUARD for BUG-10 (EMA com seed duplicada).
  // The buggy implementation used the SMA seed AND folded the seeding window into the
  // recursive reduction, double-counting the price: a flat series of 30.0 produced an
  // EMA of ~60.0 instead of 30.0. The doubled EMA9/EMA21 pair then generated phantom
  // crossovers, triggering BUY decisions at money-losing noise tops.
  // If this test ever fails with ~60.0 vs 30.0, the double-seed bug is BACK.
  it('stays within the price range (no double-counted seed)', () => {
    const values = Array.from({ length: 40 }, () => 30.0);
    expect(ema(values, 9)).toBeCloseTo(30, 6);
    expect(ema(values, 21)).toBeCloseTo(30, 6);
  });

  // Exact semantics: EMA must equal the SMA-seeded recursion with k = 2 / (period + 1).
  it('matches the SMA-seeded recursion with k = 2 / (period + 1)', () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i * 1.5);
    expect(ema(values, 9)).toBeCloseTo(referenceEma(values, 9), 10);
    expect(ema(values, 21)).toBeCloseTo(referenceEma(values, 21), 10);
    // Sanity: a SMA-only (non-EMA) value would drift away from the recursive result.
    const sma = values.slice(0, 21).reduce((a, b) => a + b, 0) / 21;
    expect(Math.abs(ema(values, 21) - sma)).toBeGreaterThan(1);
  });

  // Fail-closed guard: an insufficient window must never silently return a value.
  it('throws when there are fewer values than the period', () => {
    const values = Array.from({ length: 20 }, () => 30.0);
    expect(() => ema(values, 21)).toThrow(/Need 21 candles/);
  });

  it('rises above the slow EMA in an uptrend', () => {
    const values = Array.from({ length: 40 }, (_, i) => 30 + i * 0.01);
    expect(ema(values, 9)).toBeGreaterThan(ema(values, 21));
    expect(ema(values, 9)).toBeLessThan(values.at(-1)!);
  });
});
