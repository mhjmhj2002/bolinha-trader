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
 * Binance reports the asset of every commission.  Keep that unit intact: only
 * USDT commissions can affect a USDT ledger without a historical conversion.
 */
export const summarizeFees = (fills: readonly ExecutionFill[], baseAsset = 'BTC', quoteAsset = 'USDT'): FeeSummary => {
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
    // the conceptual BTC position.  BNB and other third-asset fees never
    // change either BTC inventory or USDT cash.
    positionQuantity: side === 'BUY' ? quantity - fees.baseFee : quantity + fees.baseFee,
    // Effective USDT cost/proceeds. Other assets intentionally have no made-up
    // USDT valuation.
    effectiveQuoteAmount: side === 'BUY' ? quoteAmount + fees.quoteFee : quoteAmount - fees.quoteFee,
  };
};
