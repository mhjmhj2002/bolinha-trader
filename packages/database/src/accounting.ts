export type ExecutionFill = {
  price: number;
  qty: number;
  commission: number;
  commissionAsset: string;
  tradeId?: string | null;
};

export type FeeSummary = {
  byAsset: Record<string, number>;
  baseFee: number;
  quoteFee: number;
};

/**
 * The broker reports the asset of every commission.  Keep that unit intact: only
 * BRL commissions can affect a BRL ledger without a historical conversion.
 */
export const summarizeFees = (fills: readonly ExecutionFill[], baseAsset = '', quoteAsset = 'BRL'): FeeSummary => {
  const byAsset: Record<string, number> = {};
  for (const fill of fills) {
    if (!Number.isFinite(fill.commission) || fill.commission === 0) continue;
    const asset = fill.commissionAsset.toUpperCase();
    byAsset[asset] = (byAsset[asset] ?? 0) + fill.commission;
  }
  return {
    byAsset,
    baseFee: byAsset[baseAsset.toUpperCase()] ?? 0,
    quoteFee: byAsset[quoteAsset.toUpperCase()] ?? 0,
  };
};

export const executionAccounting = (
  side: 'BUY' | 'SELL',
  quantity: number,
  quoteAmount: number,
  fills: readonly ExecutionFill[],
) => {
  const fees = summarizeFees(fills);
  return {
    ...fees,
    // This is the quantity which belongs to (BUY) or is consumed from (SELL)
    // the conceptual position.  Other third-asset fees never
    // change either inventory or BRL cash.
    positionQuantity: side === 'BUY' ? quantity - fees.baseFee : quantity + fees.baseFee,
    // Effective BRL cost/proceeds. Other assets intentionally have no made-up
    // BRL valuation.
    effectiveQuoteAmount: side === 'BUY' ? quoteAmount + fees.quoteFee : quoteAmount - fees.quoteFee,
  };
};
