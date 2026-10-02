import { describe, expect, it } from 'vitest';
import { executionAccounting, summarizeFees, type ExecutionFill } from '@bolinha/database';

const fills = (...fees: Array<[number, string]>): ExecutionFill[] => fees.map(([commission, commissionAsset], index) => ({
  price: 100_000,
  qty: 0.00001,
  commission,
  commissionAsset,
  tradeId: String(index + 1),
}));

describe('per-asset Binance fee accounting', () => {
  it('makes a BUY BTC position net of a BTC fee while preserving quote cost', () => {
    const result = executionAccounting('BUY', 0.00007, 7, fills([0.00000007, 'BTC']));
    expect(result.positionQuantity).toBeCloseTo(0.00006993, 12);
    expect(result.effectiveQuoteAmount).toBe(7);
  });

  it('adds a BUY USDT fee to the effective position cost', () => {
    const result = executionAccounting('BUY', 0.0001, 10, fills([0.01, 'USDT']));
    expect(result.positionQuantity).toBe(0.0001);
    expect(result.effectiveQuoteAmount).toBe(10.01);
  });

  it('subtracts a SELL USDT fee from proceeds and net P/L', () => {
    const result = executionAccounting('SELL', 0.0001, 12, fills([0.01, 'USDT']));
    const cost = 10.01; // Includes the opening USDT fee.
    expect(result.effectiveQuoteAmount).toBe(11.99);
    expect(result.effectiveQuoteAmount - cost).toBeCloseTo(1.98, 12);
    expect(12 - 10).toBe(2); // Gross P/L remains separately reportable.
  });

  it('makes a SELL BTC fee part of the BTC quantity consumed by the close', () => {
    const result = executionAccounting('SELL', 0.0000699, 7, fills([0.00000003, 'BTC']));
    expect(result.positionQuantity).toBeCloseTo(0.00006993, 12);
  });

  it('keeps a BNB fee in its own asset and does not alter USDT or BTC balances', () => {
    const result = executionAccounting('BUY', 0.0001, 10, fills([0.001, 'BNB']));
    expect(result.positionQuantity).toBe(0.0001);
    expect(result.effectiveQuoteAmount).toBe(10);
    expect(result.byAsset).toEqual({ BNB: 0.001 });
    expect(summarizeFees(fills([0.001, 'BNB'])).quoteFee).toBe(0);
  });

  it('is deterministic when reconciliation reuses the same raw fills', () => {
    const raw = fills([0.01, 'USDT'], [0.00000001, 'BTC']);
    expect(executionAccounting('SELL', 0.0001, 10, raw)).toEqual(executionAccounting('SELL', 0.0001, 10, raw));
  });
});
