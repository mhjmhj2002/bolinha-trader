import { randomBytes } from 'node:crypto';
import type { Candle } from '@bolinha/market-data';
import type { SymbolRules } from '@bolinha/core';
import { B3_PAPER_SLIPPAGE_PCT, b3ExecutionPrice, config } from '@bolinha/core';
import type { BrokerGateway, ExchangeOrder, ExchangeFill } from '../index.js';
import { calculateB3Fees, getB3SymbolRules, parseB3Ticker } from './types.js';
import { B3MarketDataService, defaultB3MarketDataService } from './market-data.js';

export interface B3PaperAccount {
  initialBankBrl: number;
  cashBrl: number;
  realizedPnlBrl: number;
}

export interface B3PositionState {
  ticker: string;
  quantity: number;
  entryPrice: number;
  costBrl: number;
}

export class B3PaperBroker implements BrokerGateway {
  private static globalOrderCounter = 0;
  private orders = new Map<string, ExchangeOrder>();
  private currentPosition: B3PositionState | null = null;
  private accountState: B3PaperAccount;
  private readonly instanceId = randomBytes(4).toString('hex');

  constructor(
    private ticker: string = 'PETR4',
    // A banca inicial vem de `config.INITIAL_BANK_BRL` (`@bolinha/core`), nunca de um
    // literal (AGENTS.md §2.2). O parâmetro continua opcional para chamadores que já
    // conhecem a configuração operacional (ex.: linha `trading_configuration` no PG).
    initialBankBrl: number = config.INITIAL_BANK_BRL,
    private marketData: B3MarketDataService = defaultB3MarketDataService,
    private slippagePct = B3_PAPER_SLIPPAGE_PCT, // 0.05% slippage simulado (fonte única em @bolinha/core)
  ) {
    this.accountState = {
      initialBankBrl,
      cashBrl: initialBankBrl,
      realizedPnlBrl: 0,
    };
  }

  getMarketData(): B3MarketDataService {
    return this.marketData;
  }

  setTicker(ticker: string): void {
    this.ticker = ticker.trim().toUpperCase();
  }

  getTicker(): string {
    return this.ticker;
  }

  getAccount(): B3PaperAccount {
    return { ...this.accountState };
  }

  getPosition(): B3PositionState | null {
    return this.currentPosition ? { ...this.currentPosition } : null;
  }

  syncPosition(position: { ticker: string; quantity: number; entryPrice: number; costBrl: number } | null): void {
    if (!position || position.quantity <= 0) {
      this.currentPosition = null;
    } else {
      this.currentPosition = {
        ticker: position.ticker.trim().toUpperCase(),
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        costBrl: position.costBrl,
      };
      this.ticker = this.currentPosition.ticker;
    }
  }

  async candles(interval: '1m' | '5m' | '15m', limit = 100): Promise<Candle[]> {
    return this.marketData.candles(this.ticker, interval, limit);
  }

  async rules(): Promise<SymbolRules> {
    return getB3SymbolRules(this.ticker);
  }

  async price(): Promise<number> {
    return this.marketData.price(this.ticker);
  }

  async pingPublic(): Promise<boolean> {
    return true;
  }

  async pingPrivate(): Promise<boolean> {
    return true;
  }

  async orderByClientId(clientOrderId: string): Promise<ExchangeOrder | null> {
    return this.orders.get(clientOrderId) ?? null;
  }

  async placeMarketOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    clientOrderId: string,
    minPrice?: number,
  ): Promise<ExchangeOrder> {
    const rules = await this.rules();
    if (quantity < rules.minQty) {
      throw new Error(`Order quantity ${quantity} is below minimum ${rules.minQty}`);
    }
    if (quantity % rules.stepSize !== 0) {
      throw new Error(`Order quantity ${quantity} must be a multiple of lot step ${rules.stepSize}`);
    }

    const currentPrice = await this.price();
    const slippagePct = side === 'BUY' ? this.slippagePct : -this.slippagePct;
    const executionPrice = b3ExecutionPrice(currentPrice, slippagePct);

    if (side === 'SELL' && minPrice !== undefined && executionPrice < minPrice) {
      throw new Error(
        `Execution price R$ ${executionPrice.toFixed(2)} is below minimum allowed price R$ ${minPrice.toFixed(2)} (slippage guard)`,
      );
    }

    const grossFinancial = Number((executionPrice * quantity).toFixed(2));
    const commission = calculateB3Fees(grossFinancial);

    if (side === 'BUY') {
      const totalCost = grossFinancial + commission;
      if (this.accountState.cashBrl < totalCost) {
        throw new Error(`Insufficient funds: need R$ ${totalCost.toFixed(2)}, available R$ ${this.accountState.cashBrl.toFixed(2)}`);
      }
      this.accountState.cashBrl = Number((this.accountState.cashBrl - totalCost).toFixed(2));
      const newQuantity = (this.currentPosition?.quantity ?? 0) + quantity;
      const newCost = (this.currentPosition?.costBrl ?? 0) + totalCost;
      this.currentPosition = {
        ticker: this.ticker,
        quantity: newQuantity,
        entryPrice: Number((newCost / newQuantity).toFixed(4)),
        costBrl: newCost,
      };
    } else {
      if (!this.currentPosition || this.currentPosition.quantity < quantity) {
        throw new Error(`Insufficient position to sell: required ${quantity}, have ${this.currentPosition?.quantity ?? 0}`);
      }
      const netReceived = grossFinancial - commission;
      const proportion = quantity / this.currentPosition.quantity;
      const costOfSold = this.currentPosition.costBrl * proportion;
      const tradePnl = netReceived - costOfSold;

      this.accountState.cashBrl = Number((this.accountState.cashBrl + netReceived).toFixed(2));
      this.accountState.realizedPnlBrl = Number((this.accountState.realizedPnlBrl + tradePnl).toFixed(2));

      if (this.currentPosition.quantity === quantity) {
        this.currentPosition = null;
      } else {
        this.currentPosition.quantity -= quantity;
        this.currentPosition.costBrl -= costOfSold;
      }
    }

    B3PaperBroker.globalOrderCounter++;
    const uniqueSuffix = `${Date.now()}-${this.instanceId}-${B3PaperBroker.globalOrderCounter}`;
    const fill: ExchangeFill = {
      price: executionPrice,
      qty: quantity,
      commission,
      commissionAsset: 'BRL',
      tradeId: `B3-TRADE-${uniqueSuffix}`,
    };

    const order: ExchangeOrder = {
      clientOrderId,
      orderId: `B3-ORD-${uniqueSuffix}`,
      status: 'FILLED',
      side,
      executedQty: quantity,
      cummulativeQuoteQty: grossFinancial,
      fills: [fill],
      commission,
      transactTime: new Date(),
      ticker: this.ticker,
    };

    this.orders.set(clientOrderId, order);
    return order;
  }
}
