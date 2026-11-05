import { describe, expect, it } from 'vitest';
import { B3MarketDataService, B3PaperBroker } from '@bolinha/exchange';
import { applyB3Risk, type B3RiskInput } from '@bolinha/risk-engine';
import {
  B3_DEFAULT_BUY_COST_BUFFER_PCT,
  B3_PAPER_SLIPPAGE_PCT,
  B3_DAY_TRADE_FEE_RATE,
  defaultB3CostModel,
  estimateB3BuyCost,
  resolveBuyCostBufferPct,
} from '@bolinha/core';

const b3Rules = { minNotional: 1.0, minQty: 1, stepSize: 1 };

const buyRisk = (overrides: Partial<B3RiskInput>): B3RiskInput => ({
  action: 'BUY',
  requestedBrl: 100,
  price: 25,
  account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 },
  position: null,
  rules: b3Rules,
  maxPositionPercent: 100,
  duplicateOrderPending: false,
  ...overrides,
});

/** Custo real que o broker debita (slippage + emolumentos, mesmas constantes). */
const brokerCost = (price: number, quantity: number) => estimateB3BuyCost(price, quantity).totalBrl;

describe('TASK-16: cost-aware BUY sizing in @bolinha/risk-engine', () => {
  it('reduces the exact-multiple case (cash 100.00 / price 25.00) to an order the broker accepts', async () => {
    const price = 25;
    const cash = 100;
    const risk = applyB3Risk(buyRisk({ price, account: { initialBankBrl: cash, cashBrl: cash, realizedPnlBrl: 0 } }));

    // Antes da correção: qty 4 / R$ 100,00 (aprovado) e `Insufficient funds` no broker.
    expect(risk.action).toBe('BUY');
    expect(risk.quantity).toBe(3);
    expect(risk.amountBrl).toBe(75);
    // Invariante central: custo real do broker (notional + slippage + emolumentos) cabe no caixa.
    expect(brokerCost(price, risk.quantity)).toBeLessThanOrEqual(cash);

    // ...e o broker de fato executa a ordem aprovada pelo risco.
    const marketData = new B3MarketDataService();
    marketData.setMockPrice('PETR4', price);
    const broker = new B3PaperBroker('PETR4', cash, marketData);
    const order = await broker.placeMarketOrder('BUY', risk.quantity, 'task16-exact-multiple');

    expect(order.status).toBe('FILLED');
    expect(order.executedQty).toBe(3);
    expect(broker.getAccount().cashBrl).toBeGreaterThanOrEqual(0);
  });

  it('never approves qty*price == cash when that leaves no room for fees', () => {
    const price = 25;
    const cash = 100;
    const risk = applyB3Risk(buyRisk({ price, requestedBrl: cash, account: { initialBankBrl: cash, cashBrl: cash, realizedPnlBrl: 0 } }));

    // O notional "exato" (4 * 25 = 100) precisa ser reduzido para caber com os custos.
    expect(risk.action).toBe('BUY');
    expect(risk.quantity * price).toBeLessThan(cash);
    expect(risk.quantity).toBeLessThan(Math.floor(cash / price));
    const debit = brokerCost(price, risk.quantity);
    expect(debit).toBeLessThanOrEqual(cash);
  });

  it('holds with a clear reason when cash genuinely cannot afford a single share', () => {
    const risk = applyB3Risk(buyRisk({ price: 25, requestedBrl: 10, account: { initialBankBrl: 10, cashBrl: 10, realizedPnlBrl: 0 } }));

    expect(risk.action).toBe('HOLD');
    expect(risk.quantity).toBe(0);
    expect(risk.amountBrl).toBe(0);
    expect(risk.rejectionReason).toMatch(/Quantity below B3 minimum lot/);
  });

  it('holds when the cash covers 1 share but not the broker fees on top of it', () => {
    // Caixa exatamente igual a 1 ação; slippage (0,05%) + emolumentos (0,03%) estouram.
    const price = 25;
    const risk = applyB3Risk(buyRisk({ price, requestedBrl: price, account: { initialBankBrl: price, cashBrl: price, realizedPnlBrl: 0 } }));

    expect(risk.action).toBe('HOLD');
    expect(risk.rejectionReason).toBe('Quantity below B3 minimum lot');
  });

  it('regression: cash 100.97 / price 30.20 still yields qty 3', () => {
    const risk = applyB3Risk(
      buyRisk({ price: 30.2, requestedBrl: 100.97, account: { initialBankBrl: 100.97, cashBrl: 100.97, realizedPnlBrl: 0 } }),
    );

    expect(risk.action).toBe('BUY');
    expect(risk.quantity).toBe(3);
    expect(risk.amountBrl).toBe(90.6);
    expect(brokerCost(30.2, 3)).toBeLessThanOrEqual(100.97);
  });

  it('invariant: for a range of prices the approved order plus real broker costs never exceed cash', () => {
    const cash = 100;
    for (let cents = 100; cents <= 10_000; cents += 7) {
      const price = Number((cents / 100).toFixed(2));
      const risk = applyB3Risk(buyRisk({ price, requestedBrl: cash, account: { initialBankBrl: cash, cashBrl: cash, realizedPnlBrl: 0 } }));
      if (risk.action !== 'BUY') {
        expect(risk.quantity).toBe(0);
        continue;
      }
      expect(Number.isInteger(risk.quantity)).toBe(true);
      expect(risk.quantity).toBeGreaterThanOrEqual(b3Rules.minQty);
      expect(risk.quantity * price).toBeGreaterThanOrEqual(b3Rules.minNotional);
      // Nenhuma ordem aprovada pode ser rejeitada pelo broker por saldo.
      expect(brokerCost(price, risk.quantity)).toBeLessThanOrEqual(cash);
    }
  });

  it('invariant: every approved BUY is filled by B3PaperBroker without Insufficient funds', async () => {
    const cash = 100;
    for (const price of [25, 20, 10, 33.33, 12.5, 30.2, 5, 50, 3.33]) {
      const marketData = new B3MarketDataService();
      marketData.setMockPrice('PETR4', price);
      const broker = new B3PaperBroker('PETR4', cash, marketData);
      const risk = applyB3Risk(
        buyRisk({ price, requestedBrl: cash, account: { initialBankBrl: cash, cashBrl: cash, realizedPnlBrl: 0 } }),
      );
      if (risk.action !== 'BUY') continue;
      await expect(broker.placeMarketOrder('BUY', risk.quantity, `task16-price-${price}`)).resolves.toMatchObject({
        status: 'FILLED',
        executedQty: risk.quantity,
      });
    }
  });

  it('keeps the cost model and default headroom aligned with the broker (no forked literals)', () => {
    expect(B3_DAY_TRADE_FEE_RATE).toBe(0.0003);
    expect(B3_PAPER_SLIPPAGE_PCT).toBe(0.0005);
    expect(defaultB3CostModel).toEqual({ slippagePct: B3_PAPER_SLIPPAGE_PCT, feeRate: B3_DAY_TRADE_FEE_RATE });
    expect(B3_DEFAULT_BUY_COST_BUFFER_PCT).toBeGreaterThan(0);
    // A config e o input aceitam apenas buffers >= 0; inválidos caem no default seguro.
    expect(resolveBuyCostBufferPct(0.001)).toBe(0.001);
    expect(resolveBuyCostBufferPct(0)).toBe(0);
    expect(resolveBuyCostBufferPct(-0.5)).toBe(B3_DEFAULT_BUY_COST_BUFFER_PCT);
    expect(resolveBuyCostBufferPct(Number.NaN)).toBe(B3_DEFAULT_BUY_COST_BUFFER_PCT);
    expect(resolveBuyCostBufferPct(1)).toBe(0.05);
  });

  it('a larger configured buffer is fail-closed (never buys more than the real cost allows)', () => {
    const base = { price: 25, account: { initialBankBrl: 100, cashBrl: 100, realizedPnlBrl: 0 } };
    const normal = applyB3Risk(buyRisk(base));
    const conservative = applyB3Risk(buyRisk({ ...base, buyCostBufferPct: 0.02 }));

    expect(normal.action).toBe('BUY');
    expect(conservative.action).toBe('BUY');
    expect(conservative.quantity).toBeLessThanOrEqual(normal.quantity);
    expect(brokerCost(25, conservative.quantity)).toBeLessThanOrEqual(100);
  });

  it('honours an explicit cost model so the estimated debit matches the broker exactly', () => {
    const risk = applyB3Risk(buyRisk({ price: 25, costModel: defaultB3CostModel }));
    expect(risk.action).toBe('BUY');
    const estimate = estimateB3BuyCost(25, risk.quantity);
    expect(estimate.executionPrice).toBe(25.01);
    expect(estimate.commissionBrl).toBe(0.0225);
    expect(estimate.totalBrl).toBe(75.0525);
    expect(estimate.totalBrl).toBeLessThanOrEqual(100);
  });
});
