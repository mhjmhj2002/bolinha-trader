import { createHmac } from 'node:crypto';
import type { Candle } from '@bolinha/market-data';
import type { Action, SymbolRules } from '@bolinha/core';
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
export interface BinanceGateway {
  candles(interval: '1m' | '5m' | '15m', limit?: number): Promise<Candle[]>;
  rules(): Promise<SymbolRules>;
  price(): Promise<number>;
  placeMarketOrder(side: 'BUY' | 'SELL', quantity: number, clientOrderId: string): Promise<ExchangeOrder>;
  pingPublic(): Promise<boolean>;
  pingPrivate(): Promise<boolean>;
  orderByClientId(clientOrderId: string): Promise<ExchangeOrder | null>;
}
const PUBLIC = 'https://api.binance.com';
const TESTNET = 'https://testnet.binance.vision';
export class BinanceTestnetClient implements BinanceGateway {
  private rulesCache: SymbolRules | null = null;
  private timeOffset: number | null = null;
  private lastTimeSync = 0;

  constructor(
    private apiKey: string,
    private secret: string,
    private symbol = 'BTCUSDT',
    private fetchFn: typeof fetch = fetch,
    private recvWindowMs = 60_000,
  ) {}

  private async publicJson(path: string): Promise<any> {
    const r = await this.fetchFn(`${PUBLIC}${path}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`Binance public HTTP ${r.status}`);
    return r.json();
  }

  private async testnetJson(path: string): Promise<any> {
    const r = await this.fetchFn(`${TESTNET}${path}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`Binance Testnet HTTP ${r.status}`);
    return r.json();
  }

  async syncTimeOffset(force = false): Promise<number> {
    const now = Date.now();
    // Cache offset por até 10 minutos a menos que forçado
    if (!force && this.timeOffset !== null && now - this.lastTimeSync < 600_000) {
      return this.timeOffset;
    }
    try {
      const t0 = Date.now();
      const r = await this.fetchFn(`${TESTNET}/api/v3/time`, { signal: AbortSignal.timeout(12_000) });
      const t1 = Date.now();
      if (r && r.ok) {
        const data = await r.clone().json().catch(() => null);
        const serverTime = Number(data?.serverTime);
        if (Number.isFinite(serverTime) && serverTime > 0) {
          const estimatedLocalTime = Math.round((t0 + t1) / 2);
          this.timeOffset = serverTime - estimatedLocalTime;
          this.lastTimeSync = Date.now();
          return this.timeOffset;
        }
      }
    } catch {
      // Ignora falha em mocks ou rede, mantendo timeOffset = 0
    }
    this.timeOffset = 0;
    this.lastTimeSync = Date.now();
    return this.timeOffset;
  }

  getTimeOffset(): number | null {
    return this.timeOffset;
  }

