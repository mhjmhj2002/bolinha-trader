import { describe, expect, it } from 'vitest';
import { applyB3Risk, type B3RiskInput } from '@bolinha/risk-engine';
import { TradingService } from '../apps/worker/src/service.js';
import type { Candle } from '@bolinha/market-data';

const b3Rules = { minNotional: 1.0, minQty: 1, stepSize: 1 };

const mockBuyInput = (overrides: Partial<B3RiskInput> = {}): B3RiskInput => ({
  action: 'BUY',
  requestedBrl: 50,
  price: 25,
  account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 },
  position: null,
  rules: b3Rules,
  maxPositionPercent: 100,
  duplicateOrderPending: false,
  ...overrides,
});

describe('TASK-24: Daily Loss Limit / Circuit Breaker', () => {
  describe('@bolinha/risk-engine - applyB3Risk daily loss gate', () => {
    it('rejects BUY when accumulated daily loss reaches or exceeds dailyMaxLossPct', () => {
      // Banca R$ 100, dailyMaxLossPct = 0.05 (R$ 5,00 de perda permitida).
      // Se dailyRealizedPnlBrl = -5.00 => bloqueia BUY com mensagem explícita.
      const risk = applyB3Risk(
        mockBuyInput({
          dailyRealizedPnlBrl: -5.0,
          dailyMaxLossPct: 0.05,
          account: { initialBankBrl: 100, cashBrl: 95, realizedPnlBrl: -5.0 },
        }),
      );

      expect(risk.action).toBe('HOLD');
      expect(risk.quantity).toBe(0);
      expect(risk.amountBrl).toBe(0);
      expect(risk.rejectionReason).toMatch(
        /BUY rejected: Daily loss limit reached \(-R\$ 5\.00 \/ limit -R\$ 5\.00\)/,
      );
    });

    it('rejects BUY when accumulated daily loss exceeds dailyMaxLossBrl override', () => {
      // Limite em R$ de R$ 10,00. Perda de R$ 10,50 => bloqueia.
      const risk = applyB3Risk(
        mockBuyInput({
          dailyRealizedPnlBrl: -10.5,
          dailyMaxLossPct: 0.20, // 20% seria 20 reais, mas dailyMaxLossBrl sobrepõe
          dailyMaxLossBrl: 10.0,
          account: { initialBankBrl: 100, cashBrl: 89.5, realizedPnlBrl: -10.5 },
        }),
      );

      expect(risk.action).toBe('HOLD');
      expect(risk.rejectionReason).toMatch(
        /BUY rejected: Daily loss limit reached \(-R\$ 10\.50 \/ limit -R\$ 10\.00\)/,
      );
    });

    it('allows BUY when accumulated daily loss is within allowed threshold', () => {
      // Perda de R$ 3,00 para limite de R$ 5,00 => BUY permitido normalmente
      const risk = applyB3Risk(
        mockBuyInput({
          dailyRealizedPnlBrl: -3.0,
          dailyMaxLossPct: 0.05,
          account: { initialBankBrl: 100, cashBrl: 97, realizedPnlBrl: -3.0 },
        }),
      );

      expect(risk.action).toBe('BUY');
      expect(risk.quantity).toBeGreaterThan(0);
      expect(risk.rejectionReason).toBeNull();
    });

    it('allows BUY when daily profit is positive (positive PnL)', () => {
      const risk = applyB3Risk(
        mockBuyInput({
          dailyRealizedPnlBrl: 12.5,
          dailyMaxLossPct: 0.05,
          account: { initialBankBrl: 100, cashBrl: 112.5, realizedPnlBrl: 12.5 },
        }),
      );

      expect(risk.action).toBe('BUY');
      expect(risk.quantity).toBeGreaterThan(0);
      expect(risk.rejectionReason).toBeNull();
    });

    it('does not block SELL or stop-loss operations when daily loss limit is breached', () => {
      // Se já possui posição aberta e o limite diário foi violado por outros trades,
      // a saída (SELL) ou stop da posição existente NÃO deve ser bloqueada.
      const risk = applyB3Risk({
        action: 'SELL',
        requestedBrl: 25,
        price: 25,
        account: { initialBankBrl: 100, cashBrl: 70, realizedPnlBrl: -15 },
        position: { ticker: 'PETR4', quantity: 1, entryPrice: 25, costBrl: 25 },
        rules: b3Rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        dailyRealizedPnlBrl: -15,
        dailyMaxLossPct: 0.05,
      });

      expect(risk.action).toBe('SELL');
      expect(risk.quantity).toBe(1);
      expect(risk.rejectionReason).toBeNull();
    });
  });

  describe('@bolinha/worker - TradingService circuit breaker behavior', () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i): Candle => ({
      openTime: i,
      closeTime: i,
      open: 25 + i * 0.01,
      high: 25.1 + i * 0.01,
      low: 24.9 + i * 0.01,
      close: 25 + i * 0.01,
      volume: 100,
    }));

    it('early-exits in runOnce with WARN event when daily loss limit is breached with no open position', async () => {
      const events: Array<{ severity: string; type: string; metadata?: unknown }> = [];
      const repo = {
        ensureAccount: async () => {},
        heartbeat: async () => {},
        account: async () => ({ initialBankUsdt: 100, cashUsdt: 90, realizedPnlUsdt: -10, aiCostUsd: 0 }),
        openPosition: async () => null,
        pendingOrder: async () => false,
        dailyRealizedPnl: async () => -10, // Perda de R$ 10,00 no dia (limite 5% de 100 = R$ 5,00)
        event: async (severity: string, type: string, _msg: string, metadata?: unknown) => {
          events.push({ severity, type, metadata });
        },
      };

      const exchange = {
        candles: async () => candles,
        rules: async () => b3Rules,
        orderByClientId: async () => null,
      };

      const ai = {
        decide: async () => {
          throw new Error('AI decide should not be called when circuit breaker is active');
        },
      };

      const service = new TradingService(repo as never, exchange as never, ai as never);
      const result = await service.runOnce(new Date('2026-10-01T12:00:00Z'));

      expect(result.action).toBe('HOLD');
      expect(result.reason).toMatch(/Daily loss limit reached/);

      const triggerEvent = events.find((e) => e.type === 'daily_loss_limit_triggered');
      expect(triggerEvent).toBeDefined();
      expect(triggerEvent?.severity).toBe('WARN');
    });
  });
});
