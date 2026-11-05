import { b3RequiredPriceForNetTarget, entryTimeframes } from '@bolinha/core';
import type { EntryTimeframe } from '@bolinha/core';

export interface Candle { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number }
export type Relation = 'EMA9_ABOVE_EMA21' | 'EMA9_BELOW_EMA21' | 'EMA_EQUAL';
export type RsiState = 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
export type ReturnState = 'UP' | 'DOWN' | 'FLAT';
export type VolumeState = 'HIGH' | 'NORMAL' | 'LOW';
export interface IndicatorSet { price: number; ema9: number; ema21: number; rsi14: number; return1: number; return3: number; return12: number; volume: number; volumeAvg20: number; volumeRatio: number; high20: number; low20: number; emaRelation: Relation; rsiState: RsiState; shortReturnState: ReturnState; volumeState: VolumeState; vwap?: number; atr?: number }
export interface MarketSnapshot { symbol: string; capturedAt: string; intervals: Record<'1m' | '5m' | '15m', IndicatorSet>; vwap?: number; atr?: number }

/**
 * Calcula a VWAP (Volume Weighted Average Price) a partir de uma série de candles:
 * VWAP = Σ(Preço Típico * Volume) / Σ(Volume)
 * Onde Preço Típico = (High + Low + Close) / 3.
 * Retorna 2 casas decimais normalizadas, ou o último close caso o volume total seja 0.
 */
export function calculateVWAP(candles: Candle[]): number {
  if (!candles || candles.length === 0) throw new Error('Need at least 1 candle for VWAP');
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0;
    cumulativeTypicalVolume += typicalPrice * vol;
    cumulativeVolume += vol;
  }

  if (cumulativeVolume <= 0) {
    return Number(candles[candles.length - 1].close.toFixed(2));
  }

  return Number((cumulativeTypicalVolume / cumulativeVolume).toFixed(2));
}

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
/**
 * Calcula o ATR (Average True Range) a partir de uma série de candles:
 * TR_t = max(High_t - Low_t, |High_t - Close_{t-1}|, |Low_t - Close_{t-1}|)
 * Para o primeiro candle da série (sem anterior), TR = High - Low.
 * ATR clássico de Wilder (RMA - Running Moving Average) com período N (padrão 14).
 * Retorna o valor numérico com 4 casas decimais.
 */
export function calculateATR(candles: Candle[], period = 14): number {
  if (!candles || candles.length < period) {
    throw new Error(`Need at least ${period} candles for ATR`);
  }

  // Calcula os True Ranges
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      trs.push(c.high - c.low);
    } else {
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      );
      trs.push(tr);
    }
  }

  // Primeiro ATR é a média simples dos primeiros `period` TRs
  let currentAtr = trs.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

  // Suavização clássica de Wilder para os passos subsequentes: ATR_t = (ATR_{t-1} * (period - 1) + TR_t) / period
  for (let i = period; i < trs.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trs[i]) / period;
  }

  return Number(currentAtr.toFixed(4));
}

