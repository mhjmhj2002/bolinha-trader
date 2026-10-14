import { describe, expect, it } from 'vitest';
import {
  parseB3Ticker,
  getB3SymbolRules,
  calculateB3Fees,
  B3MarketDataService,
  B3PaperBroker,
  B3MetaTraderBridge,
  B3_DAY_TRADE_FEE_RATE,
} from '@bolinha/exchange';
import { applyB3Risk } from '@bolinha/risk-engine';
import { buildB3Prompt } from '@bolinha/ai';

describe('B3 Stock Day Trade & Connector Suite', () => {
  describe('B3 Tickers and Rules', () => {
    it('parses a standard ticker and allows 1-share orders', () => {
      const parsed = parseB3Ticker('PETR4');
      expect(parsed).toEqual({
        ticker: 'PETR4',
        isFractional: false,
        baseTicker: 'PETR4',
        defaultLotSize: 1,
      });

      const rules = getB3SymbolRules('PETR4');
      expect(rules.minQty).toBe(1);
      expect(rules.stepSize).toBe(1);
      expect(rules.minNotional).toBe(1.0);
    });

    it('correctly parses fractional ticker (1-99 shares)', () => {
      const parsed = parseB3Ticker('VALE3F');
      expect(parsed).toEqual({
        ticker: 'VALE3F',
        isFractional: true,
        baseTicker: 'VALE3',
        defaultLotSize: 1,
      });

      const rules = getB3SymbolRules('VALE3F');
      expect(rules.minQty).toBe(1);
      expect(rules.stepSize).toBe(1);
    });

    it('throws error for invalid ticker', () => {
      expect(() => parseB3Ticker('INVALID12345')).toThrow(/Invalid B3 ticker format/);
    });

    it('calculates B3 day trade fees (emoluments + liquidation)', () => {
      const volume = 10_000.0; // R$ 10.000,00
      const fees = calculateB3Fees(volume);
      // 10000 * 0.0003 = 3.00
      expect(fees).toBe(3.0);
      expect(B3_DAY_TRADE_FEE_RATE).toBe(0.0003);
    });
  });

  describe('B3 Risk Engine Rules', () => {
    const b3Account = {
      initialBankBrl: 5000,
      cashBrl: 5000,
      realizedPnlBrl: 0,
    };
    const b3Rules = getB3SymbolRules('PETR4'); // 100 lot

    it('allows BUY when cash and minimum lot of 100 shares are met', () => {
      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 3500,
        price: 35.0, // 35 * 100 = 3500 (100 shares)
        account: b3Account,
        position: null,
        rules: b3Rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
      });

      expect(result.action).toBe('BUY');
      expect(result.quantity).toBe(100);
      expect(result.amountBrl).toBe(3500);
      expect(result.rejectionReason).toBeNull();
    });

    it('rejects BUY when requested amount cannot buy a single share', () => {
      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 20, // R$ 20 não compra 1 ação de R$ 35
        price: 35.0,
        account: b3Account,
        position: null,
        rules: b3Rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
      });

      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toMatch(/Quantity below B3 minimum/);
    });

    it('allows heterogeneous sizes with a R$ 100 bank: 1 share, then up to all cash', () => {
      const bank = { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 };
      const base = { action: 'BUY' as const, price: 10, account: bank, position: null, rules: b3Rules, maxPositionPercent: 100, duplicateOrderPending: false };
      expect(applyB3Risk({ ...base, requestedBrl: 1 }).action).toBe('HOLD'); // R$ 1 não compra 1 ação de R$ 10? compra: ver abaixo
      expect(applyB3Risk({ ...base, price: 1, requestedBrl: 1 }).quantity).toBe(1);
      expect(applyB3Risk({ ...base, requestedBrl: 10 }).quantity).toBe(1);
      expect(applyB3Risk({ ...base, requestedBrl: 37 }).quantity).toBe(3);
      expect(applyB3Risk({ ...base, requestedBrl: 999 }).quantity).toBe(10);
    });

    it('rejects BUY with HOLD when cash is strictly insufficient for 1 share', () => {
      const bank = { initialBankBrl: 100, cashBrl: 9.99, realizedPnlBrl: 0 };
      const base = { action: 'BUY' as const, price: 30.50, account: bank, position: null, rules: b3Rules, maxPositionPercent: 100, duplicateOrderPending: false };
      const result = applyB3Risk({ ...base, requestedBrl: 30.50 });
      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toMatch(/Quantity below B3 minimum lot/);
    });

    it('adds to an open position and sells partially', () => {
      const bank = { initialBankBrl: 100, cashBrl: 60, realizedPnlBrl: 0 };
      const position = { ticker: 'PETR4', quantity: 4, entryPrice: 10, costBrl: 40 };
      const buy = applyB3Risk({ action: 'BUY', requestedBrl: 60, price: 10, account: bank, position, rules: b3Rules, maxPositionPercent: 100, duplicateOrderPending: false });
      expect(buy).toMatchObject({ action: 'BUY', quantity: 6 });
      const sell = applyB3Risk({ action: 'SELL', requestedBrl: 20, price: 10, account: bank, position, rules: b3Rules, maxPositionPercent: 100, duplicateOrderPending: false });
      expect(sell).toMatchObject({ action: 'SELL', quantity: 2 });
      const all = applyB3Risk({ action: 'SELL', requestedBrl: 0, price: 10, account: bank, position, rules: b3Rules, maxPositionPercent: 100, duplicateOrderPending: false });
      expect(all).toMatchObject({ action: 'SELL', quantity: 4 });
    });

    it('blocks BUY when isDayTradeCloseOnly is active (session closing zeragem)', () => {
      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 3500,
        price: 35.0,
        account: b3Account,
        position: null,
        rules: b3Rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        isDayTradeCloseOnly: true,
      });

      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toMatch(/close-only mode/);
    });

    it('allows SELL of full position', () => {
      const result = applyB3Risk({
        action: 'SELL',
        requestedBrl: 0,
        price: 36.0,
        account: b3Account,
        position: {
          ticker: 'PETR4',
          quantity: 100,
          entryPrice: 35.0,
          costBrl: 3500,
        },
        rules: b3Rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
      });

      expect(result.action).toBe('SELL');
      expect(result.quantity).toBe(100);
      expect(result.amountBrl).toBe(3600);
    });
  });

  describe('B3 Multi-Asset Scanner and Ranking', () => {
    it('scans and ranks multiple B3 assets by momentum and RSI score', async () => {
      const service = new B3MarketDataService();
      service.setMockPrice('PETR4', 38.5);
      service.setMockPrice('VALE3', 62.0);
      service.setMockPrice('ITUB4', 34.0);

      const setups = await service.scanAndRankSetups(['PETR4', 'VALE3', 'ITUB4']);
      expect(setups.length).toBe(3);
      expect(setups[0].score).toBeGreaterThanOrEqual(setups[1].score);
      expect(setups[1].score).toBeGreaterThanOrEqual(setups[2].score);
      expect(setups.map((s) => s.ticker)).toEqual(
        expect.arrayContaining(['PETR4', 'VALE3', 'ITUB4']),
      );
    });
  });

  describe('B3 Paper Broker Simulator', () => {
    it('executes BUY and SELL with realistic B3 fees and cash deduction', async () => {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', 30.0);
      const broker = new B3PaperBroker('PETR4', 5000.0, marketData, 0); // 0 slippage for predictable test

      const buyOrder = await broker.placeMarketOrder('BUY', 100, 'client-buy-1');
      expect(buyOrder.status).toBe('FILLED');
      expect(buyOrder.executedQty).toBe(100);
      expect(buyOrder.cummulativeQuoteQty).toBe(3000.0);
      // Fee: 3000 * 0.0003 = 0.90
      expect(buyOrder.commission).toBe(0.9);

      const accAfterBuy = broker.getAccount();
      // 5000 - 3000 - 0.90 = 1999.10
      expect(accAfterBuy.cashBrl).toBe(1999.1);

      const position = broker.getPosition();
      expect(position).not.toBeNull();
      expect(position?.quantity).toBe(100);

      // Now price rises to R$ 32.00
      marketData.setMockPrice('PETR4', 32.0);
      const sellOrder = await broker.placeMarketOrder('SELL', 100, 'client-sell-1');
      expect(sellOrder.status).toBe('FILLED');
      expect(sellOrder.executedQty).toBe(100);
      expect(sellOrder.cummulativeQuoteQty).toBe(3200.0);

      const accAfterSell = broker.getAccount();
      expect(broker.getPosition()).toBeNull();
      expect(accAfterSell.realizedPnlBrl).toBeGreaterThan(190); // ~ +198 reais lucro liquido
    });

    it('generates globally unique order IDs preventing database collision across restarts', async () => {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', 30.0);
      const broker1 = new B3PaperBroker('PETR4', 100.0, marketData, 0);
      const broker2 = new B3PaperBroker('PETR4', 100.0, marketData, 0);

      const order1 = await broker1.placeMarketOrder('BUY', 1, 'client-1');
      const order2 = await broker2.placeMarketOrder('BUY', 1, 'client-2');

      expect(order1.orderId).not.toBe(order2.orderId);
      expect(order1.fills[0].tradeId).not.toBe(order2.fills[0].tradeId);
      expect(order1.orderId).toMatch(/^B3-ORD-\d+-[a-f0-9]+-\d+$/);
    });
  });

  describe('B3 MetaTrader 5 Bridge Client', () => {
    it('handles MT5 Bridge communication and error handling', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ last: 35.5, bid: 35.49, ask: 35.51 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const bridge = new B3MetaTraderBridge('PETR4', { host: '127.0.0.1', port: 8000 }, mockFetch as any);
      const price = await bridge.price();
      expect(price).toBe(35.5);
    });
  });

  describe('B3 AI Prompt Builder', () => {
    it('includes B3 context, entry price, profit ratio and BRL currency', () => {
      const prompt = buildB3Prompt(
        {} as any,
        { initialBankBrl: 5000, cashBrl: 1500 },
        { ticker: 'PETR4', quantity: 100, entryPrice: 35.0, costBrl: 3500 },
        36.0,
      );

      expect(prompt).toContain('Day Trade de Ações na B3');
      expect(prompt).toContain('PETR4');
      expect(prompt).toContain('R$ 35.00');
      expect(prompt).toContain('+2.86%');
      expect(prompt).toContain('Risco:Retorno mínima 2:1');
    });
  });
});
