import { describe, expect, it } from 'vitest';
import { calculateIndicators, returnState, type Candle } from '@bolinha/market-data';
const candles=Array.from({length:30},(_,i):Candle=>({openTime:i,closeTime:i,open:100+i,high:101+i,low:99+i,close:100+i,volume:i===29?100:10}));
describe('indicators',()=>{it('normalizes EMA and volume',()=>{const x=calculateIndicators(candles);expect(x.emaRelation).toBe('EMA9_ABOVE_EMA21');expect(x.volumeState).toBe('HIGH');});it('normalizes return state',()=>{expect(returnState(.5)).toBe('UP');expect(returnState(-.5)).toBe('DOWN');expect(returnState(0)).toBe('FLAT');});it('sets rsi state',()=>expect(calculateIndicators(candles).rsiState).toBe('OVERBOUGHT'));});