export function returnPercent(values: number[], periods: number): number { const current=values.at(-1)!; const previous=values.at(-(periods+1))!; return ((current-previous)/previous)*100; }
export function returnState(value: number): ReturnState { return value > 0.02 ? 'UP' : value < -0.02 ? 'DOWN' : 'FLAT'; }
export function calculateIndicators(candles: Candle[]): IndicatorSet {
  if(candles.length<22) throw new Error('At least 22 candles required');
  const closes=candles.map(c=>c.close);
  const last=candles.at(-1)!;
  const last20=candles.slice(-20);
  const e9=ema(closes,9),e21=ema(closes,21), r=rsi(closes);
  const avg=last20.reduce((s,c)=>s+c.volume,0)/20;
  const ret=returnPercent(closes,1);
  const atrVal = calculateATR(candles, 14);
  return {
    price:last.close,
    ema9:e9,
    ema21:e21,
    rsi14:r,
    return1:ret,
    return3:returnPercent(closes,3),
    return12:returnPercent(closes,12),
    volume:last.volume,
    volumeAvg20:avg,
    volumeRatio: last.volume/avg,
    high20:Math.max(...last20.map(c=>c.high)),
    low20:Math.min(...last20.map(c=>c.low)),
    emaRelation:e9>e21?'EMA9_ABOVE_EMA21':e9<e21?'EMA9_BELOW_EMA21':'EMA_EQUAL',
    rsiState:r>=70?'OVERBOUGHT':r<=30?'OVERSOLD':'NEUTRAL',
    shortReturnState:returnState(ret),
    volumeState:last.volume/avg>1.3?'HIGH':last.volume/avg<0.7?'LOW':'NORMAL',
    atr: atrVal,
  };
}
export function makeSnapshot(symbol: string, candles: Record<'1m'|'5m'|'15m', Candle[]>): MarketSnapshot {
  const vwapValue = candles['1m'] && candles['1m'].length > 0 ? calculateVWAP(candles['1m']) : undefined;
  const ind1m = calculateIndicators(candles['1m']);
  if (vwapValue !== undefined) ind1m.vwap = vwapValue;
  const ind5m = calculateIndicators(candles['5m']);
  const ind15m = calculateIndicators(candles['15m']);
  const atrValue = ind5m.atr ?? ind1m.atr;
  return {
    symbol,
    capturedAt: new Date().toISOString(),
    vwap: vwapValue,
    atr: atrValue,
    intervals: {
      '1m': ind1m,
      '5m': ind5m,
      '15m': ind15m,
    },
  };
}

export { entryTimeframes };
export type { EntryTimeframe };

export interface EntryConfluenceOptions {
  /** Timeframes evaluated by the filter (configured through ENTRY_TIMEFRAMES). */
  timeframes: readonly EntryTimeframe[];
  /** How many of the evaluated timeframes must be confluent. Defaults to all of them (strictest). */
  minConfluentTimeframes?: number;
  /** RSI14 level at or above which a timeframe is overbought and therefore blocks a BUY. */
  rsiOverboughtThreshold?: number;
  /** TASK-37: Nível mínimo de RSI (ex: 35 ou 40) para evitar comprar faca caindo / queda livre. Default 0 (desativado). */
  rsiOversoldThreshold?: number;
  /** TASK-37: Distância máxima percentual permitida acima da VWAP (ex: 0.015 para 1.5%). Acima disso o preço está esticado. */
  maxVwapDistancePct?: number;
  /** TASK-37: Distância máxima percentual permitida acima da EMA21 (ex: 0.015 para 1.5%). Previne compras no topo de esticadas. */
  maxEmaDistancePct?: number;
  /** Se deve exigir que o preço atual esteja acima ou igual à VWAP diária. Default: true. */
  requireVwapAbove?: boolean;
  /** Valor da VWAP a ser comparado contra o preço atual. Se não fornecido em evaluateEntryConfluence, é ignorado ou calculado a partir dos candles. */
  vwap?: number | null;
  /** Preço atual para comparação com a VWAP. */
  currentPrice?: number | null;
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
  /** Distância percentual do preço para a EMA21 */
  emaDistancePct?: number | null;
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
  /** Valor da VWAP avaliada (quando aplicável). */
  vwap?: number | null;
  /** Se o preço respeitou a VWAP (currentPrice >= vwap). */
  vwapAcceptable?: boolean;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const normalisedTimeframes = (options: EntryConfluenceOptions): EntryTimeframe[] =>
  options.timeframes.length ? [...options.timeframes] : [...entryTimeframes];

const inspectTimeframe = (
  timeframe: EntryTimeframe,
  indicator: IndicatorSet | null | undefined,
  rsiOverboughtThreshold: number,
  rsiOversoldThreshold: number,
  maxEmaDistancePct?: number,
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
    emaDistancePct: null,
    detail,
  });
  if (dataError) return blocked(dataError);
  if (!indicator) return blocked('indicators unavailable');
  const { ema9, ema21, rsi14, price } = indicator;
  if (!isFiniteNumber(ema9) || !isFiniteNumber(ema21) || !isFiniteNumber(rsi14))
    return blocked('indicators are not finite numbers (NaN/null)');
  const emaAligned = ema9 > ema21;
  const rsiAcceptable = rsi14 < rsiOverboughtThreshold && (rsiOversoldThreshold <= 0 || rsi14 >= rsiOversoldThreshold);
  const emaDistancePct = isFiniteNumber(price) && ema21 > 0 ? (price - ema21) / ema21 : null;
  const emaDistanceAcceptable = maxEmaDistancePct === undefined || maxEmaDistancePct <= 0 || emaDistancePct === null || emaDistancePct <= maxEmaDistancePct;

  const details = [
    emaAligned ? null : `EMA9 ${ema9.toFixed(4)} <= EMA21 ${ema21.toFixed(4)}`,
    rsi14 >= rsiOverboughtThreshold ? `RSI14 ${rsi14.toFixed(2)} >= overbought ${rsiOverboughtThreshold}` : null,
    rsiOversoldThreshold > 0 && rsi14 < rsiOversoldThreshold ? `RSI14 ${rsi14.toFixed(2)} < oversold threshold ${rsiOversoldThreshold} (falling knife / strong downtrend)` : null,
    !emaDistanceAcceptable && emaDistancePct !== null ? `Price extended ${((emaDistancePct) * 100).toFixed(2)}% above EMA21 (max allowed ${(maxEmaDistancePct! * 100).toFixed(2)}%)` : null,
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
    emaDistancePct,
    detail: details.length ? details.join('; ') : null,
  };
};

