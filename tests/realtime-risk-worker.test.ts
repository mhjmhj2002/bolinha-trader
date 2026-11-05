import { describe, it, expect, vi } from 'vitest';
import { TradingService } from '../apps/worker/src/service.js';
import type { BrokerGateway } from '../packages/exchange/src/index.js';

describe('TradingService.onRealtimeTick (Fast-Path)', () => {
  const createMockRepo = (position: any = null) => ({
    openPosition: vi.fn().mockResolvedValue(position),
    account: vi.fn().mockResolvedValue({ initialBankUsdt: 100, cashUsdt: 70, realizedPnlUsdt: 0 }),
    pendingOrder: vi.fn().mockResolvedValue(false),
    createPendingOrder: vi.fn().mockResolvedValue(1),
    recordExecution: vi.fn().mockResolvedValue({ applied: true }),
    saveExecution: vi.fn().mockResolvedValue({ id: 1 }),
    ensureAccount: vi.fn().mockResolvedValue(undefined),
    event: vi.fn().mockResolvedValue(undefined),
    configuration: vi.fn().mockResolvedValue({
      timezone: 'America/Sao_Paulo',
      start: '09:00',
      stopNewPositions: '16:45',
      forceClose: '17:15',
      end: '18:00',
      intervalSeconds: 60,
      initialBankUsdt: 100,
      maxPositionPercent: 100,
    }),
  });

  const createMockExchange = (): BrokerGateway => ({
    rules: vi.fn().mockResolvedValue({ minNotional: 1, minQty: 1, stepSize: 1 }),
    price: vi.fn().mockResolvedValue(30),
    candles: vi.fn().mockResolvedValue([]),
    placeMarketOrder: vi.fn().mockResolvedValue({
      orderId: 'test-order-1',
      clientOrderId: 'client-1',
      status: 'FILLED',
      side: 'SELL',
      executedQty: 1,
      cummulativeQuoteQty: 29.5,
      fills: [{ price: 29.5, qty: 1, commission: 0.01, commissionAsset: 'BRL' }],
      commission: 0.01,
      transactTime: new Date(),
    }),
    pingPublic: vi.fn().mockResolvedValue(true),
    pingPrivate: vi.fn().mockResolvedValue(true),
    orderByClientId: vi.fn().mockResolvedValue(null),
  });

  it('ignora tick quando não há posição aberta', async () => {
    const repo = createMockRepo(null);
    const exchange = createMockExchange();
    const service = new TradingService(repo as any, exchange);

    const result = await service.onRealtimeTick({ symbol: 'PETR4', price: 30.0 });
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('No open position');
  });

  it('ignora tick de símbolo diferente da posição ativa', async () => {
    const repo = createMockRepo({
      symbol: 'PETR4',
      quantity: 1,
      entryPrice: 30.0,
      costUsdt: 30.0,
      openedAt: new Date(),
    });
    const exchange = createMockExchange();
    const service = new TradingService(repo as any, exchange);

    const result = await service.onRealtimeTick({ symbol: 'VALE3', price: 65.0 });
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('Tick symbol differs from active position');
  });

  it('não executa ordem se o preço estiver dentro da tolerância normal', async () => {
    const repo = createMockRepo({
      symbol: 'PETR4',
      quantity: 1,
      entryPrice: 30.0,
      costUsdt: 30.0,
      openedAt: new Date(),
    });
    const exchange = createMockExchange();
    const service = new TradingService(repo as any, exchange);

    // Variação de +0.1% não atinge take profit nem stop loss
    const result = await service.onRealtimeTick({ symbol: 'PETR4', price: 30.03 });
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('Price within risk tolerance');
  });

  it('dispara venda imediata se o preço violar o Stop Loss no tick', async () => {
    const repo = createMockRepo({
      symbol: 'PETR4',
      quantity: 1,
      entryPrice: 30.0,
      costUsdt: 30.0,
      openedAt: new Date(),
    });
    const exchange = createMockExchange();
    const service = new TradingService(repo as any, exchange);

    // Queda de 2.0% viola o STOP_LOSS_PCT (1.2%)
    const result = await service.onRealtimeTick({ symbol: 'PETR4', price: 29.40 });
    expect(result.executed).toBe(true);
    expect(result.reason?.toLowerCase()).toContain('stop loss');
    expect(exchange.placeMarketOrder).toHaveBeenCalledWith('SELL', 1, expect.any(String), undefined);
  });
});
