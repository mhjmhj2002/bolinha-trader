import type { Candle } from '@bolinha/market-data';
import type { SymbolRules } from '@bolinha/core';
import type { BrokerGateway, ExchangeOrder, ExchangeFill } from '../index.js';
import { getB3SymbolRules } from './types.js';

export interface MT5BridgeOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export class B3MetaTraderBridge implements BrokerGateway {
  private url: string;
  private timeoutMs: number;

  constructor(
    private ticker: string = 'PETR4',
    options: MT5BridgeOptions = {},
    private fetchFn: typeof fetch = fetch,
  ) {
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8000;
    this.url = `http://${host}:${port}`;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async candles(interval: '1m' | '5m' | '15m', limit = 100): Promise<Candle[]> {
    try {
      const response = await this.fetchFn(
        `${this.url}/api/v1/candles?symbol=${this.ticker}&timeframe=${interval}&limit=${limit}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (!response.ok) throw new Error(`MT5 Bridge HTTP ${response.status}`);
      const json = await response.json() as any[];
      return json.map((c) => ({
        openTime: Number(c.time || c.openTime),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume || c.tick_volume),
        closeTime: Number(c.closeTime || c.time + 59999),
      }));
    } catch (error) {
      throw new Error(`MT5 Bridge candle fetch failed for ${this.ticker}: ${error instanceof Error ? error.message : 'network error'}`);
    }
  }

  async rules(): Promise<SymbolRules> {
    return getB3SymbolRules(this.ticker);
  }

  async price(): Promise<number> {
    try {
      const response = await this.fetchFn(
        `${this.url}/api/v1/tick?symbol=${this.ticker}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (!response.ok) throw new Error(`MT5 Bridge HTTP ${response.status}`);
      const json = await response.json() as { last?: number; bid?: number; ask?: number };
      const price = json.last ?? json.ask ?? json.bid;
      if (!price || !Number.isFinite(price)) throw new Error('Invalid price received from MT5 Bridge');
      return price;
    } catch (error) {
      throw new Error(`MT5 Bridge price fetch failed for ${this.ticker}: ${error instanceof Error ? error.message : 'network error'}`);
    }
  }

  async pingPublic(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.url}/health`, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async pingPrivate(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.url}/api/v1/account`, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async orderByClientId(clientOrderId: string): Promise<ExchangeOrder | null> {
    try {
      const response = await this.fetchFn(
        `${this.url}/api/v1/order?clientOrderId=${clientOrderId}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`MT5 Bridge HTTP ${response.status}`);
      const data = await response.json() as any;
      return this.mapOrder(data);
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) return null;
      throw error;
    }
  }

  async placeMarketOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    clientOrderId: string,
  ): Promise<ExchangeOrder> {
    try {
      const response = await this.fetchFn(`${this.url}/api/v1/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: this.ticker,
          side,
          quantity,
          clientOrderId,
          type: 'MARKET',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(`MT5 Bridge order submission error: HTTP ${response.status} ${errorBody?.message ?? ''}`);
      }
      const data = await response.json();
      return this.mapOrder(data);
    } catch (error) {
      throw new Error(`MT5 Bridge order failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private mapOrder(data: any): ExchangeOrder {
    const fills: ExchangeFill[] = (data.fills ?? []).map((f: any) => ({
      price: Number(f.price),
      qty: Number(f.qty ?? f.quantity),
      commission: Number(f.commission ?? 0),
      commissionAsset: String(f.commissionAsset ?? 'BRL'),
      tradeId: f.tradeId ? String(f.tradeId) : null,
    }));

    return {
      clientOrderId: String(data.clientOrderId),
      orderId: String(data.orderId),
      status: String(data.status ?? 'FILLED'),
      side: data.side,
      executedQty: Number(data.executedQty ?? data.quantity),
      cummulativeQuoteQty: Number(data.cummulativeQuoteQty ?? data.totalFinancial ?? 0),
      fills,
      commission: Number(data.commission ?? fills.reduce((acc, f) => acc + f.commission, 0)),
      transactTime: data.transactTime ? new Date(data.transactTime) : new Date(),
    };
  }
}
