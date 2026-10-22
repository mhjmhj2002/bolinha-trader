import { entryTimeframes } from '@bolinha/core';
import type { EntryTimeframe } from '@bolinha/core';

export interface Candle { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number }
export type Relation = 'EMA9_ABOVE_EMA21' | 'EMA9_BELOW_EMA21' | 'EMA_EQUAL';
export type RsiState = 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
export type ReturnState = 'UP' | 'DOWN' | 'FLAT';
export type VolumeState = 'HIGH' | 'NORMAL' | 'LOW';
export interface IndicatorSet { price: number; ema9: number; ema21: number; rsi14: number; return1: number; return3: number; return12: number; volume: number; volumeAvg20: number; volumeRatio: number; high20: number; low20: number; emaRelation: Relation; rsiState: RsiState; shortReturnState: ReturnState; volumeState: VolumeState }
export interface MarketSnapshot { symbol: string; capturedAt: string; intervals: Record<'1m' | '5m' | '15m', IndicatorSet> }
export function ema(values: number[], period: number): number {
  if (values.length < period) throw new Error(`Need ${period} candles`);
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return values.slice(period).reduce((e, v) => v * k + e * (1 - k), seed);
}
export function rsi(values: number[], period = 14): number {
  if (values.length <= period) throw new Error('Need RSI candles');
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d;
    else if (d < 0) losses += -d;
  }
  if (gains === 0 && losses === 0) return 50; // Mercado estável/sem variação
  if (losses === 0) {
    // Suavização para evitar saturação extrema em 100 cravado quando a variação for minúscula
    const avgGain = gains / period;
    const epsilonLoss = Math.max(avgGain * 0.01, 1e-4);
    const rs = avgGain / epsilonLoss;
    return Number((100 - (100 / (1 + rs))).toFixed(2));
  }
  if (gains === 0) {
    const avgLoss = losses / period;
    const epsilonGain = Math.max(avgLoss * 0.01, 1e-4);
    const rs = epsilonGain / avgLoss;
    return Number((100 - (100 / (1 + rs))).toFixed(2));
  }
  const rs = gains / losses;
  return Number((100 - (100 / (1 + rs))).toFixed(2));
}
export function returnPercent(values: number[], periods: number): number { const current=values.at(-1)!; const previous=values.at(-(periods+1))!; return ((current-previous)/previous)*100; }
export function returnState(value: number): ReturnState { return value > 0.02 ? 'UP' : value < -0.02 ? 'DOWN' : 'FLAT'; }
export function calculateIndicators(candles: Candle[]): IndicatorSet { if(candles.length<22) throw new Error('At least 22 candles required'); const closes=candles.map(c=>c.close); const last=candles.at(-1)!; const last20=candles.slice(-20); const e9=ema(closes,9),e21=ema(closes,21), r=rsi(closes); const avg=last20.reduce((s,c)=>s+c.volume,0)/20; const ret=returnPercent(closes,1); return { price:last.close,ema9:e9,ema21:e21,rsi14:r,return1:ret,return3:returnPercent(closes,3),return12:returnPercent(closes,12),volume:last.volume,volumeAvg20:avg,volumeRatio: last.volume/avg,high20:Math.max(...last20.map(c=>c.high)),low20:Math.min(...last20.map(c=>c.low)),emaRelation:e9>e21?'EMA9_ABOVE_EMA21':e9<e21?'EMA9_BELOW_EMA21':'EMA_EQUAL',rsiState:r>=70?'OVERBOUGHT':r<=30?'OVERSOLD':'NEUTRAL',shortReturnState:returnState(ret),volumeState:last.volume/avg>1.3?'HIGH':last.volume/avg<0.7?'LOW':'NORMAL'}; }
export function makeSnapshot(symbol: string, candles: Record<'1m'|'5m'|'15m', Candle[]>): MarketSnapshot { return { symbol, capturedAt:new Date().toISOString(), intervals: { '1m':calculateIndicators(candles['1m']), '5m':calculateIndicators(candles['5m']), '15m':calculateIndicators(candles['15m']) } }; }

export { entryTimeframes };
export type { EntryTimeframe };

export interface EntryConfluenceOptions {
  /** Timeframes evaluated by the filter (configured through ENTRY_TIMEFRAMES). */
  timeframes: readonly EntryTimeframe[];
  /** How many of the evaluated timeframes must be confluent. Defaults to all of them (strictest). */
  minConfluentTimeframes?: number;
  /** RSI14 level at or above which a timeframe is overbought and therefore blocks a BUY. */
  rsiOverboughtThreshold?: number;
}

export interface TimeframeConfluenceCheck {
  timeframe: EntryTimeframe;
  /** True only when the timeframe has valid indicators AND is bullish aligned AND not overbought. */
  confluent: boolean;
  /** False when candles/indicators are missing or carry non-finite values (fail-closed). */
  valid: boolean;
  emaAligned: boolean;
  rsiAcceptable: boolean;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  /** Human readable reason for a non-confluent timeframe. */
  detail: string | null;
}

