import type { Action, B3CostModel, SymbolRules } from '@bolinha/core';
import {
  B3_DAY_TRADE_TAX_RATE,
  B3_DEFAULT_BUY_COST_BUFFER_PCT,
  b3RequiredPriceForNetTarget,
  calculateB3NetPnl,
  config,
  defaultB3CostModel,
  estimateB3BuyCost,
  resolveBuyCostBufferPct,
  roundStepDown,
} from '@bolinha/core';
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
  /** Se a saída parcial já foi executada para esta posição */
  partialTakeProfitDone?: boolean;
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
  /** Stop loss percentual padrão/operacional (ex: 0.012 para -1.2%) */
  stopLossPct?: number;
  /** Stop loss máximo percentual permitido (ex: 0.018 para -1.8%). Teto rígido de segurança intradiária */
  maxStopLossPct?: number;
  /** Modo de Stop Loss: 'STATIC' ou 'ATR' */
  stopLossMode?: 'STATIC' | 'ATR';
  /** Valor do ATR (Average True Range) do ativo */
  atr?: number | null;
  /** Multiplicador da distância em ATR para o Stop Loss (padrão 2.0) */
  atrMultiplier?: number;
  /** Gatilho percentual de valorização para elevar o stop loss para o preço de entrada (Breakeven), ex: 0.005 para +0.5% */
  breakevenTriggerPct?: number;
  /** Percentual mínimo de lucro real travado ao acionar o breakeven (ex: 0.002 para +0.2% garantido) */
  breakevenProfitLockPct?: number;
  /** Distância percentual do trailing stop a partir da máxima (ex: 0.006 para 0.6% abaixo do topo) quando o lucro superar o breakeven */
  trailingStopPct?: number;
  /** Percentual máximo de proteção do stop móvel (ex: 0.015 para travar teto em +1.5%). Acima disto o piso estaciona para dar fôlego ao trade */
  trailingStopCapPct?: number;
  /** Gatilho percentual de valorização para execução de saída parcial automática (Scale-out), ex: 0.006 para +0.6% */
  partialTakeProfitTriggerPct?: number;
  /** Proporção da posição a liquidar na saída parcial (ex: 0.5 para 50%) */
  partialTakeProfitRatio?: number;
  /** Se a saída parcial já foi executada para o trade atual */
  partialTakeProfitDone?: boolean;
  /** Gatilho percentual de valorização para encerramento mecânico total da posição (Full TP), ex: 0.008 para +0.8% */
  fullTakeProfitPct?: number;
  /** Modo de cálculo dos alvos de lucro: 'NET' (consciente de taxas e IR de Day Trade 20%) ou 'GROSS'. Padrão: 'NET'. */
  profitTargetMode?: 'NET' | 'GROSS';
  /** Alíquota de imposto de renda sobre o ganho líquido de Day Trade (padrão 0.20 = 20%). */
  dayTradeTaxRate?: number;
  /** Banda de ruído (ex: 0.004 = 0.4%): SELL discricionário da IA com |PnL| menor que isto vira HOLD (evita overtrading). */
  sellNoiseBandPct?: number;
  /**
   * PnL líquido realizado acumulado no dia de hoje (em BRL).
   * Usado para avaliar o Circuit Breaker / Daily Loss Limit.
   */
  dailyRealizedPnlBrl?: number;
  /** Limite percentual de perda máxima diária permitida (ex: 0.05 para 5% da banca inicial). */
  dailyMaxLossPct?: number;
  /** Limite financeiro em R$ de perda máxima diária permitida (ex: 10.00). */
  dailyMaxLossBrl?: number;
  /**
   * Confluência multi-timeframe (1m/5m/15m) já avaliada por @bolinha/market-data.
   * Quando informada, um BUY só passa se a confluência for válida e atingir o mínimo configurado.
   */
  entryConfluence?: EntryConfluenceResult | null;
  /** Exigir confluência multi-timeframe para BUY. Default true (fail-closed). */
  requireEntryConfluence?: boolean;
  /**
   * Valor da VWAP diária. Se fornecido e requireVwapAbove for true (padrão true),
   * o preço atual deve ser maior ou igual à VWAP para autorizar BUY.
   */
  vwap?: number | null;
  /** Exigir preço >= VWAP diária para BUY. Default: true. */
  requireVwapAbove?: boolean;
  /**
   * Headroom ADICIONAL (fração, ex: 0.001 = 0,10%) reservado sobre o custo real do
   * broker (slippage + emolumentos) ao dimensionar um BUY. Default seguro:
   * `B3_DEFAULT_BUY_COST_BUFFER_PCT`. Valores maiores são sempre fail-closed (apenas
   * reduzem a quantidade); valores negativos/inválidos caem no default.
   */
  buyCostBufferPct?: number;
  /**
   * Modelo de custos do broker (slippage + emolumentos). Default: o mesmo usado por
   * `B3PaperBroker` (`B3_PAPER_SLIPPAGE_PCT` + `B3_DAY_TRADE_FEE_RATE` de @bolinha/core).
   */
  costModel?: B3CostModel;
  /** Razão mínima ganho líquido/perda líquida (alvo vs stop após custos). 0/undefined desativa. */
  minRewardRiskRatio?: number;
  /** Alvo mínimo expresso em múltiplos do custo de round-trip. 0/undefined desativa. */
  minTargetCostMultiple?: number;
  /** Stop mínimo expresso em múltiplos do ATR% do ativo. 0/undefined desativa. */
  minStopAtrMultiple?: number;
  /**
   * TASK-36: risco máximo por operação como fração do patrimônio (ex.: 0.005 = 0,5%). A quantidade do BUY
   * é limitada para que a perda no stop (incluindo custos de round-trip) não ultrapasse esse valor.
   * 0/undefined desativa. Se o lote mínimo não couber no orçamento de risco, o BUY vira HOLD (fail-closed).
   */
  riskPerTradePct?: number;
  /** Escala o orçamento de risco pela confiança da decisão (0..1), opcional. */
  confidenceScale?: number;
  /** TASK-40: Habilitar saída por tempo (time-stop) */
  timeStopEnabled?: boolean;
  /** TASK-40: Duração máxima da posição em minutos antes de encerrar se PnL <= 0 (padrão 45 min) */
  timeStopMinutes?: number;
  /** TASK-40: Data/hora atual da avaliação para cálculo de duração do time-stop */
  now?: Date;
  /** TASK-40: Entrada escalonada: fração inicial da quantidade a comprar (ex: 0.33 ou 0.5; default 1.0) */
  entryScalingRatio?: number;
  /** TASK-41: Intervalo mínimo em minutos entre tranches de compra na mesma posição (default 5; 0 desativa) */
  entryScalingCooldownMinutes?: number;
  /** TASK-41: Minutos decorridos desde a última compra (tranche) da posição */
  minutesSinceLastBuy?: number;
  /** TASK-40: Minutos iniciais do pregão sem novas compras para evitar volatilidade de abertura (default 0) */
  openingNoTradeMinutes?: number;
  /** TASK-40: Minutos decorridos desde a abertura do pregão (para filtro de abertura) */
  minutesSinceSessionStart?: number;
}

