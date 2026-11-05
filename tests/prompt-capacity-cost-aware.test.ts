import { describe, expect, it } from 'vitest';
import {
  B3_DEFAULT_BUY_COST_BUFFER_PCT,
  B3_MIN_NOTIONAL_BRL,
  defaultB3CostModel,
  estimateB3BuyCost,
  maxAffordableB3BuyQuantity,
} from '@bolinha/core';
import { B3MarketDataService, B3PaperBroker, getB3SymbolRules } from '@bolinha/exchange';
import { applyB3Risk, type B3RiskInput } from '@bolinha/risk-engine';
import { buildB3Prompt } from '@bolinha/ai';

const rules = getB3SymbolRules('PETR4');

/** Caixa máximo ofertado ao motor: ele próprio aplica o teto por caixa/percentual. */
const cashOnlyAccount = (cash: number) => ({ initialBankBrl: cash, cashBrl: cash, realizedPnlBrl: 0 });

const buyRisk = (cash: number, price: number, extra: Partial<B3RiskInput> = {}): B3RiskInput => ({
  action: 'BUY',
  requestedBrl: cash,
  price,
  account: cashOnlyAccount(cash),
  position: null,
  rules,
  maxPositionPercent: 100,
  duplicateOrderPending: false,
  ...extra,
});

/** Quantidade que o motor de risco efetivamente aprova (0 quando cai em HOLD). */
const approvedQuantity = (
  cash: number,
  price: number,
  bufferPct = B3_DEFAULT_BUY_COST_BUFFER_PCT,
  stepSize = rules.stepSize,
): number => {
  const result = applyB3Risk(
    buyRisk(cash, price, { buyCostBufferPct: bufferPct, rules: { ...rules, stepSize } }),
  );
  return result.action === 'BUY' ? result.quantity : 0;
};

describe('TASK-21: maxAffordableB3BuyQuantity (shared cost-aware BUY capacity)', () => {
  it('rounds down to the step and never exceeds the cash once fees are included', () => {
    // Antes (Math.floor(100/10)): 10 ações => notional 100,00 e o broker rejeitava por
    // falta de caixa para slippage + emolumentos. Agora 9.
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1 })).toBe(9);
    expect(maxAffordableB3BuyQuantity({ cashBrl: 60, price: 10, stepSize: 1 })).toBe(5);
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100.97, price: 30.2, stepSize: 1 })).toBe(3);
    expect(maxAffordableB3BuyQuantity({ cashBrl: 5, price: 10, stepSize: 1 })).toBe(0);
  });

  it('honours stepSize, minQty and minNotional', () => {
    // Lote de 100 ações: só 0 cabe (1 lote = R$ 1.000) => 0, nunca um lote parcial.
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 100 })).toBe(0);
    expect(maxAffordableB3BuyQuantity({ cashBrl: 5_000, price: 10, stepSize: 100 })).toBe(400);
    // Lote de 0,01 ação aceito (mercado fracionário).
    const fractional = maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 0.01 });
    expect(fractional).toBeGreaterThan(0);
    expect(Number((fractional * 100).toFixed(6)) % 1).toBe(0);
    expect(fractional * 10).toBeLessThanOrEqual(100);
    // minQty acima do que o caixa comporta => 0; abaixo => mantém a quantidade.
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1, minQty: 50 })).toBe(0);
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1, minQty: 4 })).toBe(9);
    // Notional mínimo que a quantidade encontrada não atinge => 0.
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1, minNotional: 95 })).toBe(0);
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1, minNotional: 90 })).toBe(9);
  });

  it('respects the cost model and the safety buffer (both only reduce the quantity)', () => {
    // Sem custos E sem headroom o notional exato cabe: 10 ações.
    const freeCosts = { slippagePct: 0, feeRate: 0 };
    expect(
      maxAffordableB3BuyQuantity({
        cashBrl: 100,
        price: 10,
        stepSize: 1,
        costModel: freeCosts,
        buyCostBufferPct: 0,
      }),
    ).toBe(10);
    // O default de `buyCostBufferPct` continua fail-closed mesmo com custos zerados.
    expect(maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1, costModel: freeCosts })).toBe(
      9,
    );
    const expensiveCosts = { slippagePct: 0.01, feeRate: 0.005 };
    expect(
      maxAffordableB3BuyQuantity({ cashBrl: 100, price: 10, stepSize: 1, costModel: expensiveCosts }),
    ).toBe(9);
    const strictBuffer = maxAffordableB3BuyQuantity({
      cashBrl: 100,
      price: 10,
      stepSize: 1,
      buyCostBufferPct: 0.05,
    });
    const looseBuffer = maxAffordableB3BuyQuantity({
      cashBrl: 100,
      price: 10,
      stepSize: 1,
      buyCostBufferPct: 0,
    });
    expect(strictBuffer).toBeLessThanOrEqual(looseBuffer);
  });

  it('returns 0 (never negative/NaN/Infinity) for invalid inputs', () => {
    const invalid: Array<Record<string, number>> = [
      { cashBrl: Number.NaN, price: 10, stepSize: 1 },
      { cashBrl: Number.POSITIVE_INFINITY, price: 10, stepSize: 1 },
      { cashBrl: 0, price: 10, stepSize: 1 },
      { cashBrl: -100, price: 10, stepSize: 1 },
      { cashBrl: 100, price: 0, stepSize: 1 },
      { cashBrl: 100, price: -10, stepSize: 1 },
      { cashBrl: 100, price: Number.NaN, stepSize: 1 },
      { cashBrl: 100, price: 10, stepSize: 0 },
      { cashBrl: 100, price: 10, stepSize: -1 },
      { cashBrl: 100, price: 10, stepSize: Number.NaN },
    ];
    for (const input of invalid) {
      const quantity = maxAffordableB3BuyQuantity(input);
      expect(quantity).toBe(0);
      expect(Number.isFinite(quantity)).toBe(true);
    }
  });
});

