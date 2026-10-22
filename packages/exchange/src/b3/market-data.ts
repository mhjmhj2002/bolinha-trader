import { config } from '@bolinha/core';
import { rsi, type Candle } from '@bolinha/market-data';
import type { B3MarketDataProvider } from './types.js';

/**
 * Tunables of the synthetic B3 candle model. Every field has a safe default
 * coming from the typed Zod configuration (`SYNTHETIC_*`); callers may override
 * them explicitly (tests use `seed` for reproducibility).
 */
export interface SyntheticMarketModelOptions {
  /** Standard deviation of the per-candle random shock (0.0012 = 0.12% of price). */
  volatility?: number;
  /** Maximum per-candle drift of a trend segment (0.0004 = 0.04% per minute). */
  momentumDrift?: number;
  /** Number of candles a trend regime persists before it may flip. */
  trendSegmentCandles?: number;
  /** Probability that a new segment reverses the previous direction (momentum flip). */
  regimeFlipProbability?: number;
  /** Probability that a new segment is sideways (no drift) instead of trending. */
  consolidationProbability?: number;
  /** Probability that the current candle retraces against the segment drift. */
  pullbackProbability?: number;
  /**
   * Hard ceiling of consecutive same-direction closes before the walk is forced
   * into a one-tick pullback. Real 1m tapes never print dozens of monotone
   * closes, and it keeps RSI14 from saturating at 0/100.
   */
  maxTrendRun?: number;
  /** Pull back towards the anchor price per candle, as a fraction of the deviation. */
  meanReversionStrength?: number;
  /** Maximum deviation from the anchor price (0.08 = ±8%). */
  priceBoundPct?: number;
  /** Fixed RNG seed for reproducible series. 0 (default) uses fresh entropy. */
  seed?: number;
}

type ResolvedSyntheticModel = Required<SyntheticMarketModelOptions>;

const SYNTHETIC_INTERVAL_MS = 60_000;
/** Wick size as a fraction of the open price (kept proportional to the price). */
const WICK_FRACTION = 0.0015;
/** Round prices to the B3 tick (centavos). */
const PRICE_DECIMALS = 2;
const MIN_SYNTHETIC_PRICE = 0.11;
/** Default anchor when neither a mock price nor a previous close exists. */
const DEFAULT_ANCHOR_PRICE = 30.0;
/** Base traded quantity per minute and the uniform spread added on top of it. */
const BASE_CANDLE_VOLUME = 1_000;
const CANDLE_VOLUME_SPREAD = 4_000;
/** Extra volume (as a fraction) injected when the current segment is trending hard. */
const MOMENTUM_VOLUME_BOOST = 0.8;
/** The drift eases towards its target at 1/(segment/3), i.e. over ~3 candles. */
const MOMENTUM_SMOOTHING_DIVISOR = 3;
/** Segment length is jittered by ±40% of the configured length. */
const SEGMENT_LENGTH_JITTER = 0.4;
/** Momentum retained after a bound breakout forces a regime reversal. */
const BOUND_REVERSAL_MOMENTUM_KEEP = 0.25;
/**
 * Inside a trend, some candles retrace against the drift (real mini-waves are
 * never monotone). The drift component is fully inverted for those candles,
 * which keeps the wave directional while letting momentum oscillators breathe.
 */
const PULLBACK_DRIFT_FACTOR = -1;
/** Minimum depth of the rolling 1m series kept in memory to feed 15m indicators. */
const MIN_SYNTHETIC_1M_WINDOW = 1_500;
/** Extra headroom kept on top of the requested window before trimming old candles. */
const SYNTHETIC_WINDOW_HEADROOM = 2;