  private async executeSigned(path: string, params: URLSearchParams, method: 'GET' | 'POST'): Promise<any> {
    if (!this.apiKey || !this.secret)
      throw new Error('Binance Testnet credentials are required for execution');

    // Assegura sincronização de relógio se ainda não sincronizado
    if (this.timeOffset === null) {
      try {
        await this.syncTimeOffset();
      } catch {
        // Fallback defensivo para offset 0 se falhar a chamada de tempo
        this.timeOffset = 0;
      }
    }

    const effectiveTime = Date.now() + (this.timeOffset ?? 0);
    params.set('timestamp', String(effectiveTime));
    params.set('recvWindow', String(this.recvWindowMs));
    const sig = createHmac('sha256', this.secret).update(params.toString()).digest('hex');
    const r = await this.fetchFn(`${TESTNET}${path}?${params}&signature=${sig}`, {
      method,
      headers: { 'X-MBX-APIKEY': this.apiKey },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { code?: number; msg?: string } | null;
      const error = new Error(
        `Binance Testnet HTTP ${r.status}${body?.code !== undefined ? ` (${body.code})` : ''}${body?.msg ? `: ${body.msg}` : ''}`,
      ) as Error & { code?: number };
      if (body?.code !== undefined) {
        error.code = body.code;
      }
      throw error;
    }
    return r.json();
  }

  private async signed(path: string, params: URLSearchParams, method: 'GET' | 'POST' = 'GET'): Promise<any> {
    try {
      return await this.executeSigned(path, new URLSearchParams(params), method);
    } catch (error) {
      // Se ocorrer erro -1021 (timestamp outside recvWindow), invalida offset, ressincroniza e tenta 1 vez
      const isRecvWindowError =
        (error instanceof Error && error.message.includes('(-1021)')) ||
        (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === -1021);

      if (isRecvWindowError) {
        this.timeOffset = null;
        await this.syncTimeOffset(true);
        return await this.executeSigned(path, new URLSearchParams(params), method);
      }
      throw error;
    }
  }
  async candles(interval: '1m' | '5m' | '15m', limit = 100): Promise<Candle[]> {
    const rows = await this.publicJson(
      `/api/v3/klines?symbol=${this.symbol}&interval=${interval}&limit=${limit}`,
    );
    return rows.map((r: any[]) => ({
      openTime: r[0],
      open: +r[1],
      high: +r[2],
      low: +r[3],
      close: +r[4],
      volume: +r[5],
      closeTime: r[6],
    }));
  }
  async rules(): Promise<SymbolRules> {
    if (this.rulesCache) return this.rulesCache;
    const x = await this.testnetJson(`/api/v3/exchangeInfo?symbol=${this.symbol}`);
    const f = x.symbols[0].filters;
    const marketLot = f.find((v: any) => v.filterType === 'MARKET_LOT_SIZE');
    const lot = marketLot && Number(marketLot.stepSize) > 0 ? marketLot : f.find((v: any) => v.filterType === 'LOT_SIZE');
    const notional =
      f.find((v: any) => v.filterType === 'NOTIONAL') ?? f.find((v: any) => v.filterType === 'MIN_NOTIONAL');
    if (!lot || !notional || Number(lot.minQty) <= 0 || Number(lot.stepSize) <= 0 || Number(notional.minNotional) <= 0) throw new Error('Binance Testnet symbol rules are incomplete');
    this.rulesCache = { minNotional: +notional.minNotional, minQty: +lot.minQty, stepSize: +lot.stepSize };
    return this.rulesCache;
  }
  async price(): Promise<number> {
    return +(await this.publicJson(`/api/v3/ticker/price?symbol=${this.symbol}`)).price;
  }
  async placeMarketOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    clientOrderId: string,
  ): Promise<ExchangeOrder> {
    const data = await this.signed(
      '/api/v3/order',
      new URLSearchParams({
        symbol: this.symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''),
        newClientOrderId: clientOrderId,
        newOrderRespType: 'FULL',
      }),
      'POST',
    );
    return this.mapOrder(data);
  }
  async orderByClientId(clientOrderId: string): Promise<ExchangeOrder | null> {
    try {
      const order = await this.signed(
          '/api/v3/order',
          new URLSearchParams({ symbol: this.symbol, origClientOrderId: clientOrderId }),
        );
      // GET /order does not include fills. Fetching the account trades is what
      // makes crash recovery use the same fee evidence as the original FULL
      // order response.
      const fills = order.status === 'FILLED'
        ? await this.signed('/api/v3/myTrades', new URLSearchParams({ symbol: this.symbol, orderId: String(order.orderId) }))
        : [];
      return this.mapOrder(order, fills);
    } catch (error) {
      if (error instanceof Error && error.message.includes('(-2013)')) return null;
      throw error;
    }
  }
  async pingPublic() {
    try {
      await this.publicJson('/api/v3/ping');
      return true;
    } catch {
      return false;
    }
  }
  async pingPrivate() {
    try {
      await this.signed('/api/v3/account', new URLSearchParams());
      return true;
    } catch {
      return false;
    }
  }
  private mapOrder(data: any, fillsOverride?: any[]): ExchangeOrder {
    const rawFills = fillsOverride ?? data.fills ?? [];
    const fills: ExchangeFill[] = rawFills.map((f: any) => ({
      price: +f.price,
      qty: +f.qty,
      commission: +f.commission || 0,
      commissionAsset: String(f.commissionAsset ?? ''),
      tradeId: f.tradeId === undefined && f.id === undefined ? null : String(f.tradeId ?? f.id),
    }));
    // Query Order responses do not contain transactTime.  Binance documents
    // updateTime and time for that endpoint, so never turn an absent field
    // into an Invalid Date and silently persist it in the ledger.
    const timestamp = data.transactTime ?? data.updateTime ?? data.time;
    const timestampMs = typeof timestamp === 'number'
      ? timestamp
      : typeof timestamp === 'string' && /^\d+$/.test(timestamp) ? Number(timestamp) : NaN;
    if (!Number.isFinite(timestampMs) || timestampMs <= 0)
      throw new Error('Binance order response does not contain a valid execution timestamp');
    const transactTime = new Date(timestampMs);
    if (Number.isNaN(transactTime.getTime()))
      throw new Error('Binance order response produced an invalid execution timestamp');
    return {
      clientOrderId: data.clientOrderId,
      orderId: String(data.orderId),
      status: String(data.status),
      side: data.side,
      executedQty: +data.executedQty,
      cummulativeQuoteQty: +data.cummulativeQuoteQty,
      fills,
      commission: fills.reduce((sum, fill) => sum + fill.commission, 0),
      transactTime,
    };
  }
}
