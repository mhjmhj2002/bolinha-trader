import type { Candle } from '@bolinha/market-data';
import type { SymbolRules } from '@bolinha/core';
export interface ExchangeOrder {
  clientOrderId: string;
  orderId: string;
  status: string;
  side: 'BUY' | 'SELL';
  executedQty: number;
  cummulativeQuoteQty: number;
  fills: ExchangeFill[];
  /** Kept for compatibility with callers predating per-fill accounting. */
  commission: number;
  transactTime: Date;
}
export interface ExchangeFill {
  price: number;
  qty: number;
  commission: number;
  commissionAsset: string;
  tradeId?: string | null;
}
export interface BrokerGateway {
  candles(interval: '1m' | '5m' | '15m', limit?: number): Promise<Candle[]>;
  rules(): Promise<SymbolRules>;
  price(): Promise<number>;
  placeMarketOrder(side: 'BUY' | 'SELL', quantity: number, clientOrderId: string): Promise<ExchangeOrder>;
  pingPublic(): Promise<boolean>;
  pingPrivate(): Promise<boolean>;
  orderByClientId(clientOrderId: string): Promise<ExchangeOrder | null>;
}
import { B3PaperBroker } from './b3/index.js';
export * from './b3/index.js';

/** Cria o broker da B3 (paper trading) para o ticker informado. */
export function createBrokerGateway(ticker: string = 'PETR4'): BrokerGateway {
  return new B3PaperBroker(ticker);
}
