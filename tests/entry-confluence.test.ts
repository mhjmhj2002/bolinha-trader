import { describe, expect, it } from 'vitest';
import {
  calculateIndicators,
  evaluateCandlesEntryConfluence,
  evaluateEntryConfluence,
  type Candle,
  type IndicatorSet,
} from '@bolinha/market-data';
import { applyB3Risk, type B3RiskInput } from '@bolinha/risk-engine';

const toCandles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    openTime: i,
    closeTime: i,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
  }));

/**
 * Flat base followed by a repeating step pattern. `[0.05, 0.05, -0.05]` keeps
 * EMA9 above EMA21 with RSI14 ≈ 64 (bullish, not overbought); the mirrored
 * pattern keeps EMA9 below EMA21 with RSI14 ≈ 36.
 */
const patternedCandles = (steps: readonly number[], start = 30): Candle[] => {
  const closes = [start];
  for (let i = 0; i < 21; i++) closes.push(start);
  for (let i = 0; i < 21; i++) closes.push(Number((closes.at(-1)! + steps[i % steps.length]).toFixed(4)));
  return toCandles(closes);
};

/** Bullish and not overbought: EMA9 > EMA21 and RSI14 ≈ 64. */
const bullishCandles = (): Candle[] => patternedCandles([0.05, 0.05, -0.05]);
/** Bearish alignment: EMA9 < EMA21 and RSI14 ≈ 36. */
const bearishCandles = (): Candle[] => patternedCandles([-0.05, -0.05, 0.05]);
/** Overbought rally: EMA9 > EMA21 but RSI14 ≈ 99. */
const overboughtCandles = (): Candle[] => patternedCandles([0.2]);

const indicator = (overrides: Partial<IndicatorSet>): IndicatorSet => ({
  ...calculateIndicators(bullishCandles()),
  ...overrides,
});

const timeframes = ['1m', '5m', '15m'] as const;
const strictOptions = { timeframes: [...timeframes], minConfluentTimeframes: 3, rsiOverboughtThreshold: 70 };

const baseRisk: Omit<B3RiskInput, 'entryConfluence'> = {
  action: 'BUY',
  requestedBrl: 100,
  price: 10,
  account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 },
  position: null,
  rules: { minNotional: 1, minQty: 1, stepSize: 1 },
  maxPositionPercent: 100,
  duplicateOrderPending: false,
};

