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
import { calculateIndicators, type Candle } from '@bolinha/market-data';
import { config } from '@bolinha/core';

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

  describe('B3 AI Prompt Builder & Dynamic Targets', () => {
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
      expect(prompt).toContain('PROTEÇÃO DE BREAKEVEN ATIVA');
      expect(prompt).toContain('Stop Loss Efetivo: R$ 35.02');
      expect(prompt).toContain('Take Profit Parcial (+1,0%): R$ 35.35');
      expect(prompt).toContain('Take Profit Total (+2,0%): R$ 35.70');
      expect(prompt).toContain('proibido ficar em HOLD passivo');
    });

    it('allows custom stop loss calibration in buildB3Prompt', () => {
      const prompt = buildB3Prompt(
        {} as any,
        { initialBankBrl: 100, cashBrl: 50 },
        { ticker: 'PETR4', quantity: 2, entryPrice: 30.0, costBrl: 60 },
        29.8,
        0.015, // 1.5%
      );
      expect(prompt).toContain('Stop Loss Inicial (-1,5%): R$ 29.55');
      expect(prompt).toContain('Stop Loss Efetivo: R$ 29.55');
      expect(prompt).toContain('Alvo +1,0% a +2,5% com stop ~-1,0% a -1,5%');
    });

    const rules = getB3SymbolRules('PETR4F'); // fractional lot: 1 share

    it('forces SELL protection in applyB3Risk if position exceeds maxStopLossPct even if AI returns HOLD', () => {
      const bank = { initialBankBrl: 100, cashBrl: 30, realizedPnlBrl: 0 };
      const position = { ticker: 'PETR4', quantity: 2, entryPrice: 35.0, costBrl: 70.0 };
      const currentPrice = 34.0; // Perda de (35 - 34)/35 = 2.85% (> 1.5% maxStopLossPct)

      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: currentPrice,
        account: bank,
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        maxStopLossPct: 0.015,
      });

      expect(result.action).toBe('SELL');
      expect(result.quantity).toBe(2);
      expect(result.amountBrl).toBe(68.0);
      expect(result.rejectionReason).toContain('Automatic stop loss triggered');
    });

    it('blocks BUY in applyB3Risk if position exceeds maxStopLossPct', () => {
      const bank = { initialBankBrl: 100, cashBrl: 30, realizedPnlBrl: 0 };
      const position = { ticker: 'PETR4', quantity: 2, entryPrice: 35.0, costBrl: 70.0 };
      const currentPrice = 34.0;

      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 30,
        price: currentPrice,
        account: bank,
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        maxStopLossPct: 0.015,
      });

      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toContain('BUY rejected: position hit maximum intradiary stop loss');
    });

    it('triggers Breakeven protection in applyB3Risk when position reached >= breakevenTriggerPct and reverts to cost', () => {
      const bank = { initialBankBrl: 100, cashBrl: 30, realizedPnlBrl: 0 };
      // Comprou a R$ 30.00, subiu até R$ 30.50 (+1.66% > 0.8% gatilho de breakeven)
      const position = {
        ticker: 'PETR4',
        quantity: 2,
        entryPrice: 30.0,
        costBrl: 60.0,
        highestPrice: 30.50,
      };

      // Agora o preço recua para R$ 30.00 (preço de entrada com taxas)
      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.00,
        account: bank,
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        breakevenTriggerPct: 0.008,
      });

      // Deve forçar SELL para não devolver ganhos e virar prejuízo
      expect(result.action).toBe('SELL');
      expect(result.quantity).toBe(2);
      expect(result.amountBrl).toBe(60.00);
      expect(result.rejectionReason).toContain('Automatic breakeven/trailing stop triggered');
    });

    it('protects gains with Trailing Stop from highest price reached', () => {
      const bank = { initialBankBrl: 100, cashBrl: 30, realizedPnlBrl: 0 };
      // Comprou a R$ 30.00, subiu até R$ 31.00 (+3.33%). Trailing stop de 0.6% -> piso em 31.00 * (1 - 0.006) = 30.81
      const position = {
        ticker: 'PETR4',
        quantity: 2,
        entryPrice: 30.0,
        costBrl: 60.0,
        highestPrice: 31.00,
      };

      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.80, // Caiu abaixo de 30.81
        account: bank,
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        breakevenTriggerPct: 0.008,
        trailingStopPct: 0.006,
      });

      expect(result.action).toBe('SELL');
      expect(result.quantity).toBe(2);
      expect(result.amountBrl).toBe(61.60);
      expect(result.rejectionReason).toContain('Automatic breakeven/trailing stop triggered');
    });

    it('contextualizes Breakeven and Trailing Stop status in buildB3Prompt when active', () => {
      const prompt = buildB3Prompt(
        {} as any,
        { initialBankBrl: 100, cashBrl: 40 },
        { ticker: 'PETR4', quantity: 2, entryPrice: 30.0, costBrl: 60, highestPrice: 30.30 }, // +1.0% de alta já alcançada
        30.15,
      );

      expect(prompt).toContain('PROTEÇÃO DE BREAKEVEN ATIVA');
      expect(prompt).toContain('máxima atingida R$ 30.30');
      expect(prompt).toContain('preço de custo R$ 30.02');
      expect(prompt).toContain('É expressamente proibido deixar a posição devolver ganhos');
    });
  });

  describe('BUG-04: Price Sync and Slippage Guard', () => {
    it('synchronizes currentPrice with the close of the last candle and executes orders at that price', async () => {
      const marketData = new B3MarketDataService();
      const broker = new B3PaperBroker('PETR4', 1000.0, marketData, 0.0005);

      const candles = await broker.candles('1m', 50);
      expect(candles.length).toBe(50);
      const lastCandleClose = candles[candles.length - 1].close;

      const currentPrice = await broker.price();
      expect(currentPrice).toBe(lastCandleClose);

      // Ordem a mercado de compra executa no fechamento do candle + slippage (0.05%)
      const expectedBuyPrice = Number((lastCandleClose * 1.0005).toFixed(2));
      const buyOrder = await broker.placeMarketOrder('BUY', 1, 'sync-buy-1');
      expect(buyOrder.fills[0].price).toBe(expectedBuyPrice);
    });

    it('shares market data instance across broker gateways created via createBrokerGateway', async () => {
      const broker1 = new B3PaperBroker('VALE3', 1000.0);
      const broker2 = new B3PaperBroker('VALE3', 1000.0);

      // Ambos devem compartilhar a mesma referência do serviço de dados de mercado
      expect(broker1.getMarketData()).toBe(broker2.getMarketData());

      broker1.getMarketData().setMockPrice('VALE3', 65.50);
      expect(await broker2.price()).toBe(65.50);
    });

    it('rejects SELL order when execution price falls below minPrice (slippage guard)', async () => {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', 30.00);
      const broker = new B3PaperBroker('PETR4', 1000.0, marketData, 0.001); // 0.1% slippage

      await broker.placeMarketOrder('BUY', 10, 'buy-for-slippage');

      // Preço de venda a mercado esperado com 0.1% de slippage: 30.00 * 0.999 = 29.97
      // Se minPrice for 29.98, deve rejeitar
      await expect(
        broker.placeMarketOrder('SELL', 10, 'sell-rejected', 29.98),
      ).rejects.toThrow(/Execution price R\$ 29\.97 is below minimum allowed price R\$ 29\.98 \(slippage guard\)/);

      // Se minPrice for 29.97 ou menor, deve aprovar
      const approvedOrder = await broker.placeMarketOrder('SELL', 10, 'sell-approved', 29.97);
      expect(approvedOrder.status).toBe('FILLED');
      expect(approvedOrder.fills[0].price).toBe(29.97);
    });
  });

  describe('BUG-05: Synthetic Candle Generator Normalization & RSI Oscillation', () => {
    it('generates realistic candles with temporal continuity and price sanity', async () => {
      const marketData = new B3MarketDataService();
      const candles = await marketData.candles('PETR4', '1m', 50);

      expect(candles.length).toBe(50);
      for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        // Coerência temporal do candle
        expect(curr.openTime).toBeGreaterThan(prev.openTime);
        expect(curr.closeTime).toBeGreaterThan(curr.openTime);
        // Preço de abertura deve ser coerente com fechamento anterior
        expect(curr.open).toBe(prev.close);
        // High deve ser >= max(open, close) e Low <= min(open, close)
        expect(curr.high).toBeGreaterThanOrEqual(Math.max(curr.open, curr.close));
        expect(curr.low).toBeLessThanOrEqual(Math.min(curr.open, curr.close));
        // Volume positivo
        expect(curr.volume).toBeGreaterThan(0);
      }
    });

    it('produces dynamic RSI oscillation across 1m, 5m and 15m intervals without sticking to 100', async () => {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', 30.0);

      const [c1m, c5m, c15m] = await Promise.all([
        marketData.candles('PETR4', '1m', 60),
        marketData.candles('PETR4', '5m', 60),
        marketData.candles('PETR4', '15m', 60),
      ]);

      const ind1m = calculateIndicators(c1m);
      const ind5m = calculateIndicators(c5m);
      const ind15m = calculateIndicators(c15m);

      // Nenhum dos intervalos deve ficar fixado em 100.00
      expect(ind1m.rsi14).toBeLessThan(99.0);
      expect(ind1m.rsi14).toBeGreaterThan(1.0);

      expect(ind5m.rsi14).toBeLessThan(99.0);
      expect(ind5m.rsi14).toBeGreaterThan(1.0);

      expect(ind15m.rsi14).toBeLessThan(99.0);
      expect(ind15m.rsi14).toBeGreaterThan(1.0);

      // Comprova que há candles de alta e candles de baixa (distribuição estocástica)
      const diffs1m = c1m.slice(1).map((c, i) => c.close - c1m[i].close);
      const positiveCandles = diffs1m.filter((d) => d > 0).length;
      const negativeCandles = diffs1m.filter((d) => d < 0).length;

      expect(positiveCandles).toBeGreaterThan(10);
      expect(negativeCandles).toBeGreaterThan(10);
    });
  });

  describe('BUG-07: Sincronização e Amostragem Temporal Coerente entre Candles (1m, 5m e 15m)', () => {
    it('returns the exact same close price across 1m, 5m and 15m for the latest candle', async () => {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('VALE3', 60.0);

      const [c1m, c5m, c15m] = await Promise.all([
        marketData.candles('VALE3', '1m', 30),
        marketData.candles('VALE3', '5m', 30),
        marketData.candles('VALE3', '15m', 30),
      ]);

      const last1m = c1m[c1m.length - 1];
      const last5m = c5m[c5m.length - 1];
      const last15m = c15m[c15m.length - 1];

      // O preço de fechamento mais recente deve ser idêntico em todos os tempos gráficos
      expect(last1m.close).toBe(last5m.close);
      expect(last1m.close).toBe(last15m.close);
      expect(await marketData.price('VALE3')).toBe(last1m.close);
    });

    it('faithfully aggregates 5 consecutive 1m candles into 5m candles and 15 into 15m candles', async () => {
      const marketData = new B3MarketDataService();
      // Criamos 15 candles manuais de 1m para checagem exata da agregação OHLCV
      const baseTime = 1700000000000;
      const mock1m = [
        { openTime: baseTime, open: 10.0, high: 10.5, low: 9.8, close: 10.2, volume: 100, closeTime: baseTime + 59999 },
        { openTime: baseTime + 60000, open: 10.2, high: 11.0, low: 10.1, close: 10.8, volume: 150, closeTime: baseTime + 119999 },
        { openTime: baseTime + 120000, open: 10.8, high: 10.9, low: 10.3, close: 10.5, volume: 200, closeTime: baseTime + 179999 },
        { openTime: baseTime + 180000, open: 10.5, high: 10.7, low: 10.4, close: 10.6, volume: 120, closeTime: baseTime + 239999 },
        { openTime: baseTime + 240000, open: 10.6, high: 11.2, low: 10.5, close: 11.1, volume: 180, closeTime: baseTime + 299999 },
      ];

      marketData.setMockCandles('TEST3', '1m', mock1m);

      const c5m = await marketData.candles('TEST3', '5m', 10);
      expect(c5m.length).toBe(1);
      const agg5m = c5m[0];

      // O candle agregado de 5m deve ter:
      // open do primeiro candle (10.0)
      expect(agg5m.open).toBe(10.0);
      // close do último candle (11.1)
      expect(agg5m.close).toBe(11.1);
      // high máximo entre eles (11.2)
      expect(agg5m.high).toBe(11.2);
      // low mínimo entre eles (9.8)
      expect(agg5m.low).toBe(9.8);
      // soma dos volumes (100 + 150 + 200 + 120 + 180 = 750)
      expect(agg5m.volume).toBe(750);
    });
  });

  describe('BUG-08: Progressão Temporal Dinâmica e Janela Deslizante de Candles Sintéticos', () => {
    it('appends new 1m candles sequentially when time elapses and retains continuity', async () => {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', 30.0);

      // Chamada inicial: gera série de 1m terminando no tempo T0
      const initial1m = await marketData.candles('PETR4', '1m', 10);
      expect(initial1m.length).toBe(10);
      const firstLast = initial1m[initial1m.length - 1];

      // Simula passagem de tempo de 3 minutos (180_000 ms) avançando Date.now
      const futureNow = firstLast.closeTime + 180_000 + 1000;
      const originalNow = Date.now;
      try {
        Date.now = () => futureNow;

        const updated1m = await marketData.candles('PETR4', '1m', 10);
        expect(updated1m.length).toBe(10);
        const secondLast = updated1m[updated1m.length - 1];

        // O último candle agora deve ter closeTime mais recente correspondente ao futureNow
        expect(secondLast.closeTime).toBeGreaterThan(firstLast.closeTime);

        // Preço deve ter se atualizado dinamicamente
        const currentPrice = await marketData.price('PETR4');
        expect(currentPrice).toBe(secondLast.close);

        // Candles de 5m e 15m também refletem o novo fechamento
        const c5m = await marketData.candles('PETR4', '5m', 10);
        expect(c5m[c5m.length - 1].close).toBe(secondLast.close);
      } finally {
        Date.now = originalNow;
      }
    });

    it('limits sliding window size to prevent memory leaks', async () => {
      const marketData = new B3MarketDataService();
      await marketData.candles('VALE3', '1m', 100);

      const originalNow = Date.now;
      try {
        // Simular um salto grande no tempo (ex: 5000 minutos transcorridos)
        const hugeFuture = originalNow() + 5000 * 60_000;
        Date.now = () => hugeFuture;

        const candles = await marketData.candles('VALE3', '1m', 100);
        expect(candles.length).toBe(100);

        // Internamente não deve crescer indefinidamente
        const allStored = (marketData as any).candlesStore.get('VALE3')?.['1m'];
        expect(allStored).toBeDefined();
        expect(allStored.length).toBeLessThanOrEqual(4000);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('Melhoria #4: Modelo Sintético de Ondas de Momentum Intradiárias', () => {
    /** Longest stretch of consecutive same-direction closes (flat candles break the run). */
    const longestDirectionalRun = (candles: Candle[]): number => {
      let best = 0;
      let current = 0;
      let direction = 0;
      for (let index = 1; index < candles.length; index++) {
        const delta = Math.sign(Number((candles[index].close - candles[index - 1].close).toFixed(2)));
        if (delta === 0) {
          current = 0;
          direction = 0;
          continue;
        }
        if (delta === direction) current += 1;
        else {
          direction = delta;
          current = 1;
        }
        if (current > best) best = current;
      }
      return best;
    };

    /** Collects the whole simulated session minute by minute, pinning the clock for determinism. */
    const walkSession = async (
      marketData: B3MarketDataService,
      minutes: number,
      startTime = 1_700_000_000_000,
    ): Promise<Candle[]> => {
      const originalNow = Date.now;
      try {
        let clock = startTime;
        Date.now = () => clock;
        const initial = await marketData.candles('PETR4', '1m', 100);
        const collected: Candle[] = [...initial];
        for (let minute = 0; minute < minutes; minute++) {
          clock += 60_000;
          const at = clock;
          Date.now = () => at;
          const next = await marketData.candles('PETR4', '1m', 100);
          collected.push(next[next.length - 1]);
        }
        return collected;
      } finally {
        Date.now = originalNow;
      }
    };

    it('extends trends for several consecutive candles instead of a flat mean-reverting walk', async () => {
      const momentumRuns: number[] = [];
      const noiseRuns: number[] = [];
      for (const seed of [1, 2, 3, 5, 7, 11, 42, 99]) {
        const trending = new B3MarketDataService({ seed });
        trending.setMockPrice('PETR4', 30);
        momentumRuns.push(longestDirectionalRun(await walkSession(trending, 120)));

        // Same model with the drift switched off is the old pure-noise baseline.
        const noise = new B3MarketDataService({ seed, momentumDrift: 0, trendSegmentCandles: 1 });
        noise.setMockPrice('PETR4', 30);
        noiseRuns.push(longestDirectionalRun(await walkSession(noise, 120)));
      }

      // Momentum persistence: every seed shows a genuine multi-candle wave.
      expect(Math.min(...momentumRuns)).toBeGreaterThanOrEqual(6);
      // ...and the trends extend meaningfully longer than the drift-free baseline.
      const averaged = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
      expect(averaged(momentumRuns)).toBeGreaterThan(averaged(noiseRuns) + 1);
    });

    it('lets price progress away from the anchor while staying inside plausible bounds', async () => {
      const anchor = 30;
      const boundPct = config.SYNTHETIC_PRICE_BOUND_PCT;
      for (const seed of [1, 3, 7, 42]) {
        const marketData = new B3MarketDataService({ seed });
        marketData.setMockPrice('PETR4', anchor);
        const session = await walkSession(marketData, 120, 1_700_100_000_000);

        const deviationPct = Math.max(...session.map((candle) => Math.abs(candle.close - anchor))) / anchor;
        // Meaningful progress away from the base price (no more R$29.50-29.80 oscillation).
        expect(deviationPct).toBeGreaterThan(0.005);
        // Bounded: never runs away past the configured plausibility band.
        expect(deviationPct).toBeLessThanOrEqual(boundPct + 0.0001);
        for (const candle of session) {
          expect(candle.close).toBeGreaterThan(0);
          expect(candle.low).toBeGreaterThan(0);
          expect(candle.open).toBeGreaterThanOrEqual(Number((anchor * (1 - boundPct)).toFixed(2)) - 0.01);
          expect(candle.close).toBeLessThanOrEqual(Number((anchor * (1 + boundPct)).toFixed(2)));
        }
      }
    });

    it('keeps OHLC invariants, positive volume and monotonic timestamps across timeframes', async () => {
      const marketData = new B3MarketDataService({ seed: 2024 });
      marketData.setMockPrice('PETR4', 30);
      const series = {
        '1m': await marketData.candles('PETR4', '1m', 100),
        '5m': await marketData.candles('PETR4', '5m', 100),
        '15m': await marketData.candles('PETR4', '15m', 100),
      };

      for (const candles of Object.values(series)) {
        for (let index = 1; index < candles.length; index++) {
          const previous = candles[index - 1];
          const current = candles[index];
          expect(current.openTime).toBeGreaterThan(previous.openTime);
          expect(current.closeTime).toBeGreaterThan(current.openTime);
          expect(current.high).toBeGreaterThanOrEqual(Math.max(current.open, current.close));
          expect(current.low).toBeLessThanOrEqual(Math.min(current.open, current.close));
          expect(current.low).toBeGreaterThan(0);
          expect(current.volume).toBeGreaterThan(0);
        }
      }

      // The newest close stays shared by every timeframe (BUG-07 contract).
      const last = (candles: Candle[]) => candles[candles.length - 1].close;
      expect(last(series['5m'])).toBe(last(series['1m']));
      expect(last(series['15m'])).toBe(last(series['1m']));
    });

    it('is deterministic under a fixed seed and diverges with a different seed', async () => {
      const originalNow = Date.now;
      const pinned = 1_700_200_000_000;
      try {
        Date.now = () => pinned;
        const first = new B3MarketDataService({ seed: 424242 });
        const repeated = new B3MarketDataService({ seed: 424242 });
        const different = new B3MarketDataService({ seed: 424243 });
        for (const service of [first, repeated, different]) service.setMockPrice('PETR4', 30);

        const firstSeries = await first.candles('PETR4', '1m', 80);
        const repeatedSeries = await repeated.candles('PETR4', '1m', 80);
        const differentSeries = await different.candles('PETR4', '1m', 80);

        expect(repeatedSeries).toEqual(firstSeries);
        expect(differentSeries.some((candle, index) => candle.close !== firstSeries[index].close)).toBe(true);
      } finally {
        Date.now = originalNow;
      }
    });

    it('gives each ticker its own path from the same seed', async () => {
      const originalNow = Date.now;
      try {
        Date.now = () => 1_700_300_000_000;
        const marketData = new B3MarketDataService({ seed: 7 });
        marketData.setMockPrice('PETR4', 30);
        marketData.setMockPrice('VALE3', 30);
        const petro = await marketData.candles('PETR4', '1m', 60);
        const vale = await marketData.candles('VALE3', '1m', 60);
        expect(vale.some((candle, index) => candle.close !== petro[index].close)).toBe(true);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('BUG-10 chunk B: Agregação Estável e Completa de Candles 5m e 15m', () => {
    const FIVE_MIN_MS = 5 * 60_000;
    const FIFTEEN_MIN_MS = 15 * 60_000;

    /**
     * Fixture 1m contígua alinhada à grade de 5m (início múltiplo de 300_000 ms), com
     * volumes e fechamentos DISTINTOS: um bucket parcial é inconfundível, e o fechamento
     * agregado revela exatamente qual candle de 1m fechou o bucket.
     */
    const buildAligned1m = (count: number, start = 1_700_000_400_000): Candle[] =>
      Array.from({ length: count }, (_, index) => {
        const openTime = start + index * 60_000;
        const open = Number((10 + index * 0.1).toFixed(2));
        const close = Number((open + 0.05).toFixed(2));
        return {
          openTime,
          open,
          high: Number((close + 0.2).toFixed(2)),
          low: Number((open - 0.2).toFixed(2)),
          close,
          volume: index + 1,
          closeTime: openTime + 59_999,
        };
      });

    it('never emits a short trailing 5m bucket when 13 one-minute candles are fed', async () => {
      const marketData = new B3MarketDataService();
      const candles1m = buildAligned1m(13); // volumes 1..13, fechamentos todos distintos
      marketData.setMockCandles('AGG13', '1m', candles1m);

      const c5m = await marketData.candles('AGG13', '5m', 50);

      // floor(13 / 5) === 2: os 3 candles que sobram no fim NÃO viram um candle "curto".
      expect(c5m).toHaveLength(Math.floor(13 / 5));

      // Nenhum volume artificialmente baixo: o menor volume possível de um bucket completo
      // desta fixture é 1+2+3+4+5 = 15. Um bucket parcial de 3 candles daria no máximo 12.
      for (const bucket of c5m) expect(bucket.volume).toBeGreaterThanOrEqual(15);

      // O histórico fica ancorado no relógio ([0..4]) e o bucket do topo é a janela rolante
      // dos 5 últimos candles de 1m ([8..12]), que é o que mantém o fechamento mais novo igual.
      const volumeOf = (from: number, factor = 5) =>
        candles1m.slice(from, from + factor).reduce((total, candle) => total + candle.volume, 0);
      expect(c5m.map((bucket) => bucket.volume)).toEqual([volumeOf(0), volumeOf(8)]);
      expect(c5m[0].volume).toBe(15); // 1+2+3+4+5
      expect(c5m[1].volume).toBe(55); // 9+10+11+12+13

      // Cada `close` agregado é o `close` do ÚLTIMO candle de 1m do bucket (nunca uma média,
      // nunca o fechamento do candle em formação fora do bucket).
      expect(c5m[0].close).toBe(candles1m[4].close);
      expect(c5m[1].close).toBe(candles1m[12].close);

      // E o fechamento mais novo continua idêntico ao candle de 1m mais novo (contrato BUG-07).
      expect(c5m[c5m.length - 1].close).toBe(candles1m[candles1m.length - 1].close);
    });

    it('aggregates open/high/low/close/volume of an explicit 5-candle window exactly', async () => {
      const marketData = new B3MarketDataService();
      const baseTime = 1_700_000_400_000; // múltiplo de 300_000 => bucket alinhado
      // Volumes uniformes (100): o agregado tem de ser exatamente 500 = 5 × 100, o que só é
      // verdade se o bucket tiver EXATAMENTE 5 candles (nunca 3 ou 4).
      const mock1m: Candle[] = [
        [10.0, 10.5, 10.05, 10.2],
        [10.2, 11.0, 10.1, 10.8],
        [10.8, 10.9, 10.3, 10.5],
        [10.5, 10.7, 9.95, 10.6],
        [10.6, 11.2, 10.4, 11.1],
      ].map(([open, high, low, close], index) => {
        const openTime = baseTime + index * 60_000;
        return { openTime, open, high, low, close, volume: 100, closeTime: openTime + 59_999 };
      });
      marketData.setMockCandles('AGGOHLC', '1m', mock1m);

      const c5m = await marketData.candles('AGGOHLC', '5m', 10);

      expect(c5m).toHaveLength(1);
      expect(c5m[0]).toEqual({
        openTime: baseTime, // abertura do primeiro candle do bucket
        open: 10.0, // open do primeiro candle de 1m
        high: 11.2, // máximo dos highs
        low: 9.95, // mínimo dos lows
        close: 11.1, // close do último candle de 1m
        volume: 500, // soma exata dos 5 volumes
        closeTime: baseTime + 299_999, // openTime + intervalMs - 1
      });
    });

    it('keeps bucket open times and OHLCV stable while the 1m window slides', async () => {
      const marketData = new B3MarketDataService({ seed: 31415 });
      marketData.setMockPrice('PETR4', 30);
      const originalNow = Date.now;
      // Relógio desalinhado da grade de 5m de propósito (resto 200_000), como no runtime real.
      let clock = 1_700_000_000_000;
      try {
        Date.now = () => clock;
        const snapshots: Candle[][] = [];
        for (let cycle = 0; cycle < 4; cycle++) {
          const buckets = await marketData.candles('PETR4', '5m', 100);
          const newest1m = await marketData.candles('PETR4', '1m', 100);
          snapshots.push(buckets);
          // Contrato BUG-07 mantido em todos os ciclos, inclusive nos desalinhados.
          expect(buckets[buckets.length - 1].close).toBe(newest1m[newest1m.length - 1].close);
          // A sessão avança 2 minutos: a série de 1m cresce e a janela desliza.
          clock += 120_000;
          Date.now = () => clock;
        }

        // Um bucket do MEIO do histórico inicial é a testemunha do "sem deslocamento": ele tem de
        // sobreviver a todos os ciclos seguintes com exatamente o mesmo OHLCV.
        const witness = snapshots[0][Math.floor(snapshots[0].length / 2)];
        for (let cycle = 1; cycle < snapshots.length; cycle++) {
          const previous = new Map(snapshots[cycle - 1].map((candle) => [candle.openTime, candle]));
          const shared = snapshots[cycle].filter((candle) => previous.has(candle.openTime));
          const next = new Map(snapshots[cycle].map((candle) => [candle.openTime, candle]));

          // Só o candle do topo (janela rolante) e a borda truncada da janela de 1m podem diferir:
          // todo o resto das fronteiras é reaproveitado byte a byte.
          expect(shared.length).toBeGreaterThanOrEqual(snapshots[cycle].length - 2);
          for (const bucket of shared) expect(bucket).toEqual(previous.get(bucket.openTime));

          const witnessInCycle = next.get(witness.openTime);
          expect(witnessInCycle).toEqual(witness);
        }

        // Histórico fechado fica na grade do relógio: apenas o candle rolante do topo acompanha o
        // candle de 1m em formação (fora da grade, quando a fita não está alinhada).
        for (const buckets of snapshots) {
          for (let index = 0; index < buckets.length; index++) {
            expect(buckets[index].closeTime).toBe(buckets[index].openTime + 300_000 - 1);
            if (index < buckets.length - 1) expect(buckets[index].openTime % 300_000).toBe(0);
          }
        }
      } finally {
        Date.now = originalNow;
      }
    });

    it('aligns every closed bucket to the interval grid and closes one interval later', async () => {
      const cases = [
        { interval: '5m' as const, factor: 5, count: 20, start: 1_700_000_400_000, intervalMs: FIVE_MIN_MS },
        {
          interval: '15m' as const,
          factor: 15,
          count: 30,
          start: 1_700_000_100_000,
          intervalMs: FIFTEEN_MIN_MS,
        },
      ];

      for (const { interval, factor, count, start, intervalMs } of cases) {
        const candles1m = buildAligned1m(count, start);
        const marketData = new B3MarketDataService();
        marketData.setMockCandles('GRID3', '1m', candles1m);

        const aggregated = await marketData.candles('GRID3', interval, 50);

        // A série termina num bucket completo: nada é descartado nem rolado.
        expect(aggregated).toHaveLength(count / factor);

        for (const bucket of aggregated) {
          // Alinhamento à grade do intervalo (5m/15m) e fechamento de exatamente uma janela.
          expect(bucket.openTime % intervalMs).toBe(0);
          expect(bucket.closeTime).toBe(bucket.openTime + intervalMs - 1);

          const window = candles1m.filter((candle) => candle.openTime >= bucket.openTime).slice(0, factor);
          expect(window).toHaveLength(factor);
          expect(bucket.open).toBe(window[0].open);
          expect(bucket.close).toBe(window[window.length - 1].close);
          expect(bucket.high).toBe(Math.max(...window.map((candle) => candle.high)));
          expect(bucket.low).toBe(Math.min(...window.map((candle) => candle.low)));
          expect(bucket.volume).toBe(window.reduce((total, candle) => total + candle.volume, 0));
        }

        for (let index = 1; index < aggregated.length; index++) {
          expect(aggregated[index].openTime).toBeGreaterThan(aggregated[index - 1].openTime);
        }
      }
    });
  });
});