export interface EntryEconomics {
  /** Custo percentual de round-trip (slippage + emolumentos, ida e volta). */
  roundTripCostPct: number;
  stopPct: number;
  targetPct: number;
  /** Ganho líquido esperado no alvo (fração). */
  netRewardPct: number;
  /** Perda líquida esperada no stop (fração). */
  netRiskPct: number;
  rewardRiskRatio: number;
}

/**
 * Calcula a economia de uma entrada: razão ganho/perda líquida após custos de round-trip.
 * `targetPct` em modo NET já é líquido de custos/IR (alvo líquido); em GROSS desconta o custo.
 */
export function computeEntryEconomics(params: {
  stopPct: number;
  targetPct: number;
  profitTargetMode: 'NET' | 'GROSS';
  costModel?: B3CostModel;
}): EntryEconomics {
  const cost = params.costModel ?? defaultB3CostModel;
  const roundTripCostPct = 2 * (cost.slippagePct + cost.feeRate);
  const netRewardPct = params.profitTargetMode === 'NET'
    ? params.targetPct
    : params.targetPct - roundTripCostPct;
  const netRiskPct = params.stopPct + roundTripCostPct;
  return {
    roundTripCostPct,
    stopPct: params.stopPct,
    targetPct: params.targetPct,
    netRewardPct,
    netRiskPct,
    rewardRiskRatio: netRiskPct > 0 ? netRewardPct / netRiskPct : 0,
  };
}

