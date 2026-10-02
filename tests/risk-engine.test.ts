import { describe, expect, it } from 'vitest';
import { applyRisk } from '@bolinha/risk-engine';

const account={initialBankUsdt:20,cashUsdt:20,realizedPnlUsdt:0,aiCostUsd:0};
const rules={minNotional:10,minQty:0.0001,stepSize:0.0001};
const base={requestedUsdt:15,price:10000,account,rules,maxPositionPercent:100,duplicateOrderPending:false};
const position={quantity:.0015,entryPrice:10000,costUsdt:15,openedAt:new Date()};

describe('risk engine',()=>{
  it('allows BUY with no position',()=>expect(applyRisk({...base,action:'BUY',position:null}).action).toBe('BUY'));
  it('rejects BUY with a position',()=>expect(applyRisk({...base,action:'BUY',position:{...position,quantity:.001}}).rejectionReason).toMatch(/open BTC/));
  it('rejects SELL with no position',()=>expect(applyRisk({...base,action:'SELL',position:null}).action).toBe('HOLD'));
  it('SELL always uses the entire conceptual position, ignoring a partial AI amount',()=>{
    const result=applyRisk({...base,action:'SELL',requestedUsdt:1,position});
    expect(result).toMatchObject({action:'SELL',quantity:.0015,amountUsdt:15});
  });
  it('refuses an unaligned position instead of creating a partial SELL',()=>{
    expect(applyRisk({...base,action:'SELL',position:{...position,quantity:.00155}})).toMatchObject({action:'HOLD'});
  });
  it('rejects below minimum',()=>expect(applyRisk({...base,action:'BUY',requestedUsdt:2,position:null}).action).toBe('HOLD'));
  it('never spends above cash',()=>expect(applyRisk({...base,action:'BUY',requestedUsdt:999,position:null}).amountUsdt).toBeLessThanOrEqual(20));
});
