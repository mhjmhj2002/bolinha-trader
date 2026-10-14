import type { Action, SymbolRules } from '@bolinha/core';
import { roundStepDown } from '@bolinha/core';
export interface B3Account {
  initialBankBrl: number;
  cashBrl: number;
  realizedPnlBrl: number;
}

export interface B3Position {
  ticker: string;
  quantity: number;
  entryPrice: number;
  costBrl: number;
  openedAt?: Date;
}

export interface B3RiskInput {
  action: Action;
  requestedBrl: number;
  price: number;
  account: B3Account;
  position: B3Position | null;
  rules: SymbolRules;
  maxPositionPercent: number;
  duplicateOrderPending: boolean;
  /** Se for verdadeiro, obriga encerramento ou impede abertura para zeragem intradiária de day trade */
  isDayTradeCloseOnly?: boolean;
}

export interface B3RiskResult {
  action: Action;
  amountBrl: number;
  quantity: number;
  rejectionReason: string | null;
}

const holdB3 = (reason: string): B3RiskResult => ({
  action: 'HOLD',
  amountBrl: 0,
  quantity: 0,
  rejectionReason: reason,
});

export function applyB3Risk(input: B3RiskInput): B3RiskResult {
  const { action, position, rules, price, isDayTradeCloseOnly } = input;
  if (action === 'HOLD') return holdB3('AI requested HOLD');
  if (input.duplicateOrderPending) return holdB3('Duplicate/pending order protection');

  if (isDayTradeCloseOnly) {
    if (action === 'BUY') return holdB3('BUY prohibited: day trade session is in close-only mode');
  }

  if (action === 'BUY') {
    if (!Number.isFinite(input.requestedBrl) || input.requestedBrl <= 0) {
      return holdB3('Invalid requested amount');
    }
    if (!Number.isFinite(input.account.cashBrl) || input.account.cashBrl <= 0) {
      return holdB3('Insufficient cash for BUY');
    }
    // Em posição aberta o teto respeita o percentual do patrimônio já alocado e o saldo em caixa disponível.
    const heldBrl = position ? position.costBrl : 0;
    const budget = ((input.account.cashBrl + heldBrl) * input.maxPositionPercent) / 100;
    const maxCash = Math.min(input.account.cashBrl, Math.max(0, budget - heldBrl));
    const amount = Math.min(input.requestedBrl, maxCash);
    if (amount < rules.minNotional) return holdB3('Amount below B3 minNotional');

    const quantity = roundStepDown(amount / price, rules.stepSize);
    if (quantity < rules.minQty || quantity * price < rules.minNotional) {
      return holdB3('Quantity below B3 minimum lot');
    }
    const finalAmount = Number((quantity * price).toFixed(2));
    if (finalAmount > input.account.cashBrl) {
      return holdB3('Purchase amount exceeds available cash');
    }
    return {
      action: 'BUY',
      amountBrl: finalAmount,
      quantity,
      rejectionReason: null,
    };
  }

  if (!position) return holdB3('SELL prohibited: no open B3 position');
  // SELL parcial: valor pedido convertido em ações (1..posição); valor inválido ou >= posição encerra tudo.
  const requestedQty = Number.isFinite(input.requestedBrl) && input.requestedBrl > 0
    ? Math.ceil(input.requestedBrl / price)
    : position.quantity;
  const quantity = Math.min(position.quantity, Math.max(rules.minQty, roundStepDown(requestedQty, rules.stepSize)));
  if (quantity < rules.minQty || quantity * price < rules.minNotional) {
    return holdB3('Sell quantity below B3 minimum');
  }
  return {
    action: 'SELL',
    amountBrl: Number((quantity * price).toFixed(2)),
    quantity,
    rejectionReason: null,
  };
}
