import { roundStepDown } from './rounding.js';

/**
 * Custos operacionais da B3 compartilhados entre o broker (`@bolinha/exchange`) e o
 * dimensionamento de posição do motor de risco (`@bolinha/risk-engine`).
 *
 * Este módulo é a ÚNICA fonte de verdade: o broker cobra exatamente
 * `b3ExecutionPrice()` (slippage) + `b3Fee()` (emolumentos/liquidação) e o motor de
 * risco reserva esse mesmo custo (acrescido de um headroom configurável) antes de
 * aprovar um BUY. Assim as duas pontas não podem divergir e gerar aprovação de risco
 * seguida de `Insufficient funds` no broker.
 *
 * Vive em `@bolinha/core` porque tanto `@bolinha/exchange` quanto
 * `@bolinha/risk-engine` dependem de `core`; importar o adaptador de execução dentro
 * do motor de risco inverteria a direção das camadas (risco é puro, broker é I/O) e
 * importar `risk-engine` de `exchange` criaria ciclo.
 */

/**
 * Emolumentos + taxa de liquidação da B3 (~0,0300% do volume financeiro)
 * para day trade em ações no mercado à vista.
 */
export const B3_DAY_TRADE_FEE_RATE = 0.0003;

/** Slippage de execução do broker paper (0,05%): compras pagam acima, vendas abaixo. */
export const B3_PAPER_SLIPPAGE_PCT = 0.0005;

/**
 * Notional mínimo aceito pela B3 (R$ 1,00). Fonte única usada por `getB3SymbolRules`
 * (`@bolinha/exchange`) e pelo cálculo de capacidade do prompt (`@bolinha/ai`), para
 * que a quantidade anunciada nunca seja menor/maior que a aprovada pelo motor.
 */
export const B3_MIN_NOTIONAL_BRL = 1.0;

export interface B3CostModel {
  /** Slippage percentual aplicado sobre o preço de mercado (assinado por lado). */
  slippagePct: number;
  /** Emolumentos/liquidação aplicados sobre o volume financeiro bruto. */
  feeRate: number;
}

export const defaultB3CostModel: B3CostModel = Object.freeze({
  slippagePct: B3_PAPER_SLIPPAGE_PCT,
  feeRate: B3_DAY_TRADE_FEE_RATE,
});

/**
 * Alíquota padrão de Imposto de Renda para operações de Day Trade em ações na B3 (20% sobre o lucro líquido).
 */
export const B3_DAY_TRADE_TAX_RATE = 0.20;

export interface B3NetPnlResult {
  /** Preço de execução estimado de saída (após slippage). */
  exitExecutionPrice: number;
  /** Volume bruto de saída. */
  grossExitBrl: number;
  /** Emolumentos + taxa de liquidação da saída. */
  exitFeeBrl: number;
  /** Valor líquido recebido da venda. */
  netReceivedBrl: number;
  /** Custo proporcional de entrada da posição vendida. */
  costOfSoldBrl: number;
  /** PnL líquido antes do Imposto de Renda. */
  netPnlBeforeTaxBrl: number;
  /** Provisão de IR de Day Trade (20% sobre o lucro líquido se positivo, 0 se prejuízo). */
  taxBrl: number;
  /** PnL final após deduzir custos operacionais e IR. */
  finalPnlBrl: number;
  /** Rentabilidade líquida real sobre o capital alocado na entrada (%). */
  netReturnPct: number;
}

/**
 * Calcula o PnL líquido real de uma posição vendida a determinado preço de mercado,
 * deduzindo slippage de saída, emolumentos B3 e alíquota de Imposto de Renda sobre o lucro.
 */
export const calculateB3NetPnl = (
  entryCostBrl: number,
  quantity: number,
  marketPrice: number,
  costModel: B3CostModel = defaultB3CostModel,
  taxRate: number = B3_DAY_TRADE_TAX_RATE,
): B3NetPnlResult => {
  const exitExecutionPrice = b3ExecutionPrice(marketPrice, -costModel.slippagePct);
  const grossExitBrl = Number((exitExecutionPrice * quantity).toFixed(2));
  const exitFeeBrl = b3Fee(grossExitBrl, costModel.feeRate);
  const netReceivedBrl = Number((grossExitBrl - exitFeeBrl).toFixed(2));
  const netPnlBeforeTaxBrl = Number((netReceivedBrl - entryCostBrl).toFixed(2));
  const taxBrl = netPnlBeforeTaxBrl > 0 ? Number((netPnlBeforeTaxBrl * taxRate).toFixed(2)) : 0;
  const finalPnlBrl = Number((netPnlBeforeTaxBrl - taxBrl).toFixed(2));
  const netReturnPct = entryCostBrl > 0 ? finalPnlBrl / entryCostBrl : 0;

  return {
    exitExecutionPrice,
    grossExitBrl,
    exitFeeBrl,
    netReceivedBrl,
    costOfSoldBrl: entryCostBrl,
    netPnlBeforeTaxBrl,
    taxBrl,
    finalPnlBrl,
    netReturnPct,
  };
};

