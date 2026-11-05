import { describe, expect, it } from 'vitest';
import { parseTradingSymbols } from '@bolinha/core';
import { defaultB3MarketDataService } from '@bolinha/exchange';

describe('B3 Multi-Asset Scanner', () => {
  it('parses comma-separated symbols with normalization and fallback', () => {
    expect(parseTradingSymbols('PETR4, vale3, , itub4 ')).toEqual(['PETR4', 'VALE3', 'ITUB4']);
    expect(parseTradingSymbols('', 'PETR4')).toEqual(['PETR4']);
    expect(parseTradingSymbols('   ', 'VALE3')).toEqual(['VALE3']);
    expect(parseTradingSymbols()).toEqual(['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'BBAS3']);
  });

  it('scans and ranks multiple B3 symbols returning setups with confluence', async () => {
    const symbols = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'BBAS3'];
    const setups = await defaultB3MarketDataService.scanAndRankSetups(symbols);

    expect(setups.length).toBeGreaterThan(0);
    expect(setups.length).toBeLessThanOrEqual(symbols.length);

    // Should be sorted by score descending
    for (let i = 1; i < setups.length; i++) {
      expect(setups[i - 1].score).toBeGreaterThanOrEqual(setups[i].score);
    }

    // Top setup should have required confluence, price, and snapshot
    const top = setups[0];
    expect(top.ticker).toBeDefined();
    expect(symbols).toContain(top.ticker);
    expect(top.price).toBeGreaterThan(0);
    expect(top.confluence).toBeDefined();
    expect(typeof top.score).toBe('number');
  });

  it('B3PaperBroker attaches executed ticker to order and preserves dynamic symbol', async () => {
    const { B3PaperBroker } = await import('@bolinha/exchange');
    const broker = new B3PaperBroker('VALE3', 1000, defaultB3MarketDataService, 0);
    defaultB3MarketDataService.setMockPrice('VALE3', 50.0);

    const order = await broker.placeMarketOrder('BUY', 10, 'client-order-vale3');
    expect(order.ticker).toBe('VALE3');
    expect(order.side).toBe('BUY');
    expect(order.executedQty).toBe(10);

    broker.setTicker('BBDC4');
    defaultB3MarketDataService.setMockPrice('BBDC4', 20.0);
    const order2 = await broker.placeMarketOrder('BUY', 5, 'client-order-bbdc4');
    expect(order2.ticker).toBe('BBDC4');
  });
});

