import type { Candle } from '@bolinha/market-data';
import type { B3MarketDataProvider } from './types.js';

export class B3MarketDataService implements B3MarketDataProvider {
  private candlesStore = new Map<string, Record<'1m' | '5m' | '15m', Candle[]>>();
  private currentPrices = new Map<string, number>();

  setMockPrice(ticker: string, price: number): void {
    this.currentPrices.set(ticker.toUpperCase(), price);
  }

  setMockCandles(ticker: string, interval: '1m' | '5m' | '15m', candles: Candle[]): void {
    const symbol = ticker.toUpperCase();
    const existing = this.candlesStore.get(symbol) ?? { '1m': [], '5m': [], '15m': [] };
    existing[interval] = candles;
    this.candlesStore.set(symbol, existing);
    if (candles.length > 0) {
      this.currentPrices.set(symbol, candles[candles.length - 1].close);
    }
  }

  async candles(ticker: string, interval: '1m' | '5m' | '15m', limit = 100): Promise<Candle[]> {
    const symbol = ticker.toUpperCase();
    const stored = this.candlesStore.get(symbol)?.[interval];
    if (stored && stored.length > 0) {
      return stored.slice(-limit);
    }

    // Gerador sintético realista padrão caso não haja mock injetado
    const basePrice = this.currentPrices.get(symbol) ?? 30.0;
    const now = Date.now();
    const intervalMs = interval === '1m' ? 60_000 : interval === '5m' ? 300_000 : 900_000;
    const result: Candle[] = [];

    let current = basePrice;
    for (let i = limit; i > 0; i--) {
      const openTime = now - i * intervalMs;
      const variation = (Math.sin(i / 5) * 0.15 + (Math.random() - 0.5) * 0.1);
      const open = Number(current.toFixed(2));
      const close = Number(Math.max(1, current + variation).toFixed(2));
      const high = Number((Math.max(open, close) + Math.random() * 0.08).toFixed(2));
      const low = Number((Math.min(open, close) - Math.random() * 0.08).toFixed(2));
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

  async price(ticker: string): Promise<number> {
    const symbol = ticker.toUpperCase();
    const current = this.currentPrices.get(symbol);
    if (current !== undefined) return current;
    const generated = await this.candles(symbol, '1m', 1);
    const lastPrice = generated[0]?.close ?? 30.0;
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

          // Cálculo simplificado de RSI 14 períodos
          const period = Math.min(14, candles.length - 1);
          let gains = 0;
          let losses = 0;
          for (let i = candles.length - period; i < candles.length; i++) {
            const diff = candles[i].close - candles[i - 1].close;
            if (diff >= 0) gains += diff;
            else losses += Math.abs(diff);
          }
          const avgGain = gains / period;
          const avgLoss = losses / period || 1e-9;
          const rs = avgGain / avgLoss;
          const rsi1m = Number((100 - (100 / (1 + rs))).toFixed(2));

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