/**
 * Calcula o preço de mercado mínimo necessário na venda para atingir determinado
 * percentual de ganho líquido desejado (`targetNetReturnPct`), cobrindo:
 * 1. Custo total de entrada (preço com slippage + emolumentos de compra);
 * 2. Custo total de saída (slippage de venda + emolumentos de venda);
 * 3. Provisão de Imposto de Renda (20% sobre o lucro líquido).
 *
 * Fórmula analítica:
 * NetProfit = (NetReceived - EntryCost) * (1 - TaxRate)
 * targetNetProfit = EntryCost * targetNetReturnPct
 * NetReceived = EntryCost + targetNetProfit / (1 - TaxRate)
 * Como NetReceived = GrossExit - Fee = P_exit_exec * Q * (1 - FeeRate)
 * E P_exit_exec = P_market * (1 - Slippage)
 * => P_market = NetReceived / (Q * (1 - Slippage) * (1 - FeeRate))
 */
export const b3RequiredPriceForNetTarget = (
  entryPrice: number,
  targetNetReturnPct: number,
  costModel: B3CostModel = defaultB3CostModel,
  taxRate: number = B3_DAY_TRADE_TAX_RATE,
): number => {
  if (entryPrice <= 0 || targetNetReturnPct <= 0) return entryPrice;

  // Custo unitário de entrada com slippage e emolumentos
  const buyExecPrice = b3ExecutionPrice(entryPrice, costModel.slippagePct);
  const unitBuyCost = buyExecPrice * (1 + costModel.feeRate);

  // Valor líquido necessário que a venda deve gerar por ação
  const requiredNetProfitPerShare = unitBuyCost * targetNetReturnPct;
  const taxableFactor = taxRate < 1 ? (1 - taxRate) : 1;
  const requiredNetReceivedPerShare = unitBuyCost + (requiredNetProfitPerShare / taxableFactor);

  // Fator de desconto na venda (slippage e emolumentos de saída)
  const sellExecFactor = (1 - costModel.slippagePct);
  const sellNetFactor = sellExecFactor * (1 - costModel.feeRate);

  const rawMarketPrice = requiredNetReceivedPerShare / sellNetFactor;
  // Arredonda para 2 casas decimais para cima (conservador para garantir que a ordem de venda cubra a meta)
  return Number((Math.ceil(rawMarketPrice * 100) / 100).toFixed(2));
};

/**
 * Preço de execução com a mesma disciplina de arredondamento do broker (2 casas).
 * `slippagePct` negativo reproduz o preço de venda (abaixo do mercado).
 */
export const b3ExecutionPrice = (price: number, slippagePct: number = B3_PAPER_SLIPPAGE_PCT): number =>
  Number((price * (1 + slippagePct)).toFixed(2));

/** Emolumentos/liquidação com a mesma disciplina de arredondamento do broker (4 casas). */
export const b3Fee = (grossBrl: number, feeRate: number = B3_DAY_TRADE_FEE_RATE): number =>
  Number((grossBrl * feeRate).toFixed(4));

/**
 * Headroom ADICIONAL (sobre o custo real já conhecido) que o motor de risco reserva
 * antes de aprovar um BUY. Default seguro de 0,10%: o arredondamento de preço de
 * execução para 2 casas (que pode subir ~0,005/ação) e de emolumentos para 4 casas
 * podem elevar o custo real em relação à estimativa por unidade, especialmente em
 * bancas pequenas. Um buffer maior é sempre fail-closed (apenas reduz a quantidade).
 */
export const B3_DEFAULT_BUY_COST_BUFFER_PCT = 0.001;

/** Teto do headroom (5%): acima disso a banca quase nunca consegue comprar nada. */
export const B3_MAX_BUY_COST_BUFFER_PCT = 0.05;

/**
 * Resolve o headroom de custo de forma fail-closed: mínimo 0 (nunca negativo, o que
 * aprovaria ordens que o broker rejeita) e no máximo `B3_MAX_BUY_COST_BUFFER_PCT`.
 * Valores ausentes/inválidos caem no default seguro em vez de derrubar o startup.
 */
export const resolveBuyCostBufferPct = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return B3_DEFAULT_BUY_COST_BUFFER_PCT;
  return Math.min(parsed, B3_MAX_BUY_COST_BUFFER_PCT);
};

export interface B3BuyCostEstimate {
  /** Preço de execução do BUY (mercado + slippage, 2 casas). */
  executionPrice: number;
  /** Volume financeiro bruto (execução * quantidade, 2 casas). */
  grossBrl: number;
  /** Emolumentos + liquidação (4 casas). */
  commissionBrl: number;
  /** Débito total em caixa do BUY: bruto + emolumentos. */
  totalBrl: number;
}

/**
 * Custo total que o broker debita do caixa em um BUY. Usado pelo motor de risco para
 * dimensionar a posição e pelo broker para validar/executar a ordem — mesma fórmula.
 */
