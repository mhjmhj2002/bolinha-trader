import type { Action, SymbolRules } from '@bolinha/core';
import { roundStepDown } from '@bolinha/core';
import type { EntryConfluenceResult } from '@bolinha/market-data';
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
  /** Maior preço alcançado durante o trade (High Watermark) */
  highestPrice?: number;
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
  /** Stop loss máximo percentual permitido (ex: 0.015 para -1.5%). Se excedido e a IA hesitar em HOLD, converte para SELL compulsório de proteção */
  maxStopLossPct?: number;
  /** Gatilho percentual de valorização para elevar o stop loss para o preço de entrada (Breakeven), ex: 0.008 para +0.8% */
  breakevenTriggerPct?: number;
  /** Distância percentual do trailing stop a partir da máxima (ex: 0.006 para 0.6% abaixo do topo) quando o lucro superar o breakeven */
  trailingStopPct?: number;
  /** Banda de ruído (ex: 0.004 = 0.4%): SELL discricionário da IA com |PnL| menor que isto vira HOLD (evita overtrading). */
  sellNoiseBandPct?: number;
  /**
   * Confluência multi-timeframe (1m/5m/15m) já avaliada por @bolinha/market-data.
   * Quando informada, um BUY só passa se a confluência for válida e atingir o mínimo configurado.
   */
  entryConfluence?: EntryConfluenceResult | null;
  /** Exigir confluência multi-timeframe para BUY. Default true (fail-closed). */
  requireEntryConfluence?: boolean;
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
  const {
    action,
    position,
    rules,
    price,
    isDayTradeCloseOnly,
    maxStopLossPct,
    breakevenTriggerPct = 0.008, // +0.8% de valorização ativa proteção no Breakeven
    trailingStopPct,
  } = input;
  if (input.duplicateOrderPending) return holdB3('Duplicate/pending order protection');

  // Proteção de Breakeven e Trailing Stop:
  // Se a posição em algum momento atingiu ganho >= breakevenTriggerPct (+0.8%),
  // o stop loss de proteção é elevado para o ponto de equilíbrio (preço de entrada com cobertura de taxas ~+0.06%).
  // Se trailingStopPct for fornecido, também protege parte dos ganhos a partir do topo histórico (highestPrice).
  if (position) {
    const highest = Math.max(position.highestPrice ?? position.entryPrice, price);
    const maxGainPct = (highest - position.entryPrice) / position.entryPrice;

    if (maxGainPct >= breakevenTriggerPct) {
      // Preço de breakeven que cobre custos operacionais (emolumentos B3 ~0.06% ida e volta)
      const breakevenPrice = Number((position.entryPrice * 1.0006).toFixed(2));
      let protectedFloorPrice = breakevenPrice;

      if (typeof trailingStopPct === 'number' && trailingStopPct > 0) {
        const trailingFloor = Number((highest * (1 - trailingStopPct)).toFixed(2));
        protectedFloorPrice = Math.max(breakevenPrice, trailingFloor);
      }

      if (price <= protectedFloorPrice) {
        if (action === 'BUY') {
          return holdB3(`BUY rejected: breakeven/trailing protection triggered at R$ ${price.toFixed(2)} <= floor R$ ${protectedFloorPrice.toFixed(2)}`);
        }
        return {
          action: 'SELL',
          amountBrl: Number((position.quantity * price).toFixed(2)),
          quantity: position.quantity,
          rejectionReason: action === 'HOLD'
            ? `Automatic breakeven/trailing stop triggered (price R$ ${price.toFixed(2)} <= floor R$ ${protectedFloorPrice.toFixed(2)})`
            : null,
        };
      }
    }
  }

  // Proteção de Stop Loss Dinâmico Máximo Intradiário:
  // Se houver posição aberta e o prejuízo não realizado atingir ou ultrapassar maxStopLossPct,
  // força SELL para estopar e evitar carregar perda até o force close de fim de pregão.
  if (position && typeof maxStopLossPct === 'number' && maxStopLossPct > 0) {
    const unrealizedLossPct = (position.entryPrice - price) / position.entryPrice;
    if (unrealizedLossPct >= maxStopLossPct) {
      if (action === 'BUY') {
        return holdB3(`BUY rejected: position hit maximum intradiary stop loss (${(unrealizedLossPct * 100).toFixed(2)}% >= ${(maxStopLossPct * 100).toFixed(2)}%)`);
      }
      // Se a IA emitiu HOLD quando já está em violação de Stop Loss máximo, o motor de risco intervém e aciona SELL de proteção
      return {
        action: 'SELL',
        amountBrl: Number((position.quantity * price).toFixed(2)),
        quantity: position.quantity,
        rejectionReason: action === 'HOLD' ? `Automatic stop loss triggered (${(unrealizedLossPct * 100).toFixed(2)}% loss)` : null,
      };
    }
  }

  if (action === 'HOLD') return holdB3('AI requested HOLD');

  if (isDayTradeCloseOnly) {
    if (action === 'BUY') return holdB3('BUY prohibited: day trade session is in close-only mode');
  }

  // Filtro de entrada multi-timeframe: um BUY só passa quando a confluência já
  // avaliada (EMA9 > EMA21 e RSI não sobrecomprado em 1m/5m/15m) é válida e
  // atinge o mínimo configurado. Sem dados válidos => HOLD (fail-closed).
  if (action === 'BUY' && (input.requireEntryConfluence === true || input.entryConfluence)) {
    const confluence = input.entryConfluence;
    if (!confluence || !confluence.valid || !confluence.allowed) {
      const detail = confluence
        ? confluence.reason
        : 'multi-timeframe confluence data unavailable (fail-closed)';
      return holdB3(`BUY rejected by multi-timeframe entry filter: ${detail}`);
    }
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
  if (!input.isDayTradeCloseOnly && typeof input.sellNoiseBandPct === 'number' && input.sellNoiseBandPct > 0) {
    const pnlPct = (price - position.entryPrice) / position.entryPrice;
    if (Math.abs(pnlPct) < input.sellNoiseBandPct) {
      return holdB3(`SELL rejected: PnL ${(pnlPct * 100).toFixed(2)}% is within noise band ±${(input.sellNoiseBandPct * 100).toFixed(2)}%`);
    }
  }
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