/**
 * Deterministic multi-timeframe confluence gate for BUY entries: EMA9 must be
 * above EMA21, RSI14 must not be overbought or oversold falling-knife, and price
 * must not be overextended from EMA/VWAP on evaluated timeframes.
 * Adicionalmente, quando requireVwapAbove = true (padrão true), o preço deve
 * estar maior ou igual à VWAP diária (currentPrice >= vwap).
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
  const rsiOversoldThreshold = options.rsiOversoldThreshold ?? 0;
  const maxEmaDistancePct = options.maxEmaDistancePct;
  const maxVwapDistancePct = options.maxVwapDistancePct;
  const requireVwapAbove = options.requireVwapAbove ?? true;
  const configuredMinimum = options.minConfluentTimeframes ?? timeframes.length;
  const requiredCount = Math.min(timeframes.length, Math.max(1, Math.trunc(configuredMinimum)));
  const checks = timeframes.map((timeframe) =>
    inspectTimeframe(
      timeframe,
      intervals[timeframe],
      rsiOverboughtThreshold,
      rsiOversoldThreshold,
      maxEmaDistancePct,
      dataErrors[timeframe],
    ),
  );
  const confluentTimeframes = checks.filter((check) => check.confluent).map((check) => check.timeframe);
  const confluentCount = confluentTimeframes.length;
  const valid = checks.every((check) => check.valid);
  const blockedDetails = checks
    .filter((check) => !check.confluent)
    .map((check) => `${check.timeframe} ${check.detail ?? 'no confluence'}`);

  let vwapAcceptable = true;
  let vwapRejectReason: string | null = null;
  const vwapValue = options.vwap ?? intervals['1m']?.vwap ?? null;
  const priceValue = options.currentPrice ?? intervals['1m']?.price ?? null;

  if (vwapValue !== null && vwapValue !== undefined && priceValue !== null && priceValue !== undefined) {
    if (requireVwapAbove && priceValue < vwapValue) {
      vwapAcceptable = false;
      vwapRejectReason = `BUY rejected: Price R$ ${priceValue.toFixed(2)} is below daily VWAP R$ ${vwapValue.toFixed(2)}`;
      blockedDetails.push(vwapRejectReason);
    } else if (typeof maxVwapDistancePct === 'number' && maxVwapDistancePct > 0) {
      const vwapDist = (priceValue - vwapValue) / vwapValue;
      if (vwapDist > maxVwapDistancePct) {
        vwapAcceptable = false;
        vwapRejectReason = `BUY rejected: Price R$ ${priceValue.toFixed(2)} is overextended (${(vwapDist * 100).toFixed(2)}% > max ${(maxVwapDistancePct * 100).toFixed(2)}%) above VWAP R$ ${vwapValue.toFixed(2)}`;
        blockedDetails.push(vwapRejectReason);
      }
    }
  }

  const allowed = valid && confluentCount >= requiredCount && vwapAcceptable;
  const summary = `${confluentCount}/${requiredCount} confluent timeframe(s) of ${timeframes.join(', ')}`;
  let reason: string;
  if (!allowed) {
    if (!vwapAcceptable && valid && confluentCount >= requiredCount && vwapRejectReason) {
      reason = vwapRejectReason;
    } else {
      reason = `entry confluence not met (${summary}): ${blockedDetails.join(' | ')}`;
    }
  } else {
    reason = `entry confluence met (${summary})`;
  }

  return {
    allowed,
    valid,
    requiredCount,
    confluentCount,
    confluentTimeframes,
    reason,
    checks,
    vwap: vwapValue,
    vwapAcceptable,
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
  dataErrorsPassed: Partial<Record<EntryTimeframe, string>> = {},
): EntryConfluenceResult {
  const intervals: Partial<Record<EntryTimeframe, IndicatorSet | null>> = {};
  const dataErrors: Partial<Record<EntryTimeframe, string>> = { ...dataErrorsPassed };
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

  let vwap = options.vwap;
  if (vwap === undefined && candles['1m'] && Array.isArray(candles['1m']) && candles['1m'].length > 0) {
    try {
      vwap = calculateVWAP(candles['1m']);
      if (intervals['1m']) intervals['1m'].vwap = vwap;
    } catch {
      vwap = undefined;
    }
  }

  const currentPrice = options.currentPrice ?? (candles['1m']?.length ? candles['1m'][candles['1m'].length - 1].close : undefined);

  return evaluateEntryConfluence(intervals, { ...options, vwap, currentPrice }, dataErrors);
}

/**
 * --- SISTEMA DE ROBÔS PRÉ-ANALISTAS DETERMINÍSTICOS (SEM IA) ---
 * Inspirado nas arquiteturas profissionais de algotrading: múltiplos robôs matemáticos
 * especializados analisam diferentes dimensões do mercado (tendência, momentum, volume/institucional,
 * volatilidade/risco e posição aberta), gerando uma lista pré-qualificada de decisões
 * com justificativa técnica para que a IA atue como comitê/decisor final seletivo.
 */

