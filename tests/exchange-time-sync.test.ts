import { describe, expect, it } from 'vitest';
import { BinanceTestnetClient } from '@bolinha/exchange';

describe('BinanceTestnetClient time sync and recvWindow resilience', () => {
  it('synchronizes time offset and signs requests with adjusted timestamp and configured recvWindow', async () => {
    const urls: string[] = [];
    const client = new BinanceTestnetClient(
      'test-api-key',
      'test-api-secret',
      'BTCUSDT',
      async (input) => {
        const urlStr = String(input);
        urls.push(urlStr);
        if (urlStr.includes('/api/v3/time')) {
          // Simulamos o servidor da Binance adiantado em 5000ms
          return new Response(JSON.stringify({ serverTime: 1_700_000_005_000 }), { status: 200 });
        }
        if (urlStr.includes('/api/v3/order')) {
          return new Response(
            JSON.stringify({
              clientOrderId: 'test-order-1',
              orderId: 101,
              status: 'FILLED',
              side: 'BUY',
              executedQty: '0.00010000',
              cummulativeQuoteQty: '10.00000000',
              transactTime: 1_700_000_005_000,
              fills: [],
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      },
      60_000,
    );

    const order = await client.placeMarketOrder('BUY', 0.0001, 'test-order-1');
    expect(order.orderId).toBe('101');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/api/v3/time');
    expect(urls[1]).toContain('/api/v3/order');
    expect(urls[1]).toContain('recvWindow=60000');
    expect(urls[1]).toContain('timestamp=');
    expect(client.getTimeOffset()).not.toBeNull();
  });

  it('retries signed request once after recvWindow -1021 error with freshly resynced timeOffset', async () => {
    let callCount = 0;
    const urls: string[] = [];
    const client = new BinanceTestnetClient(
      'test-api-key',
      'test-api-secret',
      'BTCUSDT',
      async (input) => {
        callCount++;
        const urlStr = String(input);
        urls.push(urlStr);

        // Chamada 1: syncTimeOffset inicial
        if (urlStr.includes('/api/v3/time') && callCount === 1) {
          return new Response(JSON.stringify({ serverTime: 1_700_000_000_000 }), { status: 200 });
        }

        // Chamada 2: tentativa da ordem com timestamp desatualizado que falha com -1021
        if (urlStr.includes('/api/v3/order') && callCount === 2) {
          return new Response(
            JSON.stringify({
              code: -1021,
              msg: 'Timestamp for this request is outside of the recvWindow.',
            }),
            { status: 400 },
          );
        }

        // Chamada 3: nova sincronização forçada de tempo
        if (urlStr.includes('/api/v3/time') && callCount === 3) {
          return new Response(JSON.stringify({ serverTime: 1_700_000_015_000 }), { status: 200 });
        }

        // Chamada 4: retry da ordem com sucesso
        if (urlStr.includes('/api/v3/order') && callCount === 4) {
          return new Response(
            JSON.stringify({
              clientOrderId: 'test-retry-1',
              orderId: 202,
              status: 'FILLED',
              side: 'SELL',
              executedQty: '0.00010000',
              cummulativeQuoteQty: '10.00000000',
              transactTime: 1_700_000_015_000,
              fills: [],
            }),
            { status: 200 },
          );
        }

        return new Response('{}', { status: 200 });
      },
      60_000,
    );

    const order = await client.placeMarketOrder('SELL', 0.0001, 'test-retry-1');
    expect(order.orderId).toBe('202');
    expect(callCount).toBe(4);
    expect(urls[1]).toContain('/api/v3/order');
    expect(urls[2]).toContain('/api/v3/time');
    expect(urls[3]).toContain('/api/v3/order');
  });
});