export interface B3RiskResult {
  action: Action;
  amountBrl: number;
  quantity: number;
  rejectionReason: string | null;
  /** R:R líquido esperado da entrada (apenas em BUY aprovado quando avaliável). */
  rewardRiskRatio?: number;
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
    stopLossPct,
    maxStopLossPct,
    breakevenTriggerPct = 0.008, // +0.8% de valorização ativa proteção no Breakeven
    breakevenProfitLockPct,
    trailingStopPct,
    trailingStopCapPct,
    fullTakeProfitPct,
  } = input;
  if (input.duplicateOrderPending) return holdB3('Duplicate/pending order protection');

  // Stop Loss Efetivo Base:
  // Se stopLossPct for fornecido (ex: 0.012), usa-o como base; se maxStopLossPct existir, aplica clamp como teto rígido de proteção.
  let effectiveStopLossPct: number | undefined = undefined;
  if (typeof stopLossPct === 'number' && stopLossPct > 0) {
    effectiveStopLossPct = typeof maxStopLossPct === 'number' && maxStopLossPct > 0
      ? Math.min(stopLossPct, maxStopLossPct)
      : stopLossPct;
  } else if (typeof maxStopLossPct === 'number' && maxStopLossPct > 0) {
    effectiveStopLossPct = maxStopLossPct;
  }

  const isAtrMode = input.stopLossMode === 'ATR';
  const hasValidAtr = typeof input.atr === 'number' && Number.isFinite(input.atr) && input.atr > 0;

  if (position && isAtrMode && hasValidAtr && position.entryPrice > 0) {
    const multiplier = typeof input.atrMultiplier === 'number' && input.atrMultiplier > 0 ? input.atrMultiplier : 2.0;
    const stopDistance = input.atr! * multiplier;
    const atrStopPct = stopDistance / position.entryPrice;
    if (typeof maxStopLossPct === 'number' && maxStopLossPct > 0) {
      effectiveStopLossPct = Math.min(atrStopPct, maxStopLossPct);
    } else {
      effectiveStopLossPct = atrStopPct;
    }
  }

  const profitTargetMode = input.profitTargetMode ?? (input.costModel ? 'NET' : 'GROSS');
  const dayTradeTaxRate = input.dayTradeTaxRate ?? config.DAY_TRADE_TAX_RATE ?? B3_DAY_TRADE_TAX_RATE;
  const costModel = input.costModel ?? defaultB3CostModel;

  // Proteção de Breakeven e Trailing Stop:
  // Se a posição em algum momento atingiu ganho >= breakevenTriggerPct (+0.5% a +0.8%),
  // o stop loss de proteção é elevado para o ponto de equilíbrio com lucro líquido garantido (Profit Lock-in).
  // Se trailingStopPct for fornecido, também protege parte dos ganhos a partir do topo histórico (highestPrice).
  // Se trailingStopCapPct for fornecido, o piso de proteção estaciona nesse teto de ganho garantido para dar fôlego ao trade.
  if (position) {
    const highest = Math.max(position.highestPrice ?? position.entryPrice, price);
    const maxGainPct = (highest - position.entryPrice) / position.entryPrice;

    if (maxGainPct >= breakevenTriggerPct) {
      // Preço de breakeven base: cobertura de custos operacionais (emolumentos B3 ~0.06% ida e volta)
      // ou piso com margem de lucro líquido garantida (breakevenProfitLockPct, ex: +0.20%).
      const lockPct = typeof breakevenProfitLockPct === 'number' && breakevenProfitLockPct > 0
        ? breakevenProfitLockPct
        : 0.0006;
      const breakevenPrice = profitTargetMode === 'NET'
        ? b3RequiredPriceForNetTarget(position.entryPrice, lockPct, costModel, dayTradeTaxRate)
        : Number((position.entryPrice * (1 + lockPct)).toFixed(2));
      let protectedFloorPrice = breakevenPrice;

      if (typeof trailingStopPct === 'number' && trailingStopPct > 0) {
        let trailingFloor = highest * (1 - trailingStopPct);
        if (typeof trailingStopCapPct === 'number' && trailingStopCapPct > 0) {
          const capPrice = position.entryPrice * (1 + trailingStopCapPct);
          trailingFloor = Math.min(trailingFloor, capPrice);
        }
        protectedFloorPrice = Math.max(breakevenPrice, Number(trailingFloor.toFixed(2)));
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

  // Proteção de Stop Loss Dinâmico Máximo Intradiário (com suporte a Stop ATR):
  // Se houver posição aberta, calcula o stop percentual efetivo da operação:
  // - Se stopLossMode === 'ATR' e houver ATR válido (> 0):
  //     stopDistance = atr * (atrMultiplier ?? 2.0);
  //     stopPct = stopDistance / position.entryPrice;
  //     effectiveMaxStopLossPct = Math.min(stopPct, maxStopLossPct ?? stopPct);
  // - Caso contrário (ou fallback), usa maxStopLossPct configurado.
  // Se o prejuízo não realizado atingir ou ultrapassar esse limite,
  // força SELL para estopar e evitar carregar perda até o force close de fim de pregão.
  if (position) {
    if (typeof effectiveStopLossPct === 'number' && effectiveStopLossPct > 0) {
      const unrealizedLossPct = (position.entryPrice - price) / position.entryPrice;
      if (unrealizedLossPct >= effectiveStopLossPct) {
        if (action === 'BUY') {
          return holdB3(`BUY rejected: position hit maximum intradiary stop loss (${(unrealizedLossPct * 100).toFixed(2)}% >= ${(effectiveStopLossPct * 100).toFixed(2)}%)`);
        }
        // Se a IA emitiu HOLD quando já está em violação de Stop Loss, o motor de risco intervém e aciona SELL de proteção
        return {
          action: 'SELL',
          amountBrl: Number((position.quantity * price).toFixed(2)),
          quantity: position.quantity,
          rejectionReason: action === 'HOLD' ? `Automatic stop loss triggered (${(unrealizedLossPct * 100).toFixed(2)}% loss)` : null,
        };
      }
    }
  }

  // Saídas Parciais Mecânicas Automáticas com Múltiplos Alvos (Scale-out):
  // Se position.quantity > 1 e o ganho atingir partialTakeProfitTriggerPct (padrão +1.0%),
  // e a parcial ainda não foi realizada nesta posição, força intervenção de SELL para realizar parcial.
  if (position && position.quantity > 1 && position.entryPrice > 0) {
    const partialTriggerPct = typeof input.partialTakeProfitTriggerPct === 'number' && input.partialTakeProfitTriggerPct > 0
      ? input.partialTakeProfitTriggerPct
      : undefined;
    const partialRatio = typeof input.partialTakeProfitRatio === 'number' && input.partialTakeProfitRatio > 0 && input.partialTakeProfitRatio < 1
      ? input.partialTakeProfitRatio
      : 0.5;
    const partialDone = input.partialTakeProfitDone ?? position.partialTakeProfitDone ?? false;

    if (partialTriggerPct !== undefined && !partialDone) {
      const triggerPrice = profitTargetMode === 'NET'
        ? b3RequiredPriceForNetTarget(position.entryPrice, partialTriggerPct, costModel, dayTradeTaxRate)
        : Number((position.entryPrice * (1 + partialTriggerPct)).toFixed(2));

      const isTriggered = profitTargetMode === 'NET'
        ? price >= triggerPrice - 1e-6
        : ((price - position.entryPrice) / position.entryPrice) >= partialTriggerPct - 1e-6;

      if (isTriggered) {
        if (action === 'HOLD' || action === 'BUY') {
          const quantityToSell = Math.max(1, Math.floor(position.quantity * partialRatio));
          const amountBrl = Number((quantityToSell * price).toFixed(2));
          const gainPctFormatted = (((price - position.entryPrice) / position.entryPrice) * 100).toFixed(2);
          const modeLabel = profitTargetMode === 'NET' ? ` (net target +${(partialTriggerPct * 100).toFixed(2)}% after fees & IR)` : '';
          return {
            action: 'SELL',
            amountBrl,
            quantity: quantityToSell,
            rejectionReason: `Automatic partial take profit triggered at +${gainPctFormatted}%${modeLabel}`,
          };
        }
      }
    }
  }

  // Full Take Profit Mecânico Objetivo (Full TP):
  // Se houver posição aberta (mesmo com 1 ação ou com saldo após parcial) e o ganho atual atingir
  // fullTakeProfitPct (ex: +0.8%), liquida 100% da posição restante imediatamente a mercado.
  // Garante o lucro na alta sem depender da discricionariedade da IA.
  if (position && position.quantity > 0 && position.entryPrice > 0) {
    if (typeof fullTakeProfitPct === 'number' && fullTakeProfitPct > 0) {
      const triggerPrice = profitTargetMode === 'NET'
        ? b3RequiredPriceForNetTarget(position.entryPrice, fullTakeProfitPct, costModel, dayTradeTaxRate)
        : Number((position.entryPrice * (1 + fullTakeProfitPct)).toFixed(2));

      const isTriggered = profitTargetMode === 'NET'
        ? price >= triggerPrice - 1e-6
        : ((price - position.entryPrice) / position.entryPrice) >= fullTakeProfitPct - 1e-6;

      if (isTriggered) {
        const gainPct = (price - position.entryPrice) / position.entryPrice;
        const modeLabel = profitTargetMode === 'NET' ? ` (net target +${(fullTakeProfitPct * 100).toFixed(2)}% after fees & IR)` : '';
        if (action === 'BUY') {
          return holdB3(`BUY rejected: position hit full take profit target (+${(gainPct * 100).toFixed(2)}% >= target R$ ${triggerPrice.toFixed(2)}${modeLabel})`);
        }
        return {
          action: 'SELL',
          amountBrl: Number((position.quantity * price).toFixed(2)),
          quantity: position.quantity,
          rejectionReason: `Automatic full take profit triggered at +${(gainPct * 100).toFixed(2)}%${modeLabel}`,
        };
      }
    }
  }

  // Proteção de Fim de Pregão (EOD Protective Profit Lock / Unwind):
  // Na janela de encerramento (`isDayTradeCloseOnly`, entre stopNewPositions e forceClose),
  // se houver posição aberta e o preço estiver cobrindo os custos de corretagem/emolumentos
  // (preço >= entrada * 1.0006), o motor de risco intervém e aciona SELL total para colocar o
  // lucro no bolso antes do leilão/queda de fim de pregão, impedindo que a posição seja levada
  // passivamente até o forceClose com risco de devolver ganhos ou gerar prejuízo.
  if (isDayTradeCloseOnly && position && position.quantity > 0 && position.entryPrice > 0) {
    const breakevenCoverPrice = Number((position.entryPrice * 1.0006).toFixed(2));
    if (price >= breakevenCoverPrice) {
      const pnlPct = ((price - position.entryPrice) / position.entryPrice) * 100;
      return {
        action: 'SELL',
        amountBrl: Number((position.quantity * price).toFixed(2)),
        quantity: position.quantity,
        rejectionReason: `EOD protective profit take: locking in ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% gain during close-only window before session end`,
      };
    }
  }

  // TASK-40: Time-Stop (Saída por Tempo sem Progresso):
  // Se a posição estiver aberta há mais de TIME_STOP_MINUTES (ex: 45 minutos) e o PnL líquido
  // for estagnado ou negativo (netReturnPct <= 0), encerra a posição para desalavancar,
  // liberar capital e evitar que trades laterais se arrastem até o stop cheio ou force close de fim de pregão.
  if (position && position.quantity > 0 && position.entryPrice > 0 && position.openedAt && (input.timeStopEnabled ?? false)) {
    const timeStopMins = input.timeStopMinutes ?? 45;
    const nowMs = (input.now ?? new Date()).getTime();
    const openedAtMs = new Date(position.openedAt).getTime();
    const durationMinutes = (nowMs - openedAtMs) / 60_000;

    if (durationMinutes >= timeStopMins) {
      const netResult = calculateB3NetPnl(position.costBrl, position.quantity, price, costModel, dayTradeTaxRate);
      if (netResult.netReturnPct <= 0) {
        return {
          action: 'SELL',
          amountBrl: Number((position.quantity * price).toFixed(2)),
          quantity: position.quantity,
          rejectionReason: `Automatic time-stop triggered: position open for ${Math.round(durationMinutes)}m (>= ${timeStopMins}m limit) with non-positive net PnL (${(netResult.netReturnPct * 100).toFixed(2)}%)`,
        };
      }
    }
  }

  if (action === 'HOLD') return holdB3('AI requested HOLD');

  if (isDayTradeCloseOnly) {
    if (action === 'BUY') return holdB3('BUY prohibited: day trade session is in close-only mode');
  }

  // TASK-40: Filtro de Abertura de Pregão (Opening No-Trade Window):
  // Nos primeiros N minutos da sessão (ex: 15 ou 30 min), a volatilidade e ruído de leilão
  // costumam provocar stops falsos. Se configurado e aplicável, bloqueia BUYs com HOLD de proteção.
  if (action === 'BUY' && typeof input.openingNoTradeMinutes === 'number' && input.openingNoTradeMinutes > 0) {
    if (typeof input.minutesSinceSessionStart === 'number' && input.minutesSinceSessionStart < input.openingNoTradeMinutes) {
      return holdB3(`BUY rejected: session opening window (${Math.round(input.minutesSinceSessionStart)}m < ${input.openingNoTradeMinutes}m no-trade buffer)`);
    }
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
      if (detail.startsWith('BUY rejected: Price R$')) {
        return holdB3(detail);
      }
      return holdB3(`BUY rejected by multi-timeframe entry filter: ${detail}`);
    }
  }

  // Filtro Institucional de VWAP Intradiária para Ações B3:
  // Previne compras contra a pressão vendedora institucional quando a cotação estiver abaixo da VWAP.
  if (action === 'BUY' && (input.requireVwapAbove ?? true)) {
    const vwap = input.vwap ?? input.entryConfluence?.vwap;
    if (typeof vwap === 'number' && Number.isFinite(vwap)) {
      if (price < vwap) {
        return holdB3(`BUY rejected: Price R$ ${price.toFixed(2)} is below daily VWAP R$ ${vwap.toFixed(2)}`);
      }
    }
  }

  // Limite Diário de Perda (Daily Loss Limit / Circuit Breaker):
  // Se o PnL líquido do dia for inferior ou igual ao limite tolerado (realizedPnlBrl <= -maxDailyLoss),
  // qualquer tentativa de BUY é convertida para HOLD de proteção.
  if (action === 'BUY') {
    const dailyPnl = input.dailyRealizedPnlBrl ?? 0;
    let allowedLossBrl: number | null = null;

    if (typeof input.dailyMaxLossBrl === 'number' && input.dailyMaxLossBrl > 0) {
      allowedLossBrl = input.dailyMaxLossBrl;
    } else if (typeof input.dailyMaxLossPct === 'number' && input.dailyMaxLossPct > 0) {
      const initialBank = input.account.initialBankBrl > 0 ? input.account.initialBankBrl : 100;
      allowedLossBrl = initialBank * input.dailyMaxLossPct;
    }

    if (allowedLossBrl !== null && dailyPnl <= -allowedLossBrl) {
      return holdB3(
        `BUY rejected: Daily loss limit reached (-R$ ${Math.abs(dailyPnl).toFixed(2)} / limit -R$ ${allowedLossBrl.toFixed(2)})`,
      );
    }
  }

  // Economia da entrada (TASK-35): o alvo líquido precisa compensar custos e risco, e o stop
  // precisa estar fora do ruído (ATR) do ativo. Dados indisponíveis não bloqueiam (regras
  // dependentes de ATR/alvo apenas são puladas); dados inválidos presentes bloqueiam.
  let entryRewardRisk: number | undefined;
  let resolvedEntryStopPct: number | undefined;
  if (action === 'BUY') {
    const entryStopPct = isAtrMode && hasValidAtr && price > 0
      ? (typeof maxStopLossPct === 'number' && maxStopLossPct > 0
        ? Math.min((input.atr! * (input.atrMultiplier && input.atrMultiplier > 0 ? input.atrMultiplier : 2.0)) / price, maxStopLossPct)
        : (input.atr! * (input.atrMultiplier && input.atrMultiplier > 0 ? input.atrMultiplier : 2.0)) / price)
      : effectiveStopLossPct;
    resolvedEntryStopPct = entryStopPct;
    const hasTarget = typeof fullTakeProfitPct === 'number' && fullTakeProfitPct > 0;

    if (entryStopPct !== undefined && entryStopPct > 0 && hasTarget) {
      const eco = computeEntryEconomics({
        stopPct: entryStopPct,
        targetPct: fullTakeProfitPct,
        profitTargetMode,
        costModel: input.costModel,
      });
      const minMultiple = input.minTargetCostMultiple ?? 0;
      if (minMultiple > 0 && fullTakeProfitPct < eco.roundTripCostPct * minMultiple) {
        return holdB3(
          `BUY rejected: target +${(fullTakeProfitPct * 100).toFixed(2)}% is below ${minMultiple}x round-trip cost (${(eco.roundTripCostPct * 100).toFixed(2)}%)`,
        );
      }
      const minRr = input.minRewardRiskRatio ?? 0;
      if (minRr > 0 && (!Number.isFinite(eco.rewardRiskRatio) || eco.rewardRiskRatio < minRr)) {
        return holdB3(
          `BUY rejected: net reward/risk ${eco.rewardRiskRatio.toFixed(2)} below minimum ${minRr.toFixed(2)} (target +${(fullTakeProfitPct * 100).toFixed(2)}% vs stop -${(entryStopPct * 100).toFixed(2)}%, round-trip cost ${(eco.roundTripCostPct * 100).toFixed(2)}%)`,
        );
      }
      if (Number.isFinite(eco.rewardRiskRatio)) entryRewardRisk = Number(eco.rewardRiskRatio.toFixed(4));
    }

    const minStopAtr = input.minStopAtrMultiple ?? 0;
    if (minStopAtr > 0 && entryStopPct !== undefined && entryStopPct > 0 && hasValidAtr && price > 0) {
      const atrPct = input.atr! / price;
      if (entryStopPct < atrPct * minStopAtr) {
        return holdB3(
          `BUY rejected: stop -${(entryStopPct * 100).toFixed(2)}% is inside market noise (< ${minStopAtr}x ATR ${(atrPct * 100).toFixed(2)}%)`,
        );
      }
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

    // TASK-41: Cooldown de entrada escalonada (scaling tranches):
    // Se já temos uma posição aberta e queremos aumentar (scaling/pyramiding),
    // exigir um intervalo mínimo de N minutos desde a última tranche para evitar
    // acumular lote no mesmo topo ou minuto.
    if (position && typeof input.entryScalingCooldownMinutes === 'number' && input.entryScalingCooldownMinutes > 0) {
      const elapsed = typeof input.minutesSinceLastBuy === 'number'
        ? input.minutesSinceLastBuy
        : (position.openedAt && input.now
            ? Math.max(0, (input.now.getTime() - position.openedAt.getTime()) / 60_000)
            : undefined);

      if (elapsed !== undefined && elapsed < input.entryScalingCooldownMinutes) {
        return holdB3(
          `BUY rejected: scaling cooldown active (${elapsed.toFixed(1)}m < ${input.entryScalingCooldownMinutes}m required between tranches)`,
        );
      }
    }

    const budget = ((input.account.cashBrl + heldBrl) * input.maxPositionPercent) / 100;
    const maxCash = Math.min(input.account.cashBrl, Math.max(0, budget - heldBrl));
    const amount = Math.min(input.requestedBrl, maxCash);
    if (amount < rules.minNotional) return holdB3('Amount below B3 minNotional');

    // Dimensionamento COST-AWARE: o broker debita `gross + emolumentos` sobre o preço de
    // execução com slippage (B3PaperBroker.placeMarketOrder). Reservamos esse mesmo custo
    // real — `estimateB3BuyCost`, fonte única em @bolinha/core — acrescido de um headroom
    // configurável antes de arredondar a quantidade PARA BAIXO no stepSize. Sem isso, um
    // BUY aprovado aqui podia ser rejeitado pelo broker com `Insufficient funds` sempre que
    // o caixa fosse múltiplo quase exato do preço (ex: caixa R$ 100,00 / preço R$ 25,00).
    const costBufferPct = resolveBuyCostBufferPct(input.buyCostBufferPct);
    const cashCap = input.account.cashBrl;
    /** Custo real do BUY (bruto + emolumentos) inflado pelo headroom de segurança. */
    const reservedCost = (qty: number) =>
      estimateB3BuyCost(price, qty, input.costModel).totalBrl * (1 + costBufferPct);
    /**
     * Arredonda PARA BAIXO no stepSize até o custo reservado caber no caixa. A
     * estimativa por unidade já chega a uma ordem do limite, então no máximo alguns
     * passos de correção são necessários (apenas arredondamento de emolumentos).
     */
    const reduceToAffordable = (candidate: number): number => {
      let qty = candidate;
      for (let guard = 0; guard < 4 && qty >= rules.minQty && reservedCost(qty) > cashCap; guard++) {
        qty = Number((qty - rules.stepSize).toFixed(10));
      }
      return qty;
    };

    let quantity = roundStepDown(amount / price, rules.stepSize);
    if (quantity > 0 && reservedCost(quantity) > cashCap) {
      // O caixa é o teto real: custo por ação (execução + emolumento unitário, ambos
      // arredondados como o broker faz) define a maior quantidade inteira executável.
      const unitReservedCost = reservedCost(1);
      const cashLimitedQty = unitReservedCost > 0
        ? roundStepDown(cashCap / unitReservedCost, rules.stepSize)
        : 0;
      quantity = reduceToAffordable(Math.min(quantity, cashLimitedQty));
    }
    if (quantity > 0 && typeof input.riskPerTradePct === 'number' && input.riskPerTradePct > 0) {
      // Dimensionamento por risco (TASK-36): perda no stop + custos de round-trip <= orcamento de risco.
      const equityBrl = input.account.cashBrl + heldBrl;
      const scale = typeof input.confidenceScale === 'number' && input.confidenceScale > 0
        ? Math.min(1, input.confidenceScale)
        : 1;
      const riskBudgetBrl = equityBrl * input.riskPerTradePct * scale;
      const cost = input.costModel ?? defaultB3CostModel;
      const roundTripCostPct = 2 * (cost.slippagePct + cost.feeRate);
      const stopForRisk = resolvedEntryStopPct;
      if (stopForRisk === undefined || !(stopForRisk > 0)) {
        return holdB3('BUY rejected: risk-based sizing enabled but stop distance is unavailable (fail-closed)');
      }
      const lossPerShare = price * (stopForRisk + roundTripCostPct);
      const riskLimitedQty = lossPerShare > 0 ? roundStepDown(riskBudgetBrl / lossPerShare, rules.stepSize) : 0;
      if (riskLimitedQty < rules.minQty) {
        return holdB3(
          `BUY rejected: risk budget R$ ${riskBudgetBrl.toFixed(2)} (${(input.riskPerTradePct * 100).toFixed(2)}% of equity) cannot fund the minimum lot (loss at stop R$ ${lossPerShare.toFixed(2)}/share)`,
        );
      }
      quantity = Math.min(quantity, riskLimitedQty);
    }
    // TASK-40: Entrada Escalonada (Parcial-First / Scaling):
    // Permite fracionar a entrada inicial (ex: 1/3 ou 1/2) para testar o trade antes de completar a posição.
    if (quantity > rules.minQty && typeof input.entryScalingRatio === 'number' && input.entryScalingRatio > 0 && input.entryScalingRatio < 1) {
      const scaledQty = roundStepDown(quantity * input.entryScalingRatio, rules.stepSize);
      if (scaledQty >= rules.minQty && scaledQty * price >= rules.minNotional) {
        quantity = scaledQty;
      }
    }
    if (quantity < rules.minQty || quantity * price < rules.minNotional) {
      return holdB3('Quantity below B3 minimum lot');
    }
    const finalAmount = Number((quantity * price).toFixed(2));
    if (finalAmount > input.account.cashBrl) {
      return holdB3('Purchase amount exceeds available cash');
    }
    const reservedTotal = reservedCost(quantity);
    if (reservedTotal > cashCap) {
      return holdB3(
        `Purchase cost including B3 fees and slippage guard R$ ${reservedTotal.toFixed(2)} exceeds available cash R$ ${cashCap.toFixed(2)}`,
      );
    }
    return {
      action: 'BUY',
      amountBrl: finalAmount,
      quantity,
      rejectionReason: null,
      ...(entryRewardRisk !== undefined ? { rewardRiskRatio: entryRewardRisk } : {}),
    };
  }

  if (!position) return holdB3('SELL prohibited: no open B3 position');
  if (!input.isDayTradeCloseOnly) {
    const pnlPct = (price - position.entryPrice) / position.entryPrice;
    if (typeof input.sellNoiseBandPct === 'number' && input.sellNoiseBandPct > 0) {
      if (Math.abs(pnlPct) < input.sellNoiseBandPct) {
        return holdB3(`SELL rejected: PnL ${(pnlPct * 100).toFixed(2)}% is within noise band ±${(input.sellNoiseBandPct * 100).toFixed(2)}%`);
      }
    }
    // Proteção contra venda precipitada por pânico da IA:
    // Se a posição estiver em prejuízo (pnlPct < 0), uma saída discricionária só é
    // autorizada se o preço tiver atingido o Stop Loss Efetivo (que já é disparado mecanicamente
    // nas regras anteriores) ou se for fim de pregão. Evita que a IA saia no fundo por medo.
    if (pnlPct < 0 && effectiveStopLossPct !== undefined && effectiveStopLossPct > 0) {
      const unrealizedLossPct = (position.entryPrice - price) / position.entryPrice;
      if (unrealizedLossPct < effectiveStopLossPct - 1e-6) {
        return holdB3(
          `SELL rejected: Discretionary panic exit with negative PnL ${(pnlPct * 100).toFixed(2)}% blocked. Position is above effective stop loss (-${(effectiveStopLossPct * 100).toFixed(2)}%). Hold to avoid premature loss.`,
        );
      }
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
