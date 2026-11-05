import { describe, expect, it } from 'vitest';
import { applyB3Risk, type B3Account, type B3Position } from '../packages/risk-engine/src/index.js';
import type { SymbolRules } from '../packages/core/src/index.js';

describe('TASK-40: Time-Stop e Entrada Escalonada', () => {
  const account: B3Account = {
    initialBankBrl: 100,
    cashBrl: 100,
    realizedPnlBrl: 0,
  };

  const rules: SymbolRules = {
    minNotional: 1,
    minQty: 1,
    stepSize: 1,
    tickSize: 0.01,
  };

  describe('Time-Stop', () => {
    it('aciona saída por time-stop quando a duração excede timeStopMinutes e o PnL líquido é <= 0', () => {
      const openedAt = new Date('2026-10-30T10:00:00Z');
      const now = new Date('2026-10-30T10:50:00Z'); // 50 minutos depois (> 45m padrão)

      const position: B3Position = {
        ticker: 'PETR4',
        quantity: 3,
        entryPrice: 30.0,
        costBrl: 90.0,
        openedAt,
      };

      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.0, // preço no zero a zero, mas com custos o net PnL é negativo
        account: { initialBankBrl: 100, cashBrl: 10, realizedPnlBrl: 0 },
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        timeStopEnabled: true,
        timeStopMinutes: 45,
        now,
      });

      expect(result.action).toBe('SELL');
      expect(result.quantity).toBe(3);
      expect(result.rejectionReason).toMatch(/Automatic time-stop triggered/);
    });

    it('NÃO aciona time-stop se a posição estiver com lucro líquido positivo', () => {
      const openedAt = new Date('2026-10-30T10:00:00Z');
      const now = new Date('2026-10-30T10:55:00Z'); // 55 minutos depois

      const position: B3Position = {
        ticker: 'PETR4',
        quantity: 3,
        entryPrice: 30.0,
        costBrl: 90.0,
        openedAt,
      };

      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.5, // Lucro cobre custos e gera retorno líquido positivo
        account: { initialBankBrl: 100, cashBrl: 10, realizedPnlBrl: 0 },
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        timeStopEnabled: true,
        timeStopMinutes: 45,
        now,
      });

      // Não dispara time-stop, permanece HOLD (ou aciona trailing/TP dependendo dos gatilhos)
      expect(result.rejectionReason).not.toMatch(/time-stop triggered/);
    });

    it('NÃO aciona time-stop se a duração for menor que o limite configurado', () => {
      const openedAt = new Date('2026-10-30T10:00:00Z');
      const now = new Date('2026-10-30T10:20:00Z'); // 20 minutos (< 45 min)

      const position: B3Position = {
        ticker: 'PETR4',
        quantity: 3,
        entryPrice: 30.0,
        costBrl: 90.0,
        openedAt,
      };

      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 29.9, // Pequena oscilação normal
        account: { initialBankBrl: 100, cashBrl: 10, realizedPnlBrl: 0 },
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        timeStopEnabled: true,
        timeStopMinutes: 45,
        now,
      });

      expect(result.action).toBe('HOLD');
    });
  });

  describe('Entrada Escalonada (Parcial-First)', () => {
    it('escala a quantidade inicial comprada quando entryScalingRatio está ativo e respeita o lote mínimo', () => {
      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 90, // permitia 3 ações a R$ 30
        price: 30.0,
        account: { initialBankBrl: 100, cashBrl: 95, realizedPnlBrl: 0 },
        position: null,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        entryScalingRatio: 0.34, // 3 * 0.34 = 1.02 -> 1 ação
      });

      expect(result.action).toBe('BUY');
      expect(result.quantity).toBe(1);
      expect(result.amountBrl).toBe(30.0);
    });

    it('TASK-41: rejeita nova tranche de BUY se o cooldown entre tranches ainda estiver ativo', () => {
      const openedAt = new Date('2026-10-30T10:00:00Z');
      const now = new Date('2026-10-30T10:02:00Z'); // apenas 2 minutos após abertura (< 5 min)

      const position: B3Position = {
        ticker: 'BBDC4',
        quantity: 1,
        entryPrice: 30.0,
        costBrl: 30.0,
        openedAt,
      };

      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 30,
        price: 30.0,
        account: { initialBankBrl: 100, cashBrl: 65, realizedPnlBrl: 0 },
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        entryScalingCooldownMinutes: 5,
        minutesSinceLastBuy: 2,
        now,
      });

      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toMatch(/scaling cooldown active \(2.0m < 5m required between tranches\)/);
    });

    it('TASK-41: autoriza nova tranche de BUY após o cooldown entre tranches ter expirado', () => {
      const openedAt = new Date('2026-10-30T10:00:00Z');
      const now = new Date('2026-10-30T10:07:00Z'); // 7 minutos após (> 5 min)

      const position: B3Position = {
        ticker: 'BBDC4',
        quantity: 1,
        entryPrice: 30.0,
        costBrl: 30.0,
        openedAt,
      };

      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 30,
        price: 30.0,
        account: { initialBankBrl: 100, cashBrl: 65, realizedPnlBrl: 0 },
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        entryScalingCooldownMinutes: 5,
        minutesSinceLastBuy: 7,
        now,
      });

      expect(result.action).toBe('BUY');
      expect(result.quantity).toBe(1);
    });
  });

  describe('Filtro de Abertura (Opening No-Trade Window)', () => {
    it('rejeita BUY nos primeiros N minutos do pregão para evitar volatilidade de abertura', () => {
      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 50,
        price: 25.0,
        account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 },
        position: null,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        openingNoTradeMinutes: 15,
        minutesSinceSessionStart: 5, // Apenas 5 min após a abertura
      });

      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toMatch(/session opening window/);
    });

    it('autoriza BUY após os primeiros N minutos do pregão', () => {
      const result = applyB3Risk({
        action: 'BUY',
        requestedBrl: 50,
        price: 25.0,
        account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 },
        position: null,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        openingNoTradeMinutes: 15,
        minutesSinceSessionStart: 20, // 20 min após abertura (> 15)
      });

      expect(result.action).toBe('BUY');
      expect(result.quantity).toBeGreaterThanOrEqual(1);
    });
  });
});