export type RobotSignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface RobotAnalysisResult {
  robotId: string;
  robotName: string;
  category: 'TREND' | 'MOMENTUM' | 'INSTITUTIONAL' | 'VOLATILITY' | 'POSITION_MANAGER';
  vote: RobotSignalAction;
  confidence: number; // 0..1
  rationale: string;
  metrics: Record<string, string | number | boolean | null>;
}

export interface PreQualifiedOption {
  action: RobotSignalAction;
  score: number; // 0..100
  votesCount: number;
  supportingRobots: string[];
  primaryReason: string;
  suggestedRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface PreAnalysisReport {
  timestamp: string;
  symbol: string;
  currentPrice: number;
  robots: RobotAnalysisResult[];
  consensusAction: RobotSignalAction;
  consensusScore: number; // 0..100
  recommendedOptions: PreQualifiedOption[];
  summary: string;
  /**
   * Se a IA generativa precisa ser invocada neste ciclo.
   * False quando o consenso determinístico dos robôs for claro e não requerer decisão discricionária
   * (ex: HOLD em consolidação, sem sinal de compra e sem alvos de saída atingidos).
   * Poupa 100% dos custos e tokens de IA nessas iterações.
   */
  requiresAiDecision: boolean;
  /** Motivo técnico do bypass da IA quando requiresAiDecision for false */
  bypassReason?: string;
}

export interface PositionContextForRobots {
  ticker: string;
  quantity: number;
  entryPrice: number;
  costBrl: number;
  highestPrice?: number;
  effectiveStopLossPct?: number;
  breakevenTriggerPct?: number;
  trailingStopPct?: number;
  partialTakeProfitTriggerPct?: number;
  fullTakeProfitPct?: number;
  profitTargetMode?: 'NET' | 'GROSS';
  dayTradeTaxRate?: number;
}

export function runRobotsPreAnalysis(
  snapshot: MarketSnapshot,
  currentPrice: number,
  position: PositionContextForRobots | null,
  entryConfluence?: EntryConfluenceResult | null,
): PreAnalysisReport {
  const robots: RobotAnalysisResult[] = [];
  const one = snapshot.intervals['1m'];
  const five = snapshot.intervals['5m'];
  const fifteen = snapshot.intervals['15m'];

  // 1. Robô de Tendência e Médias Móveis (Trend Following Robot)
  {
    const trendChecks: string[] = [];
    let bullishCount = 0;
    let bearishCount = 0;

    if (one) {
      if (one.ema9 > one.ema21) { bullishCount++; trendChecks.push('1m: EMA9 > EMA21'); }
      else if (one.ema9 < one.ema21) { bearishCount++; trendChecks.push('1m: EMA9 < EMA21'); }
    }
    if (five) {
      if (five.ema9 > five.ema21) { bullishCount++; trendChecks.push('5m: EMA9 > EMA21'); }
      else if (five.ema9 < five.ema21) { bearishCount++; trendChecks.push('5m: EMA9 < EMA21'); }
    }
    if (fifteen) {
      if (fifteen.ema9 > fifteen.ema21) { bullishCount++; trendChecks.push('15m: EMA9 > EMA21'); }
      else if (fifteen.ema9 < fifteen.ema21) { bearishCount++; trendChecks.push('15m: EMA9 < EMA21'); }
    }

    let vote: RobotSignalAction = 'HOLD';
    let conf = 0.5;
    let rationale = '';

    if (bullishCount >= 2 && bearishCount === 0) {
      vote = 'BUY';
      conf = bullishCount === 3 ? 0.9 : 0.75;
      rationale = `Tendência de alta alinhada (${bullishCount}/3 timeframes com EMA9 > EMA21).`;
    } else if (bearishCount >= 2 && bullishCount === 0) {
      vote = 'SELL';
      conf = bearishCount === 3 ? 0.9 : 0.75;
      rationale = `Tendência de baixa confirmada (${bearishCount}/3 timeframes com EMA9 < EMA21).`;
    } else {
      vote = 'HOLD';
      conf = 0.6;
      rationale = `Médias mistas ou sem tendência unificada (${trendChecks.join(', ') || 'neutro'}).`;
    }

    robots.push({
      robotId: 'trend_ema_robot',
      robotName: 'Robô Seguidor de Tendência (EMA Multi-Timeframe)',
      category: 'TREND',
      vote,
      confidence: conf,
      rationale,
      metrics: { bullishCount, bearishCount, details: trendChecks.join('; ') },
    });
  }

  // 2. Robô de Momentum e Reversão (RSI / Osciladores)
  {
    const rsi1m = one?.rsi14 ?? 50;
    const rsi5m = five?.rsi14 ?? 50;
    let vote: RobotSignalAction = 'HOLD';
    let conf = 0.5;
    let rationale = '';

    if (rsi1m > 70 || rsi5m > 70) {
      vote = position ? 'SELL' : 'HOLD';
      conf = 0.8;
      rationale = `Alerta de Sobrecompra (RSI 1m=${rsi1m.toFixed(1)}, 5m=${rsi5m.toFixed(1)} > 70). Preço esticado; risco de topo local ou correção iminente.`;
    } else if (rsi1m < 32 || rsi5m < 32) {
      // TASK-37: Evita comprar faca caindo cega. Sem posição, RSI < 32 é queda forte/faca caindo (HOLD até reversão).
      vote = 'HOLD';
      conf = 0.75;
      rationale = `Faca caindo / momentum de queda acentuada (RSI 1m=${rsi1m.toFixed(1)}, 5m=${rsi5m.toFixed(1)} < 32). Aguardar exaustão e sinal de confirmação antes de entrar.`;
    } else if (rsi1m >= 40 && rsi1m <= 65) {
      vote = 'BUY';
      conf = 0.70;
      rationale = `Momentum saudável na zona de propulsão e pullback (RSI 1m=${rsi1m.toFixed(1)}).`;
    } else {
      vote = 'HOLD';
      conf = 0.55;
      rationale = `RSI em zona de transição neutra (${rsi1m.toFixed(1)}).`;
    }

    robots.push({
      robotId: 'momentum_rsi_robot',
      robotName: 'Robô de Momentum (RSI 14)',
      category: 'MOMENTUM',
      vote,
      confidence: conf,
      rationale,
      metrics: { rsi1m, rsi5m },
    });
  }

  // 3. Robô Institucional (VWAP e Volume Profile)
  {
    const vwap = snapshot.vwap ?? one?.vwap ?? null;
    const volRatio = one?.volumeRatio ?? 1.0;
    let vote: RobotSignalAction = 'HOLD';
    let conf = 0.5;
    let rationale = '';

    if (typeof vwap === 'number' && vwap > 0) {
      const vwapDiffPct = ((currentPrice - vwap) / vwap) * 100;
      if (currentPrice >= vwap) {
        if (vwapDiffPct > 1.8) {
          // TASK-37: Preço esticado demais acima da VWAP (> +1.8%), risco alto de pullback em direção à média.
          vote = 'HOLD';
          conf = 0.75;
          rationale = `Preço excessivamente esticado acima da VWAP (+${vwapDiffPct.toFixed(2)}% > +1.8%). Risco de reversão à média (pullback iminente).`;
        } else if (volRatio >= 1.2) {
          vote = 'BUY';
          conf = 0.85;
          rationale = `Preço acima da VWAP (+${vwapDiffPct.toFixed(2)}%) com volume institucional forte (${(volRatio * 100).toFixed(0)}% da média).`;
        } else {
          vote = 'HOLD';
          conf = 0.65;
          rationale = `Preço acima da VWAP (+${vwapDiffPct.toFixed(2)}%), mas volume moderado/normal.`;
        }
      } else {
        vote = 'SELL';
        conf = 0.8;
        rationale = `Preço abaixo da VWAP (${vwapDiffPct.toFixed(2)}%). Pressão institucional de venda; compras proibidas.`;
      }
    } else {
      vote = 'HOLD';
      conf = 0.5;
      rationale = 'VWAP indisponível no ciclo atual.';
    }

    robots.push({
      robotId: 'institutional_vwap_robot',
      robotName: 'Robô Institucional (VWAP & Volume)',
      category: 'INSTITUTIONAL',
      vote,
      confidence: conf,
      rationale,
      metrics: { vwap: vwap ?? 'N/A', volumeRatio: volRatio },
    });
  }

  // 4. Robô de Volatilidade e Amplitude (ATR / Volatility Guard)
  {
    const atr = snapshot.atr ?? five?.atr ?? one?.atr ?? null;
    let vote: RobotSignalAction = 'HOLD';
    let conf = 0.6;
    let rationale = '';

    if (typeof atr === 'number' && atr > 0 && currentPrice > 0) {
      const atrPct = (atr / currentPrice) * 100;
      if (atrPct >= 0.25 && atrPct <= 2.5) {
        vote = 'HOLD';
        conf = 0.7;
        rationale = `Volatilidade ideal para Day Trade (ATR 14 = R$ ${atr.toFixed(3)} / ${atrPct.toFixed(2)}% do preço).`;
      } else if (atrPct > 2.5) {
        vote = 'HOLD';
        conf = 0.8;
        rationale = `Volatilidade anômala/excessiva (${atrPct.toFixed(2)}% do preço). Risco elevado de violinada.`;
      } else {
        vote = 'HOLD';
        conf = 0.65;
        rationale = `Mercado em compressão de volatilidade (${atrPct.toFixed(2)}%). Pouca amplitude para alvo rápido.`;
      }
    } else {
      vote = 'HOLD';
      conf = 0.5;
      rationale = 'ATR não calculado no momento.';
    }

    robots.push({
      robotId: 'volatility_atr_robot',
      robotName: 'Robô de Volatilidade (ATR Guard)',
      category: 'VOLATILITY',
      vote,
      confidence: conf,
      rationale,
      metrics: { atr: atr ?? 'N/A' },
    });
  }

  // 5. Robô Gestor de Posição / Exit Manager (Ativo apenas se houver posição)
  if (position) {
    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const highest = Math.max(position.highestPrice ?? position.entryPrice, currentPrice);
    const maxGainPct = ((highest - position.entryPrice) / position.entryPrice) * 100;
    const stopLossPct = (position.effectiveStopLossPct ?? 0.012) * 100;
    const stopPrice = Number((position.entryPrice * (1 - (position.effectiveStopLossPct ?? 0.012))).toFixed(2));
    const fullTpPct = (position.fullTakeProfitPct ?? 0.008) * 100;
    const partialTpPct = (position.partialTakeProfitTriggerPct ?? 0.006) * 100;
    const isNetMode = position.profitTargetMode !== 'GROSS';

    const fullTpTargetPrice = isNetMode
      ? b3RequiredPriceForNetTarget(position.entryPrice, (position.fullTakeProfitPct ?? 0.008), undefined, position.dayTradeTaxRate)
      : Number((position.entryPrice * (1 + (position.fullTakeProfitPct ?? 0.008))).toFixed(2));
    const partialTpTargetPrice = isNetMode
      ? b3RequiredPriceForNetTarget(position.entryPrice, (position.partialTakeProfitTriggerPct ?? 0.006), undefined, position.dayTradeTaxRate)
      : Number((position.entryPrice * (1 + (position.partialTakeProfitTriggerPct ?? 0.006))).toFixed(2));

    const isFullTpReached = isNetMode ? currentPrice >= fullTpTargetPrice - 1e-6 : pnlPct >= fullTpPct;
    const isPartialTpReached = isNetMode ? currentPrice >= partialTpTargetPrice - 1e-6 : pnlPct >= partialTpPct;

    let vote: RobotSignalAction = 'HOLD';
    let conf = 0.7;
    let rationale = '';

    if (currentPrice <= stopPrice || pnlPct <= -stopLossPct) {
      vote = 'SELL';
      conf = 1.0;
      rationale = `STOP LOSS ATINGIDO: Preço R$ ${currentPrice.toFixed(2)} atingiu/furou Stop Loss de R$ ${stopPrice.toFixed(2)} (-${stopLossPct.toFixed(1)}%). Saída mandatória.`;
    } else if (isFullTpReached) {
      vote = 'SELL';
      conf = 0.95;
      rationale = `TAKE PROFIT TOTAL ATINGIDO (+${pnlPct.toFixed(2)}% >= alvo ${isNetMode ? `líquido R$ ${fullTpTargetPrice.toFixed(2)} (+${fullTpPct.toFixed(1)}% líquido após taxas e IR)` : `+${fullTpPct.toFixed(1)}%`}). Liquidação total recomendada.`;
    } else if (isPartialTpReached) {
      vote = 'SELL';
      conf = 0.85;
      rationale = `ALVO PARCIAL ATINGIDO (+${pnlPct.toFixed(2)}% >= parcial ${isNetMode ? `líquida R$ ${partialTpTargetPrice.toFixed(2)} (+${partialTpPct.toFixed(1)}% líquida após taxas e IR)` : `+${partialTpPct.toFixed(1)}%`}). Recomenda realizar 50% dos lucros.`;
    } else if (pnlPct < 0) {
      vote = 'HOLD';
      conf = 0.9;
      rationale = `POSIÇÃO DENTRO DA OSCILAÇÃO NORMAL: PnL de ${pnlPct.toFixed(2)}% está acima do Stop Loss (-${stopLossPct.toFixed(1)}%). É terminantemente proibido sair no pânico antes do stop.`;
    } else {
      vote = 'HOLD';
      conf = 0.75;
      rationale = `Operação no lucro moderado (+${pnlPct.toFixed(2)}%). Conduzir trade buscando os alvos.`;
    }

    robots.push({
      robotId: 'position_exit_manager',
      robotName: 'Robô Gestor de Saída e Risco da Posição',
      category: 'POSITION_MANAGER',
      vote,
      confidence: conf,
      rationale,
      metrics: { pnlPct, maxGainPct, stopPrice, stopLossPct },
    });
  }

  // --- Consolidação e Ranking de Opções Pré-Qualificadas ---
  const votes = { BUY: 0, SELL: 0, HOLD: 0 };
  const weightedScores = { BUY: 0, SELL: 0, HOLD: 0 };
  const supporting = { BUY: [] as string[], SELL: [] as string[], HOLD: [] as string[] };

  for (const r of robots) {
    votes[r.vote]++;
    weightedScores[r.vote] += r.confidence;
    supporting[r.vote].push(r.robotName);
  }

  const totalConfidence = weightedScores.BUY + weightedScores.SELL + weightedScores.HOLD || 1;
  const buyScore = Math.round((weightedScores.BUY / totalConfidence) * 100);
  const sellScore = Math.round((weightedScores.SELL / totalConfidence) * 100);
  const holdScore = Math.round((weightedScores.HOLD / totalConfidence) * 100);

  const options: PreQualifiedOption[] = [];

  if (votes.HOLD > 0) {
    options.push({
      action: 'HOLD',
      score: holdScore,
      votesCount: votes.HOLD,
      supportingRobots: supporting.HOLD,
      primaryReason: robots.find((r) => r.vote === 'HOLD')?.rationale ?? 'Preservação de capital e aguardar definição do mercado.',
      suggestedRiskLevel: 'LOW',
    });
  }

  if (votes.BUY > 0) {
    options.push({
      action: 'BUY',
      score: buyScore,
      votesCount: votes.BUY,
      supportingRobots: supporting.BUY,
      primaryReason: robots.find((r) => r.vote === 'BUY')?.rationale ?? 'Sinais técnicos de compra identificados.',
      suggestedRiskLevel: entryConfluence?.allowed ? 'MEDIUM' : 'HIGH',
    });
  }

  if (votes.SELL > 0) {
    options.push({
      action: 'SELL',
      score: sellScore,
      votesCount: votes.SELL,
      supportingRobots: supporting.SELL,
      primaryReason: robots.find((r) => r.vote === 'SELL')?.rationale ?? 'Condições técnicas de saída ou stop/take profit identificadas.',
      suggestedRiskLevel: 'LOW',
    });
  }

  // Ordena opções por pontuação ponderada decrescente
  options.sort((a, b) => b.score - a.score);

  const consensusAction = options[0]?.action ?? 'HOLD';
  const consensusScore = options[0]?.score ?? 100;

  // --- Economia Inteligente de IA (Bypass de Consumo) ---
  // A IA generativa só deve ser acionada quando houver real necessidade de decisão
  // discricionária / contextual. Nos ciclos de mercado onde os robôs já têm certeza
  // de HOLD ou onde a saída é mecânica, o consumo de IA é dispensado com custo $0,00.
  let requiresAiDecision = true;
  let bypassReason: string | undefined = undefined;

  const exitManagerRobot = robots.find((r) => r.category === 'POSITION_MANAGER');
  const hasBuyOpportunity = votes.BUY > 0 && entryConfluence?.allowed;
  const isStopOrFullTpTriggered = exitManagerRobot?.vote === 'SELL' && (
    exitManagerRobot.rationale.includes('STOP LOSS ATINGIDO') ||
    exitManagerRobot.rationale.includes('TAKE PROFIT TOTAL ATINGIDO')
  );

  if (!position) {
    // Sem posição aberta:
    // Se não há oportunidade qualificada de BUY (sem sinal ou sem confluência),
    // a decisão é HOLD inequívoco. Não gasta IA para decidir o óbvio.
    if (!hasBuyOpportunity && consensusAction === 'HOLD') {
      requiresAiDecision = false;
      bypassReason = 'Sem posição aberta e sem setup de compra pré-qualificado pelos robôs. HOLD determinístico com custo zero de IA.';
    }
  } else {
    // Com posição aberta:
    // Se a saída já foi disparada mecanicamente (Stop Loss ou Full TP), o motor de risco
    // executará de forma autoritativa e não precisa de discricionariedade da IA.
    if (isStopOrFullTpTriggered) {
      requiresAiDecision = false;
      bypassReason = 'Saída mandatória disparada pelo Robô Gestor de Posição (Stop Loss ou Full Take Profit). Execução mecânica direta sem latência de IA.';
    } else if (consensusAction === 'HOLD' && exitManagerRobot?.vote === 'HOLD') {
      // Posição flutuando normalmente dentro da margem de tolerância sem ameaça de stop
      // nem alvo atingido e sem reversão de tendência. Mantém HOLD determinístico.
      requiresAiDecision = false;
      bypassReason = 'Posição aberta em oscilação normal, sem alvos atingidos e sem reversão. HOLD de condução determinístico sem custo de IA.';
    }
  }

  const summary = `Pré-análise concluída por ${robots.length} robôs determinísticos. Consenso técnico: ${consensusAction} (${consensusScore}% de convicção ponderada). IA necessária: ${requiresAiDecision ? 'SIM (decisão seletiva)' : 'NÃO (bypass de economia)'}.`;

  return {
    timestamp: new Date().toISOString(),
    symbol: snapshot.symbol,
    currentPrice,
    robots,
    consensusAction,
    consensusScore,
    recommendedOptions: options,
    summary,
    requiresAiDecision,
    bypassReason,
  };
}
