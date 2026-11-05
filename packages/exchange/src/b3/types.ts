import type { Candle } from '@bolinha/market-data';
import type { SymbolRules } from '@bolinha/core';
import { B3_MIN_NOTIONAL_BRL, b3Fee } from '@bolinha/core';
import type { ExchangeOrder, ExchangeFill } from '../index.js';

export interface B3TickerInfo {
  ticker: string;
  isFractional: boolean;
  baseTicker: string;
  defaultLotSize: number;
}

export function parseB3Ticker(ticker: string): B3TickerInfo {
  const clean = ticker.trim().toUpperCase();
  if (!/^[A-Z]{4}[0-9]{1,2}F?$/.test(clean) && !/^(WIN|WDO)[A-Z0-9$]+$/.test(clean)) {
    throw new Error(`Invalid B3 ticker format: ${ticker}`);
  }
  const isFractional = clean.endsWith('F') && clean.length > 5;
  const baseTicker = isFractional ? clean.slice(0, -1) : clean;
  return {
    ticker: clean,
    isFractional,
    baseTicker,
    defaultLotSize: 1,
  };
}

export function getB3SymbolRules(ticker: string): SymbolRules {
  const info = parseB3Ticker(ticker);
  return {
    minNotional: B3_MIN_NOTIONAL_BRL, // R$ 1,00 mínimo (fonte única em @bolinha/core)
    // Banca pequena (a partir de R$ 100): qualquer quantidade inteira de ações, de 1 em diante.
    minQty: 1,
    stepSize: 1,
  };
}

/**
 * Emolumentos e Taxas da B3 para operações de Day Trade em Ações / Mercado à Vista:
 * - Emolumentos B3: ~0,0050%
 * - Taxa de Liquidação B3: ~0,0250%
 * Total B3 = ~0,0300% (0.0003 do volume financeiro)
 *
 * A taxa e a fórmula vivem em `@bolinha/core` (`b3-costs.ts`) para que o broker e o
 * dimensionamento de posição do motor de risco usem exatamente o mesmo custo.
 * Reexportado aqui para preservar a API pública de `@bolinha/exchange`.
 */
export { B3_DAY_TRADE_FEE_RATE } from '@bolinha/core';

export function calculateB3Fees(volumeFinancialBrl: number): number {
  return b3Fee(volumeFinancialBrl);
}

export interface B3MarketDataProvider {
  candles(ticker: string, interval: '1m' | '5m' | '15m', limit?: number): Promise<Candle[]>;
  price(ticker: string): Promise<number>;
}

export interface B3OrderRequest {
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  clientOrderId: string;
}

export interface B3ExecutionResult extends ExchangeOrder {
  ticker: string;
}

import type { EntryConfluenceResult, MarketSnapshot } from '@bolinha/market-data';

export interface B3AssetSetup {
  ticker: string;
  price: number;
  rsi1m: number;
  momentumPct: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  confluence?: EntryConfluenceResult | null;
  snapshot?: MarketSnapshot | null;
  candles?: Record<'1m' | '5m' | '15m', Candle[]> | null;
}

