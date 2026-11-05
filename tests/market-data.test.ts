import { describe, expect, it } from 'vitest';
import { calculateATR, calculateIndicators, calculateVWAP, returnState, rsi, type Candle } from '@bolinha/market-data';
const candles=Array.from({length:30},(_,i):Candle=>({openTime:i,closeTime:i,open:100+i,high:101+i,low:99+i,close:100+i,volume:i===29?100:10}));
describe('indicators', () => {
  it('normalizes EMA and volume', () => {
    const x = calculateIndicators(candles);
    expect(x.emaRelation).toBe('EMA9_ABOVE_EMA21');
    expect(x.volumeState).toBe('HIGH');
    // BUG-10 guard: a double-counted EMA seed would push both EMAs (~2x price, e.g. 200..258)
    // above the price band. The relation check above alone passes even with that bug.
    const minClose = Math.min(...candles.map((c) => c.close));
    const maxClose = Math.max(...candles.map((c) => c.close));
    expect(x.ema9).toBeGreaterThanOrEqual(minClose - 1e-9);
    expect(x.ema9).toBeLessThanOrEqual(maxClose + 1e-9);
    expect(x.ema21).toBeGreaterThanOrEqual(minClose - 1e-9);
    expect(x.ema21).toBeLessThanOrEqual(maxClose + 1e-9);
  });

  it('normalizes return state', () => {
    expect(returnState(0.5)).toBe('UP');
    expect(returnState(-0.5)).toBe('DOWN');
    expect(returnState(0)).toBe('FLAT');
  });

  it('sets rsi state', () => {
    expect(calculateIndicators(candles).rsiState).toBe('OVERBOUGHT');
  });

  it('handles flat prices returning neutral RSI without division by zero', () => {
    const flatCloses = Array(20).fill(30.0);
    expect(rsi(flatCloses)).toBe(50);
  });

  it('smooths strictly ascending or descending prices to avoid hard 100/0 saturation', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 10 + i * 0.01);
    const rsiVal = rsi(rising);
    expect(rsiVal).toBeGreaterThan(90);
    expect(rsiVal).toBeLessThanOrEqual(99.99);

    const falling = Array.from({ length: 20 }, (_, i) => 20 - i * 0.01);
    const rsiFalling = rsi(falling);
    expect(rsiFalling).toBeLessThan(10);
    expect(rsiFalling).toBeGreaterThanOrEqual(0.01);
  });

  it('calculates VWAP correctly with volume weighting', () => {
    // 3 candles:
    // Candle 1: High=12, Low=10, Close=11 -> Typical = 11. Vol = 100 -> 1100
    // Candle 2: High=14, Low=12, Close=13 -> Typical = 13. Vol = 200 -> 2600
    // Candle 3: High=16, Low=14, Close=15 -> Typical = 15. Vol = 100 -> 1500
    // Total Typ*Vol = 1100 + 2600 + 1500 = 5200. Total Vol = 400.
    // Expected VWAP = 5200 / 400 = 13.00
    const sampleCandles: Candle[] = [
      { openTime: 1, closeTime: 1, open: 10, high: 12, low: 10, close: 11, volume: 100 },
      { openTime: 2, closeTime: 2, open: 12, high: 14, low: 12, close: 13, volume: 200 },
      { openTime: 3, closeTime: 3, open: 14, high: 16, low: 14, close: 15, volume: 100 },
    ];
    expect(calculateVWAP(sampleCandles)).toBe(13.0);
  });

  it('calculates ATR correctly with Wilder smoothing', () => {
    // 3 candles com TR conhecido:
    // C0: High=10, Low=8, Close=9 -> TR = 10 - 8 = 2.0
    // C1: High=12, Low=9, Close=11 -> prevClose=9. max(12-9, |12-9|, |9-9|) = max(3, 3, 0) = 3.0
    // C2: High=13, Low=10, Close=10.5 -> prevClose=11. max(13-10, |13-11|, |10-11|) = max(3, 2, 1) = 3.0
    const trCandles: Candle[] = [
      { openTime: 1, closeTime: 1, open: 9, high: 10, low: 8, close: 9, volume: 100 },
      { openTime: 2, closeTime: 2, open: 9, high: 12, low: 9, close: 11, volume: 100 },
      { openTime: 3, closeTime: 3, open: 11, high: 13, low: 10, close: 10.5, volume: 100 },
    ];
    // Com period = 2:
    // Primeiro ATR (Média dos primeiros 2 TRs: (2 + 3) / 2 = 2.5)
    // Segundo ATR (Wilder smoothing no 3º candle):
    // ATR = (2.5 * (2 - 1) + 3) / 2 = (2.5 + 3) / 2 = 2.75
    expect(calculateATR(trCandles, 2)).toBe(2.75);
  });

  it('calculates ATR for 14-period standard series and includes it in calculateIndicators', () => {
    const atrCandles: Candle[] = Array.from({ length: 30 }, (_, i): Candle => ({
      openTime: i * 60000,
      closeTime: (i + 1) * 60000 - 1,
      open: 100 + (i % 2 === 0 ? 0.5 : -0.5),
      high: 102,
      low: 98,
      close: 100,
      volume: 1000,
    }));

    const atr14 = calculateATR(atrCandles, 14);
    expect(atr14).toBeGreaterThan(0);
    expect(atr14).toBe(4); // Amplitude constante de 4 (102 - 98)

    const indicators = calculateIndicators(atrCandles);
    expect(indicators.atr).toBe(4);
  });

  it('throws error when candle count is less than ATR period', () => {
    const fewCandles: Candle[] = [
      { openTime: 1, closeTime: 1, open: 10, high: 12, low: 9, close: 11, volume: 10 },
    ];
    expect(() => calculateATR(fewCandles, 14)).toThrow(/Need at least 14 candles for ATR/);
  });
});

