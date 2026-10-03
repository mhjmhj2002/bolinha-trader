import { describe, expect, it } from 'vitest';
import { BinanceTestnetClient } from '@bolinha/exchange';

const filledOrder = {
  clientOrderId: 'client-id', orderId: 123, status: 'FILLED', side: 'BUY',
  executedQty: '0.00007000', cummulativeQuoteQty: '7.00000000', transactTime: 1_700_000_000_000,
};

describe('Binance fill preservation', () => {
  it('keeps each FULL order-response fill, including its commission asset and trade id', async () => {
    const client = new BinanceTestnetClient('key', 'secret', 'BTCUSDT', async () => new Response(JSON.stringify({
      ...filledOrder,
      fills: [
        { price: '100000', qty: '0.00004000', commission: '0.00000004', commissionAsset: 'BTC', tradeId: 91 },
        { price: '100000', qty: '0.00003000', commission: '0.00000003', commissionAsset: 'BTC', tradeId: 92 },
      ],
    }), { status: 200 }));
    const order = await client.placeMarketOrder('BUY', 0.00007, 'client-id');
    expect(order.fills).toEqual([
      { price: 100000, qty: 0.00004, commission: 0.00000004, commissionAsset: 'BTC', tradeId: '91' },
      { price: 100000, qty: 0.00003, commission: 0.00000003, commissionAsset: 'BTC', tradeId: '92' },
    ]);
  });

  it('loads myTrades fills during reconciliation because GET order omits them', async () => {
    const urls: string[] = [];
    const client = new BinanceTestnetClient('key', 'secret', 'BTCUSDT', async (url) => {
      urls.push(String(url));
      // This mirrors GET /api/v3/order: it provides updateTime/time, not the
      // transactTime supplied by a POST order response.
      const body = urls.length === 1 ? { ...filledOrder, transactTime: undefined, updateTime: 1_700_000_000_123, time: 1_700_000_000_000 } : [
        { price: '100000', qty: '0.00007000', commission: '0.001', commissionAsset: 'BNB', id: 44 },
      ];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const order = await client.orderByClientId('client-id');
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('/api/v3/myTrades');
    expect(order?.fills).toEqual([{ price: 100000, qty: 0.00007, commission: 0.001, commissionAsset: 'BNB', tradeId: '44' }]);
    expect(order?.transactTime.toISOString()).toBe('2023-11-14T22:13:20.123Z');
    expect(Number.isNaN(order?.transactTime.getTime() ?? NaN)).toBe(false);
  });

  it('rejects a Query Order response without any valid timestamp instead of creating Invalid Date', async () => {
    let call = 0;
    const client = new BinanceTestnetClient('key', 'secret', 'BTCUSDT', async () =>
      new Response(JSON.stringify(++call === 1 ? { ...filledOrder, transactTime: undefined, updateTime: 'not-a-timestamp', time: null } : []), { status: 200 }));
    await expect(client.orderByClientId('client-id')).rejects.toThrow('valid execution timestamp');
  });
});
