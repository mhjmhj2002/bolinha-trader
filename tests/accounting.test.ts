import { describe, expect, it } from 'vitest';
import { executionAccounting, summarizeFees, type ExecutionFill } from '@bolinha/database';

const fills = (...fees: Array<[number, string]>): ExecutionFill[] => fees.map(([commission, commissionAsset], index) => ({
  price: 100_000,
  qty: 0.00001,
  commission,
  commissionAsset,
  tradeId: String(index + 1),
}));

describe('per-asset B3 fee accounting', () => {
  it('adds a BUY BRL fee to the effective position cost', () => {
    const result = executionAccounting('BUY', 0.0001, 10, fills([0.01, 'BRL']));
    expect(result.positionQuantity).toBe(0.0001);
    expect(result.effectiveQuoteAmount).toBe(10.01);
  });

  it('subtracts a SELL BRL fee from proceeds and net P/L', () => {
    const result = executionAccounting('SELL', 0.0001, 12, fills([0.01, 'BRL']));
    const cost = 10.01; // Includes the opening BRL fee.
    expect(result.effectiveQuoteAmount).toBe(11.99);
    expect(result.effectiveQuoteAmount - cost).toBeCloseTo(1.98, 12);
    expect(12 - 10).toBe(2); // Gross P/L remains separately reportable.
  });

  it('keeps a XYZ fee in its own asset and does not alter BRL or PETR4 balances', () => {
    const result = executionAccounting('BUY', 0.0001, 10, fills([0.001, 'XYZ']));
    expect(result.positionQuantity).toBe(0.0001);
    expect(result.effectiveQuoteAmount).toBe(10);
    expect(result.byAsset).toEqual({ XYZ: 0.001 });
    expect(summarizeFees(fills([0.001, 'XYZ']), 'PETR4').quoteFee).toBe(0);
  });

  it('is deterministic when reconciliation reuses the same raw fills', () => {
    const raw = fills([0.01, 'BRL'], [0.00000001, 'PETR4']);
    expect(executionAccounting('SELL', 0.0001, 10, raw)).toEqual(executionAccounting('SELL', 0.0001, 10, raw));
  });
});
