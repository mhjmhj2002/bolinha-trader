import { describe, expect, it } from 'vitest';
import {
  b3RequiredPriceForNetTarget,
  calculateB3NetPnl,
  B3_DAY_TRADE_TAX_RATE,
  defaultB3CostModel,
  config,
} from '@bolinha/core';
import { applyB3Risk } from '@bolinha/risk-engine';
import { runRobotsPreAnalysis } from '@bolinha/market-data';
import { buildB3Prompt } from '@bolinha/ai';

describe('TASK-33: Net Profit Targets with Fees and Day Trade Taxes (IR 20%)', () => {
  const bank = { initialBankBrl: 100, cashBrl: 20, realizedPnlBrl: 0 };
  const rules = { minNotional: 1, minQty: 1, stepSize: 1 };

  describe('Mathematical Net Calculation (@bolinha/core)', () => {
    it('calculates required exit market price to deliver +0.8% net return after fees and 20% IR', () => {
      const entryPrice = 30.00;
      const targetNetPct = 0.008; // +0.80% líquido
      const requiredPrice = b3RequiredPriceForNetTarget(entryPrice, targetNetPct, defaultB3CostModel, B3_DAY_TRADE_TAX_RATE);

      // Entrada a R$ 30.00:
      // Com slippage e taxas, o preço de saída exigido deve ser maior que o bruto (30 * 1.008 = 30.24)
      expect(requiredPrice).toBeGreaterThan(30.24);
      expect(requiredPrice).toBe(30.35); // Calculado precisamente

      // Verifica que vendendo a R$ 30.35, o lucro líquido real entrega aproximadamente +0.8% (diferença ínfima de 0.0006% por arredondamento de centavos BRL)
      const buyExecution = 30.00 * (1 + defaultB3CostModel.slippagePct);
      const buyTotalCost = buyExecution * (1 + defaultB3CostModel.feeRate) * 1;
      const pnl = calculateB3NetPnl(buyTotalCost, 1, requiredPrice, defaultB3CostModel, B3_DAY_TRADE_TAX_RATE);

      expect(pnl.netReturnPct).toBeCloseTo(targetNetPct, 3);
      expect(pnl.taxBrl).toBeGreaterThan(0);
      expect(pnl.finalPnlBrl).toBeGreaterThan(0);
    });

    it('calculates exact net PnL deducting slippage, fees and 20% IR on profits', () => {
      const entryCost = 30.02; // R$ 30 + compra
      const quantity = 2;
      const marketPrice = 30.50; // valorização relevante

      const result = calculateB3NetPnl(entryCost * quantity, quantity, marketPrice, defaultB3CostModel, 0.20);
      expect(result.exitExecutionPrice).toBeLessThan(marketPrice); // slippage de venda
      expect(result.exitFeeBrl).toBeGreaterThan(0); // emolumentos de venda
      expect(result.netPnlBeforeTaxBrl).toBeGreaterThan(0);
      expect(result.taxBrl).toBe(Number((result.netPnlBeforeTaxBrl * 0.20).toFixed(2)));
      expect(result.finalPnlBrl).toBe(Number((result.netPnlBeforeTaxBrl - result.taxBrl).toFixed(2)));
    });

    it('does not levy tax on loss trades', () => {
      const entryCost = 30.00;
      const quantity = 2;
      const marketPrice = 29.50; // prejuízo

      const result = calculateB3NetPnl(entryCost * quantity, quantity, marketPrice, defaultB3CostModel, 0.20);
      expect(result.netPnlBeforeTaxBrl).toBeLessThan(0);
      expect(result.taxBrl).toBe(0);
      expect(result.finalPnlBrl).toBe(result.netPnlBeforeTaxBrl);
    });
  });

  describe('Risk Engine Net Mode (applyB3Risk)', () => {
    const position = {
      ticker: 'PETR4',
      quantity: 3,
      entryPrice: 30.00,
      costBrl: 90.00,
      highestPrice: 30.25,
    };

    it('does NOT trigger Take Profit at gross price if net profit after fees and IR is below target', () => {
      // Preço de R$ 30.25 atinge +0.83% bruto, mas NÃO atinge +0.80% líquido (exige R$ 30.35)
      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.25,
        account: bank,
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        fullTakeProfitPct: 0.008,
        profitTargetMode: 'NET',
        dayTradeTaxRate: 0.20,
      });

      // Em NET mode, ainda não atingiu o alvo líquido, portanto mantém HOLD
      expect(result.action).toBe('HOLD');
      expect(result.rejectionReason).toBe('AI requested HOLD');
    });

    it('triggers Full Take Profit when price reaches the net target covering fees and 20% IR', () => {
      // Preço atinge R$ 30.35, que satisfaz os +0.80% líquidos pós-taxas e IR
      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.35,
        account: bank,
        position,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        fullTakeProfitPct: 0.008,
        profitTargetMode: 'NET',
        dayTradeTaxRate: 0.20,
      });

      expect(result.action).toBe('SELL');
      expect(result.quantity).toBe(3);
      expect(result.rejectionReason).toContain('net target +0.80% after fees & IR');
    });

    it('triggers Partial Take Profit when price reaches partial net target', () => {
      const multiPosition = {
        ticker: 'PETR4',
        quantity: 4,
        entryPrice: 20.00,
        costBrl: 80.00,
      };

      // Alvo parcial +1.0% líquido: exige R$ 20.29
      const belowNetResult = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 20.22, // +1.1% bruto, mas abaixo do líquido
        account: bank,
        position: multiPosition,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        partialTakeProfitTriggerPct: 0.010,
        profitTargetMode: 'NET',
      });
      expect(belowNetResult.action).toBe('HOLD');

      const atNetResult = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 20.29,
        account: bank,
        position: multiPosition,
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        partialTakeProfitTriggerPct: 0.010,
        profitTargetMode: 'NET',
      });
      expect(atNetResult.action).toBe('SELL');
      expect(atNetResult.quantity).toBe(2);
      expect(atNetResult.rejectionReason).toContain('net target +1.00% after fees & IR');
    });

    it('elevates Breakeven floor to cover fees and net profit lock-in when in NET mode', () => {
      // Entrada a R$ 30.00, subiu até R$ 30.40 (ativou breakeven >= 0.5%)
      // Com lock-in de +0.2% líquido, o piso de breakeven líquido calculado é R$ 30.12
      const result = applyB3Risk({
        action: 'HOLD',
        requestedBrl: 0,
        price: 30.10, // Abaixo do piso líquido de R$ 30.12
        account: bank,
        position: { ...position, highestPrice: 30.40 },
        rules,
        maxPositionPercent: 100,
        duplicateOrderPending: false,
        breakevenTriggerPct: 0.005,
        breakevenProfitLockPct: 0.002,
        profitTargetMode: 'NET',
      });

      expect(result.action).toBe('SELL');
      expect(result.rejectionReason).toContain('floor R$ 30.12');
    });
  });

  describe('Robots Pre-Analysis & AI Prompt with Net Target Awareness', () => {
    it('informs net PnL and net targets in AI prompt when NET mode is active', () => {
      const prompt = buildB3Prompt(
        {} as any,
        { initialBankBrl: 1000, cashBrl: 500 },
        { ticker: 'PETR4', quantity: 10, entryPrice: 30.00, costBrl: 300.00 },
        30.20,
        0.012,
        0.008,
        {},
        {
          profitTargetMode: 'NET',
          dayTradeTaxRate: 0.20,
          fullTakeProfitPct: 0.015,
          partialTakeProfitTriggerPct: 0.006,
        },
      );

      expect(prompt).toContain('líquido real estimado pós-taxas e IR 20%');
      expect(prompt).toContain('Take Profit Parcial (+0.6% líquido após taxas e IR)');
      expect(prompt).toContain('Take Profit Total Mecânico (+1.5% líquido após taxas e IR)');
    });

    it('aligns position manager robot with net profit targets', () => {
      const snapshot = {
        symbol: 'PETR4',
        capturedAt: new Date().toISOString(),
        intervals: {
          '1m': { price: 30.25, ema9: 30.2, ema21: 30.1, rsi14: 55, return1: 0.1, return3: 0.2, return12: 0.3, volume: 100, volumeAvg20: 80, volumeRatio: 1.25, high20: 30.3, low20: 30.0, emaRelation: 'EMA9_ABOVE_EMA21' as const, rsiState: 'NEUTRAL' as const, shortReturnState: 'UP' as const, volumeState: 'NORMAL' as const },
          '5m': { price: 30.25, ema9: 30.2, ema21: 30.1, rsi14: 55, return1: 0.1, return3: 0.2, return12: 0.3, volume: 100, volumeAvg20: 80, volumeRatio: 1.25, high20: 30.3, low20: 30.0, emaRelation: 'EMA9_ABOVE_EMA21' as const, rsiState: 'NEUTRAL' as const, shortReturnState: 'UP' as const, volumeState: 'NORMAL' as const },
          '15m': { price: 30.25, ema9: 30.2, ema21: 30.1, rsi14: 55, return1: 0.1, return3: 0.2, return12: 0.3, volume: 100, volumeAvg20: 80, volumeRatio: 1.25, high20: 30.3, low20: 30.0, emaRelation: 'EMA9_ABOVE_EMA21' as const, rsiState: 'NEUTRAL' as const, shortReturnState: 'UP' as const, volumeState: 'NORMAL' as const },
        },
      };

      // A R$ 30.25, o ganho bruto é +0.83%, mas o alvo líquido de 0.8% exige R$ 30.35
      const analysisHolding = runRobotsPreAnalysis(
        snapshot as any,
        30.25,
        {
          ticker: 'PETR4',
          quantity: 2,
          entryPrice: 30.00,
          costBrl: 60.00,
          fullTakeProfitPct: 0.008,
          profitTargetMode: 'NET',
        },
      );
      const exitManagerRobot = analysisHolding.robots.find((r) => r.robotId === 'position_exit_manager');
      expect(exitManagerRobot?.vote).toBe('HOLD');

      // A R$ 30.35, atinge o alvo líquido e emite SELL
      const analysisSelling = runRobotsPreAnalysis(
        snapshot as any,
        30.35,
        {
          ticker: 'PETR4',
          quantity: 2,
          entryPrice: 30.00,
          costBrl: 60.00,
          fullTakeProfitPct: 0.008,
          profitTargetMode: 'NET',
        },
      );
      const exitManagerSelling = analysisSelling.robots.find((r) => r.robotId === 'position_exit_manager');
      expect(exitManagerSelling?.vote).toBe('SELL');
      expect(exitManagerSelling?.rationale).toContain('líquido após taxas e IR');
    });
  });
});
