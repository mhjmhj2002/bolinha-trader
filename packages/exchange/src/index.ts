import type { Candle } from '@bolinha/market-data';
import { config, type SymbolRules } from '@bolinha/core';
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
  ticker?: string;
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
  placeMarketOrder(side: 'BUY' | 'SELL', quantity: number, clientOrderId: string, minPrice?: number): Promise<ExchangeOrder>;
  pingPublic(): Promise<boolean>;
  pingPrivate(): Promise<boolean>;
  orderByClientId(clientOrderId: string): Promise<ExchangeOrder | null>;
  setTicker?(ticker: string): void;
  syncPosition?(position: { ticker: string; quantity: number; entryPrice: number; costBrl: number } | null): void;
  getMarketData?(): import('./b3/index.js').B3MarketDataService;
}
import { B3PaperBroker, defaultB3MarketDataService, B3MarketDataService } from './b3/index.js';
export * from './b3/index.js';

/**
 * Cria o broker da B3 (paper trading) para o ticker informado.
 * A banca inicial vem de `config.INITIAL_BANK_BRL` (`@bolinha/core`), nunca de um
 * literal: assim alterar a variável no `.env` muda efetivamente o caixa do broker.
 * O parâmetro `initialBankBrl` permite que chamadores que já conhecem a configuração
 * operacional (ex.: linha `trading_configuration` do PostgreSQL) a informem
 * explicitamente, sem quebrar chamadas existentes de 1 ou 2 argumentos.
 */
export function createBrokerGateway(
  ticker: string = 'PETR4',
  marketData: B3MarketDataService = defaultB3MarketDataService,
  initialBankBrl: number = config.INITIAL_BANK_BRL,
): BrokerGateway {
  return new B3PaperBroker(ticker, initialBankBrl, marketData);
}
