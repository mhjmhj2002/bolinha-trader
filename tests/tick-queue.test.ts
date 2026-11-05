import { describe, it, expect, vi } from 'vitest';
import { TickEventQueue } from '../packages/exchange/src/b3/tick-queue.js';
import type { MarketTickEvent, MarketCandleEvent } from '@bolinha/core';

describe('TickEventQueue', () => {
  it('enfileira e desenfileira ticks em ordem FIFO', () => {
    const queue = new TickEventQueue();
    const tick1: MarketTickEvent = { symbol: 'PETR4', price: 30.5, timestamp: 1000 };
    const tick2: MarketTickEvent = { symbol: 'VALE3', price: 65.0, timestamp: 1001 };

    expect(queue.enqueueTick(tick1)).toBe(true);
    expect(queue.enqueueTick(tick2)).toBe(true);
    expect(queue.size()).toBe(2);

    expect(queue.dequeue()).toEqual(tick1);
    expect(queue.dequeue()).toEqual(tick2);
    expect(queue.size()).toBe(0);
    expect(queue.dequeue()).toBeUndefined();
  });

  it('rejeita ticks inválidos com preço zero ou negativo', () => {
    const queue = new TickEventQueue();
    expect(queue.enqueueTick({ symbol: 'PETR4', price: 0, timestamp: 1000 })).toBe(false);
    expect(queue.enqueueTick({ symbol: 'PETR4', price: -10, timestamp: 1000 })).toBe(false);
    expect(queue.enqueueTick({ symbol: '', price: 30, timestamp: 1000 })).toBe(false);
    expect(queue.size()).toBe(0);
  });

  it('dispara eventos "tick" e "enqueue" ao receber dados', () => {
    const queue = new TickEventQueue();
    const tickHandler = vi.fn();
    const enqueueHandler = vi.fn();

    queue.on('tick', tickHandler);
    queue.on('enqueue', enqueueHandler);

    const tick: MarketTickEvent = { symbol: 'ITUB4', price: 32.1, timestamp: 2000 };
    queue.enqueueTick(tick);

    expect(tickHandler).toHaveBeenCalledWith(tick);
    expect(enqueueHandler).toHaveBeenCalledWith(tick);
  });

  it('respeita a capacidade máxima e descarta ticks antigos sob congestionamento', () => {
    const queue = new TickEventQueue({ maxQueueSize: 3, deduplicateBySymbol: false });

    queue.enqueueTick({ symbol: 'PETR4', price: 30.1, timestamp: 1 });
    queue.enqueueTick({ symbol: 'PETR4', price: 30.2, timestamp: 2 });
    queue.enqueueTick({ symbol: 'PETR4', price: 30.3, timestamp: 3 });
    expect(queue.size()).toBe(3);

    // Próximo tick descarta o primeiro
    queue.enqueueTick({ symbol: 'PETR4', price: 30.4, timestamp: 4 });
    expect(queue.size()).toBe(3);

    const first = queue.dequeue() as MarketTickEvent;
    expect(first.price).toBe(30.2);
  });

  it('compacta ticks antigos do mesmo símbolo quando deduplicateBySymbol é true', () => {
    const queue = new TickEventQueue({ maxQueueSize: 2, deduplicateBySymbol: true });

    queue.enqueueTick({ symbol: 'PETR4', price: 30.1, timestamp: 1 });
    queue.enqueueTick({ symbol: 'VALE3', price: 65.0, timestamp: 2 });

    // Novo tick de PETR4 deve substituir o tick anterior de PETR4
    queue.enqueueTick({ symbol: 'PETR4', price: 30.5, timestamp: 3 });
    expect(queue.size()).toBe(2);

    const item1 = queue.dequeue() as MarketTickEvent;
    const item2 = queue.dequeue() as MarketTickEvent;

    expect(item1.symbol).toBe('VALE3');
    expect(item2.symbol).toBe('PETR4');
    expect(item2.price).toBe(30.5);
  });

  it('suporta enfileiramento de candles', () => {
    const queue = new TickEventQueue();
    const candleHandler = vi.fn();
    queue.on('candle', candleHandler);

    const candleEvent: MarketCandleEvent = {
      symbol: 'PETR4',
      interval: '1m',
      candle: { openTime: 1000, open: 30, high: 31, low: 29.8, close: 30.8, volume: 1000, closeTime: 1059 },
    };

    expect(queue.enqueueCandle(candleEvent)).toBe(true);
    expect(candleHandler).toHaveBeenCalledWith(candleEvent);
    expect(queue.dequeue()).toEqual(candleEvent);
  });
});
