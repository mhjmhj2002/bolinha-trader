import { describe, expect, it } from 'vitest';
import { calculateIndicators, returnState, rsi, type Candle } from '@bolinha/market-data';
const candles=Array.from({length:30},(_,i):Candle=>({openTime:i,closeTime:i,open:100+i,high:101+i,low:99+i,close:100+i,volume:i===29?100:10}));
describe('indicators', () => {
  it('normalizes EMA and volume', () => {
    const x = calculateIndicators(candles);
    expect(x.emaRelation).toBe('EMA9_ABOVE_EMA21');
    expect(x.volumeState).toBe('HIGH');
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
});