describe('multi-timeframe entry confluence', () => {
  it('(a) allows the BUY when EMA9 > EMA21 and RSI is not overbought on 1m, 5m and 15m', () => {
    const candles = bullishCandles();
    const confluence = evaluateCandlesEntryConfluence(
      { '1m': candles, '5m': candles, '15m': candles },
      strictOptions,
    );

    expect(confluence.valid).toBe(true);
    expect(confluence.allowed).toBe(true);
    expect(confluence.requiredCount).toBe(3);
    expect(confluence.confluentTimeframes).toEqual(['1m', '5m', '15m']);
    expect(confluence.reason).toContain('entry confluence met');

    const risk = applyB3Risk({ ...baseRisk, entryConfluence: confluence });
    expect(risk.action).toBe('BUY');
    expect(risk.rejectionReason).toBeNull();
  });

  it('(b) blocks the BUY to HOLD when the higher timeframes are not aligned', () => {
    const confluence = evaluateCandlesEntryConfluence(
      { '1m': bullishCandles(), '5m': bearishCandles(), '15m': bearishCandles() },
      strictOptions,
    );

    expect(confluence.valid).toBe(true);
    expect(confluence.allowed).toBe(false);
    expect(confluence.confluentCount).toBe(1);

    const risk = applyB3Risk({ ...baseRisk, entryConfluence: confluence });
    expect(risk.action).toBe('HOLD');
    expect(risk.amountBrl).toBe(0);
    expect(risk.quantity).toBe(0);
    expect(risk.rejectionReason).toContain('BUY rejected by multi-timeframe entry filter');
    expect(risk.rejectionReason).toContain('5m');
    expect(risk.rejectionReason).toContain('15m');
  });

  it('(b) blocks the BUY to HOLD when RSI is overbought on a required timeframe', () => {
    const confluence = evaluateCandlesEntryConfluence(
      { '1m': bullishCandles(), '5m': bullishCandles(), '15m': overboughtCandles() },
      strictOptions,
    );

    expect(confluence.allowed).toBe(false);
    expect(confluence.checks.find((check) => check.timeframe === '15m')).toMatchObject({
      confluent: false,
      rsiAcceptable: false,
    });

    const risk = applyB3Risk({ ...baseRisk, entryConfluence: confluence });
    expect(risk.action).toBe('HOLD');
    expect(risk.rejectionReason).toContain('RSI14');
    expect(risk.rejectionReason).toContain('overbought');
  });

  it('(c) fails closed to HOLD when a timeframe has insufficient candles', () => {
    const confluence = evaluateCandlesEntryConfluence(
      { '1m': bullishCandles(), '5m': bullishCandles().slice(0, 10), '15m': bullishCandles() },
      strictOptions,
    );

    expect(confluence.valid).toBe(false);
    expect(confluence.allowed).toBe(false);
    expect(confluence.checks.find((check) => check.timeframe === '5m')).toMatchObject({ valid: false });
    expect(confluence.reason).toContain('22 candles');

    const risk = applyB3Risk({ ...baseRisk, entryConfluence: confluence });
    expect(risk.action).toBe('HOLD');
    expect(risk.rejectionReason).toContain('BUY rejected by multi-timeframe entry filter');
  });

  it('(c) fails closed to HOLD on a missing series or a fetch error', () => {
    const missing = evaluateCandlesEntryConfluence(
      { '1m': bullishCandles(), '5m': undefined, '15m': bullishCandles() },
      strictOptions,
    );
    expect(missing.valid).toBe(false);
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toContain('candles unavailable');
    expect(applyB3Risk({ ...baseRisk, entryConfluence: missing }).action).toBe('HOLD');

    const fetchError = evaluateCandlesEntryConfluence({ '1m': bullishCandles(), '15m': bullishCandles() }, strictOptions, {
      '5m': 'candle fetch failed',
    });
    expect(fetchError.allowed).toBe(false);
    expect(applyB3Risk({ ...baseRisk, entryConfluence: fetchError }).action).toBe('HOLD');
  });

  it('(c) fails closed to HOLD on non-finite (NaN) indicators', () => {
    const confluence = evaluateEntryConfluence(
      { '1m': indicator({}), '5m': indicator({ ema9: Number.NaN }), '15m': indicator({}) },
      strictOptions,
    );

    expect(confluence.valid).toBe(false);
    expect(confluence.allowed).toBe(false);
    expect(confluence.reason).toContain('NaN');

    const risk = applyB3Risk({ ...baseRisk, entryConfluence: confluence });
    expect(risk.action).toBe('HOLD');
    expect(risk.rejectionReason).toContain('BUY rejected by multi-timeframe entry filter');
  });

  it('fails closed when confluence is required but no result was provided', () => {
    const risk = applyB3Risk({ ...baseRisk, requireEntryConfluence: true });
    expect(risk.action).toBe('HOLD');
    expect(risk.rejectionReason).toContain('BUY rejected by multi-timeframe entry filter');
    expect(risk.rejectionReason).toContain('fail-closed');
  });

  it('defaults to requiring every configured timeframe when no minimum is set', () => {
    const confluence = evaluateCandlesEntryConfluence(
      { '1m': bullishCandles(), '5m': bearishCandles(), '15m': bearishCandles() },
      { timeframes: [...timeframes] },
    );
    expect(confluence.requiredCount).toBe(3);
    expect(confluence.allowed).toBe(false);
  });

  it('keeps SELL/HOLD decisions untouched by the entry filter', () => {
    const blocked = evaluateCandlesEntryConfluence(
      { '1m': bearishCandles(), '5m': bearishCandles(), '15m': bearishCandles() },
      strictOptions,
    );
    const risk = applyB3Risk({
      ...baseRisk,
      action: 'HOLD',
      entryConfluence: blocked,
    });
    expect(risk.action).toBe('HOLD');
    expect(risk.rejectionReason).toBe('AI requested HOLD');
  });
});
