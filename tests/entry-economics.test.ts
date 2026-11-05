import { describe, expect, it } from 'vitest';
import { applyB3Risk, computeEntryEconomics } from '@bolinha/risk-engine';

const base = {
  action: 'BUY' as const,
  requestedBrl: 90,
  price: 30,
  account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 },
  position: null,
  rules: { minQty: 1, stepSize: 1, minNotional: 1 },
  maxPositionPercent: 100,
  duplicateOrderPending: false,
  requireEntryConfluence: false,
  requireVwapAbove: false,
  stopLossPct: 0.012,
  maxStopLossPct: 0.018,
  fullTakeProfitPct: 0.015,
  profitTargetMode: 'NET' as const,
};

describe('TASK-35 entry economics', () => {
  it('computes net reward/risk after round-trip costs', () => {
    const eco = computeEntryEconomics({ stopPct: 0.012, targetPct: 0.015, profitTargetMode: 'NET' });
    expect(eco.netRiskPct).toBeGreaterThan(0.012);
    expect(eco.rewardRiskRatio).toBeLessThan(0.015 / 0.012);
  });

  it('keeps legacy behavior when gates are not configured', () => {
    expect(applyB3Risk(base).action).toBe('BUY');
  });

  it('rejects BUY below the minimum reward/risk ratio', () => {
    const res = applyB3Risk({ ...base, minRewardRiskRatio: 2 });
    expect(res.action).toBe('HOLD');
    expect(res.rejectionReason).toContain('reward/risk');
  });

  it('approves BUY meeting the ratio and reports it', () => {
    const res = applyB3Risk({ ...base, minRewardRiskRatio: 0.5 });
    expect(res.action).toBe('BUY');
    expect(res.rewardRiskRatio).toBeGreaterThan(0.5);
  });

  it('rejects BUY when target is not a multiple of round-trip cost', () => {
    const res = applyB3Risk({ ...base, fullTakeProfitPct: 0.001, minTargetCostMultiple: 3 });
    expect(res.action).toBe('HOLD');
    expect(res.rejectionReason).toContain('round-trip cost');
  });

  it('rejects BUY when the stop sits inside ATR noise', () => {
    const res = applyB3Risk({ ...base, atr: 0.6, minStopAtrMultiple: 1 });
    expect(res.action).toBe('HOLD');
    expect(res.rejectionReason).toContain('market noise');
  });
});

describe('TASK-36 risk-based sizing', () => {
  it('keeps legacy sizing when riskPerTradePct is not set', () => {
    expect(applyB3Risk(base).quantity).toBe(3);
  });

  it('caps quantity so loss at stop stays within the risk budget', () => {
    const res = applyB3Risk({ ...base, riskPerTradePct: 0.005 });
    expect(res.action).toBe('BUY');
    expect(res.quantity).toBe(1);
  });

  it('allows more shares with a larger risk budget but never above cash cap', () => {
    const res = applyB3Risk({ ...base, riskPerTradePct: 0.02 });
    expect(res.quantity).toBe(3);
  });

  it('rejects BUY when the minimum lot exceeds the risk budget (fail-closed)', () => {
    const res = applyB3Risk({ ...base, riskPerTradePct: 0.001 });
    expect(res.action).toBe('HOLD');
    expect(res.rejectionReason).toContain('risk budget');
  });
});
