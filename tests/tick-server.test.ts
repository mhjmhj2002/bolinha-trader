import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { B3RealtimeTickServer } from '../packages/exchange/src/b3/tick-server.js';
import { TickEventQueue } from '../packages/exchange/src/b3/tick-queue.js';
import type { MarketTickEvent } from '@bolinha/core';

describe('B3RealtimeTickServer', () => {
  let queue: TickEventQueue;
  let server: B3RealtimeTickServer;
  const port = 8999;
  const host = '127.0.0.1';
  const path = '/ticks';

  beforeEach(async () => {
    queue = new TickEventQueue();
    server = new B3RealtimeTickServer(queue, { host, port, path });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    queue.close();
  });

  it('inicia e escuta requisições', () => {
    expect(server.isListening()).toBe(true);
  });

  it('responde UP no endpoint de health', async () => {
    const res = await fetch(`http://${host}:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; queueSize: number };
    expect(body.status).toBe('UP');
    expect(body.queueSize).toBe(0);
  });

  it('recebe tick via POST e enfileira na TickEventQueue', async () => {
    const tickHandler = vi.fn();
    queue.on('tick', tickHandler);

    const payload = {
      symbol: 'PETR4',
      price: 32.50,
      volume: 500,
    };

    const res = await fetch(`http://${host}:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; enqueued: boolean; symbol: string };
    expect(body.status).toBe('OK');
    expect(body.enqueued).toBe(true);
    expect(body.symbol).toBe('PETR4');

    expect(queue.size()).toBe(1);
    expect(tickHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'PETR4',
        price: 32.50,
        volume: 500,
      }),
    );
  });

  it('rejeita payload inválido sem símbolo ou com preço negativo', async () => {
    const res = await fetch(`http://${host}:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: '', price: -10 }),
    });

    expect(res.status).toBe(400);
    expect(queue.size()).toBe(0);
  });
});