describe('Robots Pre-Analysis Deterministic Suite', () => {
  it('generates pre-analysis recommendations from multiple quantitative robots', async () => {
    const { runRobotsPreAnalysis } = await import('../packages/market-data/src/index.ts');
    const mockIndicator = {
      price: 30.0,
      ema9: 30.5,
      ema21: 29.8,
      rsi14: 55.0,
      return1: 0.01,
      return3: 0.02,
      return12: 0.05,
      volume: 1000,
      volumeAvg20: 800,
      volumeRatio: 1.25,
      high20: 31,
      low20: 29,
      emaRelation: 'EMA9_ABOVE_EMA21' as const,
      rsiState: 'NEUTRAL' as const,
      shortReturnState: 'UP' as const,
      volumeState: 'HIGH' as const,
      vwap: 29.7,
      atr: 0.45,
    };

    const snapshot = {
      symbol: 'BBAS3',
      capturedAt: new Date().toISOString(),
      intervals: {
        '1m': { ...mockIndicator },
        '5m': { ...mockIndicator },
        '15m': { ...mockIndicator },
      },
      vwap: 29.7,
      atr: 0.45,
    };

    const report = runRobotsPreAnalysis(snapshot, 30.0, null, { allowed: true } as never);

    expect(report.robots.length).toBe(4); // 4 robôs sem posição aberta
    expect(report.recommendedOptions.length).toBeGreaterThan(0);
    expect(report.consensusAction).toBe('BUY');
    expect(report.consensusScore).toBeGreaterThan(50);

    const trendRobot = report.robots.find((r) => r.robotId === 'trend_ema_robot');
    expect(trendRobot?.vote).toBe('BUY');
    expect(trendRobot?.confidence).toBeGreaterThan(0.7);

    const vwapRobot = report.robots.find((r) => r.robotId === 'institutional_vwap_robot');
    expect(vwapRobot?.vote).toBe('BUY');
  });

  it('activates Position Exit Manager robot and flags stop loss violation when price drops below stop', async () => {
    const { runRobotsPreAnalysis } = await import('../packages/market-data/src/index.ts');
    const mockIndicator = {
      price: 29.5,
      ema9: 29.4,
      ema21: 29.8,
      rsi14: 35.0,
      return1: -0.01,
      return3: -0.02,
      return12: -0.04,
      volume: 1000,
      volumeAvg20: 1000,
      volumeRatio: 1.0,
      high20: 31,
      low20: 29,
      emaRelation: 'EMA9_BELOW_EMA21' as const,
      rsiState: 'NEUTRAL' as const,
      shortReturnState: 'DOWN' as const,
      volumeState: 'NORMAL' as const,
      vwap: 29.8,
      atr: 0.45,
    };

    const snapshot = {
      symbol: 'BBAS3',
      capturedAt: new Date().toISOString(),
      intervals: {
        '1m': { ...mockIndicator },
        '5m': { ...mockIndicator },
        '15m': { ...mockIndicator },
      },
      vwap: 29.8,
      atr: 0.45,
    };

    const position = {
      ticker: 'BBAS3',
      quantity: 3,
      entryPrice: 30.0,
      costBrl: 90.0,
      effectiveStopLossPct: 0.012, // Stop em 29.64
    };

    const report = runRobotsPreAnalysis(snapshot, 29.5, position);

    expect(report.robots.length).toBe(5); // 5 robôs com posição
    const exitRobot = report.robots.find((r) => r.robotId === 'position_exit_manager');
    expect(exitRobot?.vote).toBe('SELL');
    expect(exitRobot?.confidence).toBe(1.0);
    expect(exitRobot?.rationale).toContain('STOP LOSS ATINGIDO');
  });
});