describe('TASK-21: capacity helper never advertises more than applyB3Risk approves', () => {
  const grid: Array<{ label: string; cash: number; price: number; stepSize: number; bufferPct: number }> = [];
  for (const price of [3.17, 10, 10.5, 30.2, 25, 0.99, 47.83, 7.5]) {
    for (const cash of [5, 9.99, 60, 100, 100.97, 250.5, 1_000, 42.42]) {
      for (const stepSize of [1, 0.01]) {
        for (const bufferPct of [0, B3_DEFAULT_BUY_COST_BUFFER_PCT]) {
          grid.push({
            label: `cash ${cash} / price ${price} / step ${stepSize} / buffer ${bufferPct}`,
            cash,
            price,
            stepSize,
            bufferPct,
          });
        }
      }
    }
  }

  it('sweeps at least 200 cash/price/step/buffer combinations with zero mismatches', () => {
    expect(grid.length).toBeGreaterThanOrEqual(200);
    const mismatches = grid
      .map(({ cash, price, stepSize, bufferPct }) => {
        const helper = maxAffordableB3BuyQuantity({
          cashBrl: cash,
          price,
          stepSize,
          minQty: rules.minQty,
          minNotional: rules.minNotional,
          costModel: defaultB3CostModel,
          buyCostBufferPct: bufferPct,
        });
        const engine = approvedQuantity(cash, price, bufferPct, stepSize);
        return { cash, price, stepSize, bufferPct, helper, engine };
      })
      .filter(({ helper, engine }) => helper !== engine);
    expect(mismatches).toEqual([]);
  });

  it('asserts the exact audited cases (100/10, 60/10, 100.97/30.20, 100/25, 5/10)', () => {
    const cases: Array<{ cash: number; price: number; expected: number }> = [
      { cash: 100, price: 10, expected: 9 },
      { cash: 60, price: 10, expected: 5 },
      { cash: 100.97, price: 30.2, expected: 3 },
      { cash: 100, price: 25, expected: 3 },
      { cash: 5, price: 10, expected: 0 },
    ];
    for (const { cash, price, expected } of cases) {
      const helper = maxAffordableB3BuyQuantity({
        cashBrl: cash,
        price,
        stepSize: rules.stepSize,
        minQty: rules.minQty,
        minNotional: rules.minNotional,
      });
      expect(helper).toBe(expected);
      expect(helper).toBe(approvedQuantity(cash, price));
      // ...e o notional anunciado nunca passa do caixa.
      expect(Number((helper * price).toFixed(2))).toBeLessThanOrEqual(cash);
    }
  });

  it('B3PaperBroker fills every advertised quantity without Insufficient funds', async () => {
    const fillable = grid.filter(({ stepSize }) => stepSize === rules.stepSize);
    for (const { cash, price } of fillable) {
      const quantity = maxAffordableB3BuyQuantity({ cashBrl: cash, price, stepSize: rules.stepSize });
      if (quantity <= 0) continue;
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', price);
      const broker = new B3PaperBroker('PETR4', cash, marketData);
      const order = await broker.placeMarketOrder('BUY', quantity, `task21-${cash}-${price}`);
      expect(order.status).toBe('FILLED');
      expect(order.executedQty).toBe(quantity);
      expect(broker.getAccount().cashBrl).toBeGreaterThanOrEqual(0);
    }
  });

  it('the reserved cost of the advertised quantity really fits the cash', () => {
    for (const { cash, price, stepSize, bufferPct } of grid) {
      const quantity = maxAffordableB3BuyQuantity({
        cashBrl: cash,
        price,
        stepSize,
        buyCostBufferPct: bufferPct,
      });
      if (quantity <= 0) continue;
      const reserved = estimateB3BuyCost(price, quantity, defaultB3CostModel).totalBrl * (1 + bufferPct);
      expect(reserved).toBeLessThanOrEqual(cash);
      expect(Number((quantity * price).toFixed(2))).toBeLessThanOrEqual(cash);
    }
  });

  it('keeps the B3 minimum notional shared with @bolinha/exchange', () => {
    expect(rules.minNotional).toBe(B3_MIN_NOTIONAL_BRL);
  });

  it('prompt capacity honours maxPositionPercent exactly like applyB3Risk (no drift below 100%)', () => {
    // Regressão do drift cross-módulo: `buildB3Prompt` calculava a capacidade apenas
    // pelo CAIXA, enquanto `applyB3Risk` limita o BUY por
    // `(caixa + custo da posição) * pct / 100`. Com pct < 100 o prompt anunciava mais
    // ações do que o motor aprova (volumes de até ~4x nos casos auditados).
    const drift: Array<{ cash: number; price: number; pct: number; advertised: number; approved: number }> = [];
    for (const cash of [5, 23.47, 100, 100.97, 250]) {
      for (const price of [0.5, 2.5, 10, 25]) {
        for (const pct of [100, 50, 25]) {
          for (const position of [
            null,
            { ticker: 'PETR4', quantity: 4, entryPrice: price, costBrl: price * 4 },
          ]) {
            const prompt = buildB3Prompt(
              {} as never,
              { initialBankBrl: 100, cashBrl: cash },
              position,
              price,
              0.012,
              0.008,
              {},
              { buyCostBufferPct: B3_DEFAULT_BUY_COST_BUFFER_PCT, maxPositionPercent: pct },
            );
            const advertised = Number(prompt.match(/capacidade máxima de compra atual: (\d+) ação/)?.[1] ?? 0);
            const result = applyB3Risk({
              action: 'BUY',
              requestedBrl: cash,
              price,
              account: { initialBankBrl: 100, cashBrl: cash, realizedPnlBrl: 0 },
              position,
              rules,
              maxPositionPercent: pct,
              duplicateOrderPending: false,
              buyCostBufferPct: B3_DEFAULT_BUY_COST_BUFFER_PCT,
            });
            const approved = result.action === 'BUY' ? result.quantity : 0;
            // Invariante exigida: o prompt NUNCA anuncia mais do que o motor aprova.
            // Com pct = 100 (default) os dois coincidem exatamente; abaixo disso o
            // prompt pode ser mais conservador (nunca o contrário).
            if (advertised > approved || (pct === 100 && advertised !== approved))
              drift.push({ cash, price, pct, advertised, approved });
          }
        }
      }
    }
    expect(drift).toEqual([]);
  });
});