export interface EntryConfluenceResult {
  /** True only when every piece of data was valid and the required confluence count was reached. */
  allowed: boolean;
  valid: boolean;
  requiredCount: number;
  confluentCount: number;
  confluentTimeframes: EntryTimeframe[];
  /** Explanation persisted in ai_decisions.rejection_reason and in the worker logs. */
  reason: string;
  checks: TimeframeConfluenceCheck[];
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const normalisedTimeframes = (options: EntryConfluenceOptions): EntryTimeframe[] =>
  options.timeframes.length ? [...options.timeframes] : [...entryTimeframes];

const inspectTimeframe = (
  timeframe: EntryTimeframe,
  indicator: IndicatorSet | null | undefined,
  rsiOverboughtThreshold: number,
  dataError?: string,
): TimeframeConfluenceCheck => {
  const blocked = (detail: string): TimeframeConfluenceCheck => ({
    timeframe,
    confluent: false,
    valid: false,
    emaAligned: false,
    rsiAcceptable: false,
    ema9: null,
    ema21: null,
    rsi14: null,
    detail,
  });
  if (dataError) return blocked(dataError);
  if (!indicator) return blocked('indicators unavailable');
  const { ema9, ema21, rsi14 } = indicator;
  if (!isFiniteNumber(ema9) || !isFiniteNumber(ema21) || !isFiniteNumber(rsi14))
    return blocked('indicators are not finite numbers (NaN/null)');
  const emaAligned = ema9 > ema21;
  const rsiAcceptable = rsi14 < rsiOverboughtThreshold;
  const details = [
    emaAligned ? null : `EMA9 ${ema9.toFixed(4)} <= EMA21 ${ema21.toFixed(4)}`,
    rsiAcceptable ? null : `RSI14 ${rsi14.toFixed(2)} >= overbought ${rsiOverboughtThreshold}`,
  ].filter((value): value is string => value !== null);
  return {
    timeframe,
    confluent: details.length === 0,
    valid: true,
    emaAligned,
    rsiAcceptable,
    ema9,
    ema21,
    rsi14,
    detail: details.length ? details.join('; ') : null,
  };
};

/**
 * Deterministic multi-timeframe confluence gate for BUY entries: EMA9 must be
 * above EMA21 and RSI14 must not be overbought on every evaluated timeframe.
 * Missing, insufficient or non-finite data is never optimistic: it invalidates
 * the whole evaluation so the caller must hold.
 */
export function evaluateEntryConfluence(
  intervals: Partial<Record<EntryTimeframe, IndicatorSet | null | undefined>>,
  options: EntryConfluenceOptions,
  dataErrors: Partial<Record<EntryTimeframe, string>> = {},
): EntryConfluenceResult {
  const timeframes = normalisedTimeframes(options);
  const rsiOverboughtThreshold = options.rsiOverboughtThreshold ?? 70;
  const configuredMinimum = options.minConfluentTimeframes ?? timeframes.length;
  const requiredCount = Math.min(timeframes.length, Math.max(1, Math.trunc(configuredMinimum)));
  const checks = timeframes.map((timeframe) =>
    inspectTimeframe(timeframe, intervals[timeframe], rsiOverboughtThreshold, dataErrors[timeframe]),
  );
  const confluentTimeframes = checks.filter((check) => check.confluent).map((check) => check.timeframe);
  const confluentCount = confluentTimeframes.length;
  const valid = checks.every((check) => check.valid);
  const blockedDetails = checks
    .filter((check) => !check.confluent)
    .map((check) => `${check.timeframe} ${check.detail ?? 'no confluence'}`);
  const allowed = valid && confluentCount >= requiredCount;
  const summary = `${confluentCount}/${requiredCount} confluent timeframe(s) of ${timeframes.join(', ')}`;
  return {
    allowed,
    valid,
    requiredCount,
    confluentCount,
    confluentTimeframes,
    reason: allowed ? `entry confluence met (${summary})` : `entry confluence not met (${summary}): ${blockedDetails.join(' | ')}`,
    checks,
  };
}

/**
 * Candle-level entry point of the same gate: it derives the indicators for each
 * configured timeframe and converts any calculation failure (not enough
 * candles, invalid series) into a fail-closed, non-confluent result instead of
 * throwing an optimistic BUY path.
 */
export function evaluateCandlesEntryConfluence(
  candles: Partial<Record<EntryTimeframe, Candle[] | null | undefined>>,
  options: EntryConfluenceOptions,
): EntryConfluenceResult {
  const intervals: Partial<Record<EntryTimeframe, IndicatorSet | null>> = {};
  const dataErrors: Partial<Record<EntryTimeframe, string>> = {};
  for (const timeframe of normalisedTimeframes(options)) {
    const series = candles[timeframe];
    if (!Array.isArray(series) || series.length === 0) {
      dataErrors[timeframe] = 'candles unavailable';
      continue;
    }
    try {
      intervals[timeframe] = calculateIndicators(series);
    } catch (error) {
      dataErrors[timeframe] = error instanceof Error ? error.message : 'indicator calculation failed';
    }
  }
  return evaluateEntryConfluence(intervals, options, dataErrors);
}
