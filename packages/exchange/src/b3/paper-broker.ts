import { randomBytes } from 'node:crypto';
import type { Candle } from '@bolinha/market-data';
import type { SymbolRules } from '@bolinha/core';
import type { BrokerGateway, ExchangeOrder, ExchangeFill } from '../index.js';
import { calculateB3Fees, getB3SymbolRules, parseB3Ticker } from './types.js';
import { B3MarketDataService } from './market-data.js';

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
    initialBankBrl = 100.0,
    private marketData: B3MarketDataService = new B3MarketDataService(),
    private slippagePct = 0.0005, // 0.05% slippage simulado
  ) {
    this.accountState = {
      initialBankBrl,
      cashBrl: initialBankBrl,
      realizedPnlBrl: 0,
    };
  }

  getAccount(): B3PaperAccount {
    return { ...this.accountState };
  }

  getPosition(): B3PositionState | null {
    return this.currentPosition ? { ...this.currentPosition } : null;
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
  ): Promise<ExchangeOrder> {
    const rules = await this.rules();
    if (quantity < rules.minQty) {
      throw new Error(`Order quantity ${quantity} is below minimum ${rules.minQty}`);
    }
    if (quantity % rules.stepSize !== 0) {
      throw new Error(`Order quantity ${quantity} must be a multiple of lot step ${rules.stepSize}`);
    }

    const currentPrice = await this.price();
    const slippageFactor = side === 'BUY' ? (1 + this.slippagePct) : (1 - this.slippagePct);
    const executionPrice = Number((currentPrice * slippageFactor).toFixed(2));
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
    };

    this.orders.set(clientOrderId, order);
    return order;
  }
}
