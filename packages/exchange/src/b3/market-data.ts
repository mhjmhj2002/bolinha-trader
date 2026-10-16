import { rsi, type Candle } from '@bolinha/market-data';
import type { B3MarketDataProvider } from './types.js';

export class B3MarketDataService implements B3MarketDataProvider {
  private candlesStore = new Map<string, Record<'1m' | '5m' | '15m', Candle[]>>();
  private currentPrices = new Map<string, number>();
  private last1mClose = new Map<string, number>();

  reset(): void {
    this.candlesStore.clear();
    this.currentPrices.clear();
    this.last1mClose.clear();
  }

  setMockPrice(ticker: string, price: number): void {
    const symbol = ticker.toUpperCase();
    this.currentPrices.set(symbol, price);
    this.last1mClose.set(symbol, price);
  }

  setMockCandles(ticker: string, interval: '1m' | '5m' | '15m', candles: Candle[]): void {
    const symbol = ticker.toUpperCase();
    const existing = this.candlesStore.get(symbol) ?? { '1m': [], '5m': [], '15m': [] };
    existing[interval] = candles;
    this.candlesStore.set(symbol, existing);
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
   * Agrega uma lista de candles de 1m em candles de período maior (ex: 5m = 5 candles, 15m = 15 candles).
   * O último candle (em formação ou incompleto) agrega os candles de 1m restantes até o momento presente,
   * garantindo que o `close` do último candle agregado coincida perfeitamente com o `close` do último candle de 1m.
   */
  private aggregateCandles(candles1m: Candle[], factor: number, intervalMs: number): Candle[] {
    if (candles1m.length === 0) return [];
    const aggregated: Candle[] = [];
    const n = candles1m.length;

    for (let i = 0; i < n; i += factor) {
      const chunk = candles1m.slice(i, i + factor);
      if (chunk.length === 0) continue;
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      const open = first.open;
      const close = last.close;
      const high = Number(Math.max(...chunk.map((c) => c.high)).toFixed(2));
      const low = Number(Math.min(...chunk.map((c) => c.low)).toFixed(2));
      const volume = chunk.reduce((sum, c) => sum + c.volume, 0);
      const openTime = first.openTime;
      const closeTime = openTime + intervalMs - 1;

      aggregated.push({
        openTime,
        open,
        high,
        low,
        close,
        volume,
        closeTime,
      });
    }

    return aggregated;
  }

  private generateSynthetic1m(symbol: string, totalNeeded: number, now: number): Candle[] {
    const basePrice = this.last1mClose.get(symbol) ?? this.currentPrices.get(symbol) ?? 30.0;
    const intervalMs = 60_000;
    const result: Candle[] = [];

    let current = basePrice;
    const stepVolatility = 0.0025;

    for (let i = totalNeeded; i > 0; i--) {
      const openTime = now - i * intervalMs;
      const u1 = Math.random();
      const u2 = Math.random();
      const shock = (u1 - 0.5) + (u2 - 0.5);
      const meanReversion = (basePrice - current) * 0.02;
      const returnPct = shock * stepVolatility * 2 + meanReversion * 0.1;

      const open = Number(current.toFixed(2));
      let close = Number((current * (1 + returnPct)).toFixed(2));
      if (close <= 0.1) close = 0.1;

      const upperWick = Math.random() * (current * 0.0015);
      const lowerWick = Math.random() * (current * 0.0015);
      const high = Number((Math.max(open, close) + upperWick).toFixed(2));
      const low = Number(Math.max(0.05, Math.min(open, close) - lowerWick).toFixed(2));
      const volume = Math.floor(1000 + Math.random() * 5000);
      current = close;

      result.push({
        openTime,
        open,
        high,
        low,
        close,
        volume,
        closeTime: openTime + intervalMs - 1,
      });
    }

    return result;
  }

  async candles(ticker: string, interval: '1m' | '5m' | '15m', limit = 100): Promise<Candle[]> {
    const symbol = ticker.toUpperCase();
    const stored = this.candlesStore.get(symbol)?.[interval];
    if (stored && stored.length > 0) {
      const sliced = stored.slice(-limit);
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
    const stored1m = this.candlesStore.get(symbol)?.['1m'];
    if (stored1m && stored1m.length > 0 && interval !== '1m') {
      const factor = interval === '5m' ? 5 : 15;
      const intervalMs = factor * 60_000;
      const aggregated = this.aggregateCandles(stored1m, factor, intervalMs);
      return aggregated.slice(-limit);
    }

    // Gerador sintético realista sincronizado:
    // Mantém a série de 1m em cache de memória para continuidade temporal entre chamadas consecutivas
    const existingSeries = this.candlesStore.get(symbol) ?? { '1m': [], '5m': [], '15m': [] };
    const now = Date.now();

    // Para suportar até 100 candles de 15m sem truncar cálculos de indicadores (>= 22 candles),
    // mantemos um estoque de base de pelo menos 1500 candles de 1m (ou limit * 15)
    const factor = interval === '1m' ? 1 : interval === '5m' ? 5 : 15;
    const required1mCount = Math.max(limit * 15, 1500);

    let series1m = existingSeries['1m'];
    if (series1m.length < required1mCount) {
      series1m = this.generateSynthetic1m(symbol, required1mCount, now);
      existingSeries['1m'] = series1m;
      this.candlesStore.set(symbol, existingSeries);
    }

    // Atualiza preço corrente pelo último fechamento de 1m
    const last1mClose = series1m[series1m.length - 1].close;
    this.last1mClose.set(symbol, last1mClose);
    this.currentPrices.set(symbol, last1mClose);

    if (interval === '1m') {
      return series1m.slice(-limit);
    }

    const intervalMs = factor * 60_000;
    const aggregated = this.aggregateCandles(series1m, factor, intervalMs);
    return aggregated.slice(-limit);
  }

  async price(ticker: string): Promise<number> {
    const symbol = ticker.toUpperCase();
    const stored1m = this.candlesStore.get(symbol)?.['1m'];
    if (stored1m && stored1m.length > 0) {
      const close = stored1m[stored1m.length - 1].close;
      this.last1mClose.set(symbol, close);
      this.currentPrices.set(symbol, close);
      return close;
    }
    const last1m = this.last1mClose.get(symbol);
    if (last1m !== undefined) return last1m;
    const current = this.currentPrices.get(symbol);
    if (current !== undefined) return current;

    const generated = await this.candles(symbol, '1m', 1);
    const lastPrice = generated[generated.length - 1]?.close ?? 30.0;
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