/** Deterministic 32-bit PRNG (mulberry32): identical seeds replay identical series. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** Mixes the configured seed with the ticker so each symbol walks its own path. */
const seedForSymbol = (seed: number, symbol: string): number => {
  let hash = (seed >>> 0) ^ 0x9e3779b9;
  for (let index = 0; index < symbol.length; index++) {
    hash = Math.imul(hash ^ symbol.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const entropySeed = (): number => Math.floor(Math.random() * 4_294_967_296) >>> 0;

const resolveSyntheticModel = (overrides: SyntheticMarketModelOptions): ResolvedSyntheticModel => ({
  volatility: overrides.volatility ?? config.SYNTHETIC_VOLATILITY,
  momentumDrift: overrides.momentumDrift ?? config.SYNTHETIC_MOMENTUM_DRIFT,
  trendSegmentCandles: overrides.trendSegmentCandles ?? config.SYNTHETIC_TREND_SEGMENT_CANDLES,
  regimeFlipProbability: overrides.regimeFlipProbability ?? config.SYNTHETIC_REGIME_FLIP_PROBABILITY,
  consolidationProbability: overrides.consolidationProbability ?? config.SYNTHETIC_CONSOLIDATION_PROBABILITY,
  pullbackProbability: overrides.pullbackProbability ?? config.SYNTHETIC_PULLBACK_PROBABILITY,
  maxTrendRun: overrides.maxTrendRun ?? config.SYNTHETIC_MAX_TREND_RUN,
  meanReversionStrength: overrides.meanReversionStrength ?? config.SYNTHETIC_MEAN_REVERSION,
  priceBoundPct: overrides.priceBoundPct ?? config.SYNTHETIC_PRICE_BOUND_PCT,
  seed: overrides.seed ?? config.SYNTHETIC_SEED,
});

/**
 * Per-symbol state of the momentum-wave model. Instead of a pure mean-reverting
 * random walk (which only oscillates around a fixed price), the price is driven
 * by a slowly mutating drift that persists for a whole segment of candles, the
 * way real intraday mini-waves extend in B3: a few dozen candles of directional
 * progress, then a possible flip or a sideways consolidation.
 */
interface SyntheticRegimeState {
  random: () => number;
  anchorPrice: number;
  /** Current per-candle drift, eased towards `targetMomentum`. */
  momentum: number;
  targetMomentum: number;
  /** -1 bearish, 0 sideways consolidation, +1 bullish. */
  direction: -1 | 0 | 1;
  candlesLeftInSegment: number;
  /** Direction of the last closed candle and how many candles already share it. */
  lastDirection: -1 | 0 | 1;
  consecutiveRun: number;
}

export class B3MarketDataService implements B3MarketDataProvider {
  private candlesStore = new Map<string, Record<'1m' | '5m' | '15m', Candle[]>>();
  private mockCandlesStore = new Map<string, Partial<Record<'1m' | '5m' | '15m', Candle[]>>>();
  private currentPrices = new Map<string, number>();
  private last1mClose = new Map<string, number>();
  private regimeStore = new Map<string, SyntheticRegimeState>();
  private readonly syntheticModel: ResolvedSyntheticModel;

  constructor(syntheticOptions: SyntheticMarketModelOptions = {}) {
    this.syntheticModel = resolveSyntheticModel(syntheticOptions);
  }

  reset(): void {
    this.candlesStore.clear();
    this.mockCandlesStore.clear();
    this.currentPrices.clear();
    this.last1mClose.clear();
    this.regimeStore.clear();
  }

  setMockPrice(ticker: string, price: number): void {
    const symbol = ticker.toUpperCase();
    this.currentPrices.set(symbol, price);
    this.last1mClose.set(symbol, price);
    // Without a candle series the next walk starts at this price, so any regime
    // anchored on the previous baseline must be dropped.
    if (!this.candlesStore.get(symbol)?.['1m']?.length) this.regimeStore.delete(symbol);
  }

  setMockCandles(ticker: string, interval: '1m' | '5m' | '15m', candles: Candle[]): void {
    const symbol = ticker.toUpperCase();
    const existing = this.mockCandlesStore.get(symbol) ?? {};
    existing[interval] = candles;
    this.mockCandlesStore.set(symbol, existing);
    if (candles.length > 0) {
      const lastClose = candles[candles.length - 1].close;
      if (interval === '1m') {
        this.last1mClose.set(symbol, lastClose);
        this.currentPrices.set(symbol, lastClose);
      } else if (!this.last1mClose.has(symbol)) {
        this.currentPrices.set(symbol, lastClose);
      }
    }
  }

  /**
   * Agrega candles de 1m em candles de período maior (5m = 5 candles, 15m = 15 candles).
   *
   * **Âncora estável (relógio de parede).** Cada candle de 1m pertence sempre ao bucket
   * `Math.floor(openTime / intervalMs) * intervalMs`, e não à posição que ele ocupa dentro da janela recebida.
   * A âncora anterior (`start = n % factor`) reagrupava a série inteira a cada novo candle de 1m, então as
   * fronteiras de TODOS os candles passados andavam quando a janela deslizante crescia — era isso que
   * produzia "último candle parcial" e volumes incoerentes entre ciclos. Uma chave derivada do `openTime` é
   * imutável: o mesmo candle de 1m cai no mesmo bucket hoje e depois de a janela crescer.
   *
   * **Fail-closed.** Só é emitido um bucket que contenha EXATAMENTE `factor` candles de 1m. Buckets
   * incompletos (início da série, buracos na fita) são descartados em vez de gerar um candle agregado com
   * volume artificialmente baixo — o antigo falso `volumeState=LOW` que mascarava entradas — ou com preço
   * inventado. Nenhum OHLCV é sintetizado aqui.
   *
   * **Alinhamento.** O bucket do relógio é rotulado com a própria chave, portanto todo candle agregado da
   * grade começa num múltiplo de `intervalMs` e fecha em `closeTime === openTime + intervalMs - 1`. Buckets
   * nunca se sobrepõem, então deslizar a janela apenas acrescenta candles no fim; o histórico é imutável.
   *
   * **Topo da série (contrato BUG-07).** Quando o candle de 1m mais novo ainda não completou o bucket do
   * relógio, o último bucket completo é substituído por um candle "rolante" formado pelos últimos `factor`
   * candles de 1m. Isso mantém duas garantias: (i) nunca existe candle parcial e (ii) o `close` agregado mais
   * novo continua idêntico ao `close` do candle de 1m mais novo, contrato consumido pela confluência de
   * timeframes e por `price()`. Trade-off explícito: o candle rolante é ancorado no `openTime` real do seu
   * primeiro candle de 1m — se a fita de 1m estiver fora da grade (é o caso do gerador sintético, ancorado em
   * `Date.now()`), ele não cai em múltiplo absoluto de `intervalMs`; descartá-lo quebraria o contrato (ii). O
   * bucket completo que ele substitui é removido para nunca haver sobreposição/volume contado duas vezes.
   */
  private aggregateCandles(candles1m: Candle[], factor: number, intervalMs: number): Candle[] {
    if (candles1m.length === 0 || intervalMs <= 0) return [];
    if (factor <= 1) return [...candles1m];
    const total = candles1m.length;
    if (total < factor) return [];

    /** Consolida OHLCV de um conjunto completo de `factor` candles de 1m em um candle do período maior. */
    const buildBucket = (chunk: Candle[], openTime: number): Candle => {
      const last = chunk[chunk.length - 1];
      return {
        openTime,
        open: chunk[0].open,
        high: Number(Math.max(...chunk.map((candle) => candle.high)).toFixed(2)),
        low: Number(Math.min(...chunk.map((candle) => candle.low)).toFixed(2)),
        close: last.close,
        volume: chunk.reduce((sum, candle) => sum + candle.volume, 0),
        closeTime: openTime + intervalMs - 1,
      };
    };

    // Agrupa pela chave de relógio: intrínseca ao candle de 1m, portanto imune ao deslize da janela.
    const groups: { key: number; candles: Candle[] }[] = [];
    for (const candle of candles1m) {
      const key = Math.floor(candle.openTime / intervalMs) * intervalMs;
      const current = groups[groups.length - 1];
      if (current && current.key === key) current.candles.push(candle);
      else groups.push({ key, candles: [candle] });
    }

    const aggregated: Candle[] = [];
    let cursor = 0;
    let lastCompleteEnd = -1;
    for (const group of groups) {
      cursor += group.candles.length;
      if (group.candles.length !== factor) continue; // fail-closed: bucket incompleto nunca é emitido
      aggregated.push(buildBucket(group.candles, group.key));
      lastCompleteEnd = cursor - 1;
    }

    // O candle de 1m mais novo já fecha um bucket completo: a grade inteira está emitida.
    if (lastCompleteEnd === total - 1) return aggregated;

    // Há candle em formação no topo: o candle rolante assume o lugar do último bucket completo, mantendo o
    // `close` mais novo idêntico ao do candle de 1m mais novo e a contagem em floor(n / factor).
    const rollingChunk = candles1m.slice(total - factor);
    const rolling = buildBucket(rollingChunk, rollingChunk[0].openTime);
    // Remove buckets que se sobreponham à janela rolante: sobreposição contaria o mesmo volume duas vezes.
    let overlapping = aggregated[aggregated.length - 1];
    while (overlapping && overlapping.openTime + intervalMs > rolling.openTime) {
      aggregated.pop();
      overlapping = aggregated[aggregated.length - 1];
    }
    aggregated.push(rolling);

    return aggregated;
  }

  /** Lazily creates (or reuses) the per-symbol momentum regime of the walk. */
  private regimeFor(symbol: string, referencePrice: number): SyntheticRegimeState {
    const existing = this.regimeStore.get(symbol);
    if (existing) return existing;
    const configuredSeed = this.syntheticModel.seed;
    const seed = configuredSeed > 0 ? seedForSymbol(configuredSeed, symbol) : entropySeed();
    const state: SyntheticRegimeState = {
      random: mulberry32(seed),
      anchorPrice: referencePrice,
      momentum: 0,
      targetMomentum: 0,
      direction: 0,
      candlesLeftInSegment: 0,
      lastDirection: 0,
      consecutiveRun: 0,
    };
    this.regimeStore.set(symbol, state);
    return state;
  }

  /**
   * Opens a new trend segment: it either extends the previous direction or flips
   * it, and occasionally goes flat (consolidation). The magnitude is jittered so
   * waves are not all identical.
   */
  private startTrendSegment(state: SyntheticRegimeState): void {
    const model = this.syntheticModel;
    const { random } = state;
    const jitter = 1 - SEGMENT_LENGTH_JITTER + random() * (2 * SEGMENT_LENGTH_JITTER);
    state.candlesLeftInSegment = Math.max(2, Math.round(model.trendSegmentCandles * jitter));

    const flip = random() < model.regimeFlipProbability;
    let direction: SyntheticRegimeState['direction'];
    if (state.direction === 0) direction = random() < 0.5 ? 1 : -1;
    else direction = flip ? (state.direction === 1 ? -1 : 1) : state.direction;
    if (random() < model.consolidationProbability) direction = 0;
    state.direction = direction;
    state.targetMomentum = direction * model.momentumDrift * (0.5 + random());
  }

  /** Forces a reversal after the walk touched a plausibility bound. */
  private reverseTrend(state: SyntheticRegimeState, direction: -1 | 1): void {
    state.direction = direction;
    state.momentum *= BOUND_REVERSAL_MOMENTUM_KEEP;
    state.targetMomentum = direction * this.syntheticModel.momentumDrift * 0.5;
    state.candlesLeftInSegment = Math.max(2, Math.round(this.syntheticModel.trendSegmentCandles * 0.5));
  }

  /**
   * Advances the model by one candle. The log-free return is the sum of three
   * components: the persistent segment drift (momentum wave), a weak pull back
   * towards the anchor price, and a small random shock. Prices are clamped to
   * `SYNTHETIC_PRICE_BOUND_PCT` around the anchor, and touching a bound starts a
   * reversal, so the series can never run away nor go negative.
   */
  private nextSyntheticCandle(symbol: string, openPrice: number, openTime: number): Candle {
    const model = this.syntheticModel;
    const state = this.regimeFor(symbol, openPrice);

    if (state.candlesLeftInSegment <= 0) this.startTrendSegment(state);
    state.candlesLeftInSegment -= 1;

    // The drift eases towards the segment target, so a regime change curves
    // gradually instead of jumping.
    const smoothing = Math.min(1, 1 / Math.max(2, model.trendSegmentCandles / MOMENTUM_SMOOTHING_DIVISOR));
    state.momentum += (state.targetMomentum - state.momentum) * smoothing;

    // Inside a trend some candles retrace against the drift, the way a real
    // mini-wave breathes instead of marching monotone upwards or downwards. The
    // run cap additionally forces a retrace once a direction has already
    // printed `maxTrendRun` closes in a row, which is what keeps RSI14 away from
    // the hard 0/100 saturations of a never-retracing series.
    const runCapReached = state.consecutiveRun >= model.maxTrendRun;
    const retracing = runCapReached || (state.direction !== 0 && state.random() < model.pullbackProbability);
    const drift = retracing ? state.momentum * PULLBACK_DRIFT_FACTOR : state.momentum;

    const reversion = ((state.anchorPrice - openPrice) / state.anchorPrice) * model.meanReversionStrength;
    const shock = (state.random() + state.random() + state.random() - 1.5) * 2 * model.volatility;
    const returnPct = drift + reversion + shock;

    const lowerBound = Number(
      Math.max(MIN_SYNTHETIC_PRICE, state.anchorPrice * (1 - model.priceBoundPct)).toFixed(PRICE_DECIMALS),
    );
    const upperBound = Number((state.anchorPrice * (1 + model.priceBoundPct)).toFixed(PRICE_DECIMALS));

    const open = Number(openPrice.toFixed(PRICE_DECIMALS));
    const rawClose = openPrice * (1 + returnPct);
    if (rawClose > upperBound) this.reverseTrend(state, -1);
    else if (rawClose < lowerBound) this.reverseTrend(state, 1);
    const close = Number(Math.min(upperBound, Math.max(lowerBound, rawClose)).toFixed(PRICE_DECIMALS));

    // Track the directional run so the next candle can respect `maxTrendRun`.
    const candleDirection = close > open ? 1 : close < open ? -1 : 0;
    if (candleDirection === 0) {
      state.lastDirection = 0;
      state.consecutiveRun = 0;
    } else if (candleDirection === state.lastDirection) {
      state.consecutiveRun += 1;
    } else {
      state.lastDirection = candleDirection;
      state.consecutiveRun = 1;
    }

    const wickScale = open * WICK_FRACTION;
    const high = Number((Math.max(open, close) + state.random() * wickScale).toFixed(PRICE_DECIMALS));
    const low = Number(
      Math.max(MIN_SYNTHETIC_PRICE, Math.min(open, close) - state.random() * wickScale).toFixed(PRICE_DECIMALS),
    );
    // Trending candles trade heavier than consolidating ones (as in a real tape).
    const trendIntensity = Math.min(
      1,
      Math.abs(state.momentum) / Math.max(model.momentumDrift, Number.EPSILON),
    );
    const volume = Math.floor(
      BASE_CANDLE_VOLUME + state.random() * CANDLE_VOLUME_SPREAD * (1 + trendIntensity * MOMENTUM_VOLUME_BOOST),
    );

    return {
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closeTime: openTime + SYNTHETIC_INTERVAL_MS - 1,
    };
  }

  private generateSynthetic1m(symbol: string, totalNeeded: number, now: number): Candle[] {
    const basePrice = this.last1mClose.get(symbol) ?? this.currentPrices.get(symbol) ?? DEFAULT_ANCHOR_PRICE;
    const result: Candle[] = [];

    let current = basePrice;

    for (let i = totalNeeded; i > 0; i--) {
      const openTime = now - i * SYNTHETIC_INTERVAL_MS;
      const candle = this.nextSyntheticCandle(symbol, current, openTime);
      current = candle.close;
      result.push(candle);
    }

    return result;
  }

  private ensureUpdated1mSeries(symbol: string, required1mCount: number, now = Date.now()): Candle[] {
    const existingSeries = this.candlesStore.get(symbol) ?? { '1m': [], '5m': [], '15m': [] };
    let series1m = existingSeries['1m'];

    if (series1m.length === 0) {
      series1m = this.generateSynthetic1m(symbol, required1mCount, now);
      existingSeries['1m'] = series1m;
      this.candlesStore.set(symbol, existingSeries);
    } else {
      const lastCandle = series1m[series1m.length - 1];
      const elapsedMinutes = Math.floor((now - lastCandle.closeTime) / SYNTHETIC_INTERVAL_MS);
      if (elapsedMinutes > 0) {
        let currentClose = lastCandle.close;
        const maxMinutesToGenerate = Math.min(elapsedMinutes, required1mCount);
        const startTime = now - maxMinutesToGenerate * SYNTHETIC_INTERVAL_MS;

        const newCandles: Candle[] = [];
        for (let i = 0; i < maxMinutesToGenerate; i++) {
          const openTime = startTime + i * SYNTHETIC_INTERVAL_MS;
          const candle = this.nextSyntheticCandle(symbol, currentClose, openTime);
          currentClose = candle.close;
          newCandles.push(candle);
        }

        series1m = [...series1m, ...newCandles];
        // Manter janela deslizante limitada
        const maxKeep = Math.max(required1mCount * SYNTHETIC_WINDOW_HEADROOM, MIN_SYNTHETIC_1M_WINDOW);
        if (series1m.length > maxKeep) {
          series1m = series1m.slice(-maxKeep);
        }
        existingSeries['1m'] = series1m;
        this.candlesStore.set(symbol, existingSeries);
      }
    }

    const last1mClose = series1m[series1m.length - 1].close;
    this.last1mClose.set(symbol, last1mClose);
    this.currentPrices.set(symbol, last1mClose);

    return series1m;
  }

  async candles(ticker: string, interval: '1m' | '5m' | '15m', limit = 100): Promise<Candle[]> {
    const symbol = ticker.toUpperCase();
    const mockInterval = this.mockCandlesStore.get(symbol)?.[interval];
    if (mockInterval && mockInterval.length > 0) {
      const sliced = mockInterval.slice(-limit);
      if (sliced.length > 0) {
        const lastClose = sliced[sliced.length - 1].close;
        if (interval === '1m') {
          this.last1mClose.set(symbol, lastClose);
          this.currentPrices.set(symbol, lastClose);
        } else if (!this.last1mClose.has(symbol)) {
          this.currentPrices.set(symbol, lastClose);
        }
      }
      return sliced;
    }

    // Se houver mock de 1m, derivamos 5m e 15m a partir de 1m caso o intervalo solicitado não tenha mock direto
    const mock1m = this.mockCandlesStore.get(symbol)?.['1m'];
    if (mock1m && mock1m.length > 0 && interval !== '1m') {
      const factor = interval === '5m' ? 5 : 15;
      const intervalMs = factor * 60_000;
      const aggregated = this.aggregateCandles(mock1m, factor, intervalMs);
      return aggregated.slice(-limit);
    }

    // Gerador sintético realista sincronizado com progressão temporal dinâmica (janela deslizante)
    const factor = interval === '1m' ? 1 : interval === '5m' ? 5 : 15;
    const required1mCount = Math.max(limit * 15, MIN_SYNTHETIC_1M_WINDOW);

    const series1m = this.ensureUpdated1mSeries(symbol, required1mCount);

    if (interval === '1m') {
      return series1m.slice(-limit);
    }

    const intervalMs = factor * 60_000;
    const aggregated = this.aggregateCandles(series1m, factor, intervalMs);
    return aggregated.slice(-limit);
  }

  async price(ticker: string): Promise<number> {
    const symbol = ticker.toUpperCase();
    const mock1m = this.mockCandlesStore.get(symbol)?.['1m'];
    if (mock1m && mock1m.length > 0) {
      const close = mock1m[mock1m.length - 1].close;
      this.last1mClose.set(symbol, close);
      this.currentPrices.set(symbol, close);
      return close;
    }

    const current = this.currentPrices.get(symbol);
    const existingSeries = this.candlesStore.get(symbol);
    const stored1m = existingSeries?.['1m'];
    const hasNoCandlesYet = !stored1m || stored1m.length === 0;
    if (current !== undefined && hasNoCandlesYet) return current;

    // Se já existem candles ou não há preço fixo, garante série de 1m sincronizada e retorna o último fechamento
    const series1m = this.ensureUpdated1mSeries(symbol, MIN_SYNTHETIC_1M_WINDOW);
    const lastPrice = series1m[series1m.length - 1]?.close ?? current ?? DEFAULT_ANCHOR_PRICE;
    this.last1mClose.set(symbol, lastPrice);
    this.currentPrices.set(symbol, lastPrice);
    return lastPrice;
  }

  async scanAndRankSetups(tickers: string[] = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'BBAS3']): Promise<import('./types.js').B3AssetSetup[]> {
    const results = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const candles = await this.candles(ticker, '1m', 30);
          if (candles.length < 2) return null;
          const currentPrice = candles[candles.length - 1].close;
          const firstPrice = candles[0].close;
          const momentumPct = Number((((currentPrice - firstPrice) / firstPrice) * 100).toFixed(2));

          // Cálculo de RSI de 14 períodos com a função padronizada
          const closes = candles.map((c) => c.close);
          const rsi1m = rsi(closes, Math.min(14, closes.length - 1));

          const trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
            rsi1m >= 50 && momentumPct > 0 ? 'BULLISH' : rsi1m < 45 && momentumPct < 0 ? 'BEARISH' : 'NEUTRAL';

          // Score: favorece momentum positivo com RSI em zona construtiva (45 a 65)
          let score = momentumPct * 10;
          if (rsi1m >= 45 && rsi1m <= 65) score += 20;
          else if (rsi1m > 75 || rsi1m < 30) score -= 15;

          return {
            ticker: ticker.toUpperCase(),
            price: currentPrice,
            rsi1m,
            momentumPct,
            trend,
            score: Number(score.toFixed(2)),
          };
        } catch {
          return null;
        }
      }),
    );

    return (results.filter((r): r is import('./types.js').B3AssetSetup => r !== null))
      .sort((a, b) => b.score - a.score);
  }
}

export const defaultB3MarketDataService = new B3MarketDataService();