export const estimateB3BuyCost = (
  price: number,
  quantity: number,
  model: B3CostModel = defaultB3CostModel,
): B3BuyCostEstimate => {
  const executionPrice = b3ExecutionPrice(price, model.slippagePct);
  const grossBrl = Number((executionPrice * quantity).toFixed(2));
  const commissionBrl = b3Fee(grossBrl, model.feeRate);
  return {
    executionPrice,
    grossBrl,
    commissionBrl,
    totalBrl: Number((grossBrl + commissionBrl).toFixed(4)),
  };
};

export interface B3BuyCapacityInput {
  /** Caixa livre que o BUY pode consumir (o broker debita notional + emolumentos). */
  cashBrl: number;
  /** Preço de mercado da ação (antes do slippage do broker). */
  price: number;
  /** Incremento de lote aceito pela B3 (`SymbolRules.stepSize`). */
  stepSize: number;
  /** Lote mínimo (`SymbolRules.minQty`). Default 1. */
  minQty?: number;
  /** Notional mínimo (`SymbolRules.minNotional`). Default 0 (sem piso adicional). */
  minNotional?: number;
  /** Modelo de custos do broker (slippage + emolumentos). */
  costModel?: B3CostModel;
  /** Headroom extra reservado; default `resolveBuyCostBufferPct` (fail-closed). */
  buyCostBufferPct?: number;
}

/**
 * Maior quantidade de ações que um BUY realmente pode consumir do caixa **incluindo
 * slippage + emolumentos** no preço de execução — a mesma conta que `applyB3Risk`
 * faz para aprovar a ordem e que `B3PaperBroker` faz para debitar o caixa.
 *
 * Regras (todas fail-closed, nunca lançam):
 * - Arredonda sempre PARA BAIXO no `stepSize`.
 * - O custo reservado (`estimateB3BuyCost * (1 + buffer)`) nunca excede o caixa.
 * - Retorna 0 para entradas inválidas (não finitas, preço/caixa/step <= 0), quando
 *   nem um lote cabe no caixa ou quando a quantidade fica abaixo de `minQty`/`minNotional`.
 *   Jamais retorna valor negativo, NaN ou Infinity.
 *
 * Vive em `@bolinha/core` porque prompt (`@bolinha/ai`), motor de risco e broker
 * precisam da MESMA capacidade: um prompt que anuncia quantidade maior é rebaixado
 * (ou rejeitado) silenciosamente logo depois.
 */
export const maxAffordableB3BuyQuantity = ({
  cashBrl,
  price,
  stepSize,
  minQty = 1,
  minNotional = 0,
  costModel = defaultB3CostModel,
  buyCostBufferPct,
}: B3BuyCapacityInput): number => {
  if (!Number.isFinite(cashBrl) || cashBrl <= 0) return 0;
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(stepSize) || stepSize <= 0) return 0;
  if (!Number.isFinite(minQty) || minQty < 0) return 0;
  if (!Number.isFinite(minNotional) || minNotional < 0) return 0;
  const bufferPct = resolveBuyCostBufferPct(buyCostBufferPct);
  /** Custo total debitado do caixa, inflado pelo headroom (idêntico ao motor de risco). */
  const reservedCost = (quantity: number) =>
    estimateB3BuyCost(price, quantity, costModel).totalBrl * (1 + bufferPct);
  const unitReservedCost = reservedCost(1);
  if (!Number.isFinite(unitReservedCost) || unitReservedCost <= 0) return 0;
  /** Arredonda PARA BAIXO no stepSize até o custo reservado caber no caixa. */
  const reduceToAffordable = (candidate: number): number => {
    let qty = candidate;
    for (let guard = 0; guard < 4 && qty >= minQty && reservedCost(qty) > cashBrl; guard++)
      qty = Number((qty - stepSize).toFixed(10));
    return qty;
  };

  // Mesma sequência de `applyB3Risk`: teto pelo notional primeiro; se o custo real
  // (execução + emolumentos + headroom) estourar o caixa, cai para o teto por caixa.
  let quantity = roundStepDown(cashBrl / price, stepSize);
  if (!Number.isFinite(quantity)) return 0;
  if (quantity > 0 && reservedCost(quantity) > cashBrl) {
    const cashLimitedQty = roundStepDown(cashBrl / unitReservedCost, stepSize);
    quantity = Number.isFinite(cashLimitedQty) ? reduceToAffordable(Math.min(quantity, cashLimitedQty)) : 0;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (quantity < minQty) return 0;
  // Mesmos limites do motor de risco: `quantity * price` bruto para o piso de lote e
  // notional arredondado a 2 casas para o teto de caixa.
  if (quantity * price < minNotional) return 0;
  if (Number((quantity * price).toFixed(2)) > cashBrl) return 0;
  if (reservedCost(quantity) > cashBrl) return 0;
  return quantity;
};
