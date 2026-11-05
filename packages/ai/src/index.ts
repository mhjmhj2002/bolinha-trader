import { z } from 'zod';
import {
  B3_MIN_NOTIONAL_BRL,
  b3RequiredPriceForNetTarget,
  calculateB3NetPnl,
  config,
  entryTimeframes,
  maxAffordableB3BuyQuantity,
  resolveBuyCostBufferPct,
} from '@bolinha/core';
import type { Action, B3CostModel, EntryTimeframe } from '@bolinha/core';
import type { MarketSnapshot, PreAnalysisReport } from '@bolinha/market-data';

/**
 * Canonical wire keys requested from the model by `buildB3Prompt` plus the
 * common aliases models actually emit (English keys, `%` suffixes, etc.).
 * Aliases are resolved BEFORE schema validation so a reasonable answer is not
 * silently downgraded to HOLD.
 */
type WireKey = 'acao' | 'valor_usdt' | 'confianca' | 'motivo';

const WIRE_KEY_ALIASES: Record<WireKey, readonly string[]> = {
  acao: ['acao', 'action', 'operacao', 'side'],
  valor_usdt: ['valor_usdt', 'amount_usdt', 'value_usdt', 'valor', 'amount', 'value', 'valor_brl', 'amount_brl'],
  confianca: ['confianca', 'confiança', 'confidence', 'certeza'],
  motivo: ['motivo', 'reason', 'justificativa', 'rationale'],
};

export interface AiDecision {
  action: Action;
  amountUsdt: number;
  confidence: number;
  reason: string;
  rawResponse: string | null;
  /**
   * Machine-readable discriminator. `reason` is model-authored free text, so the
   * retry/fallback decision must NEVER be made by inspecting it (a legit motivo
   * may start with "Invalid..."). Only this flag marks an unusable payload.
   */
  parseFailed: boolean;
}
export interface AiUsage {
  modelRequested: string;
  modelReturned: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  error: string | null;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
  retriesUsed?: number;
  rateLimit429Hit?: boolean;
}
const actionMap: Record<string, Action> = {
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
  COMPRAR: 'BUY',
  COMPRA: 'BUY',
  VENDER: 'SELL',
  VENDA: 'SELL',
  WAIT: 'HOLD',
  ESPERAR: 'HOLD',
  AGUARDAR: 'HOLD',
};

/** Reason used when the model omits `motivo`/`reason` altogether. */
export const MISSING_REASON_FALLBACK = 'motivo nao informado pelo modelo';

const normaliseKey = (key: string): string => key.trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Maps an arbitrary payload to the canonical keys. Missing keys stay `undefined`
 * (they are handled/normalised later) and unknown keys are ignored.
 */
export function normaliseWirePayload(payload: unknown): Record<WireKey, unknown> {
  const source =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const indexed = new Map<string, unknown>();
  for (const [rawKey, value] of Object.entries(source)) indexed.set(normaliseKey(rawKey), value);
  const normalised = {} as Record<WireKey, unknown>;
  for (const key of Object.keys(WIRE_KEY_ALIASES) as WireKey[]) {
    const aliases = WIRE_KEY_ALIASES[key].map(normaliseKey);
    normalised[key] = aliases.map((alias) => indexed.get(alias)).find((value) => value !== undefined);
  }
  return normalised;
}

/**
 * Normalisation table for confidence:
 * - `0.85` (fraction inside 0..1)  -> `0.85`
 * - `1`    (upper bound of fraction) -> `1`   (never `0.01`)
 * - `0`    (zero confidence)         -> `0`
 * - `85`   (percentage)              -> `0.85`
 * - `100`  (percentage full)         -> `1`
 * - `'85%'` / `'0,85'` (string)      -> `0.85`
 * Values outside 0..100 (or negative/non-finite) return `null` so the caller
 * can fail closed instead of inventing a confidence.
 */
export function normaliseConfidence(raw: unknown): number | null {
  const numeric =
    typeof raw === 'string' ? Number(raw.trim().replace('%', '').replace(',', '.')) : (raw as number | undefined);
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0) return null;
  const fraction = numeric <= 1 ? numeric : numeric / 100;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  return fraction;
}

/** Same idea for money: accepts `12`, `'12,50'`, `'R$ 12.50'`; rejects negatives. */
export function normaliseAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 0;
  const numeric =
    typeof raw === 'string'
      ? Number(
          raw
            .replace(/[R$\s]/g, '')
            .replace('%', '')
            .replace(',', '.'),
        )
      : (raw as number);
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

const wireSchema = z.object({
  acao: z.string().trim().min(1).max(64),
  motivo: z.string().trim().min(1).max(2000),
});

const extractJsonObject = (content: string): string => content.match(/\{[\s\S]*\}/)?.[0] ?? content;

const failedDecision = (reason: string, rawResponse: string | null): AiDecision => ({
  action: 'HOLD',
  amountUsdt: 0,
  confidence: 0,
  reason,
  rawResponse,
  parseFailed: true,
});

export function parseAiContent(content: string | null | undefined): AiDecision {
  if (!content || !content.trim()) return failedDecision('AI returned empty content', content ?? null);

  let decoded: unknown;
  try {
    decoded = JSON.parse(extractJsonObject(content));
  } catch {
    return failedDecision('Invalid AI JSON', content);
  }

  const wire = normaliseWirePayload(decoded);
  const rawReason = wire.motivo;
  const motivo =
    typeof rawReason === 'string' && rawReason.trim() ? rawReason : rawReason === undefined ? MISSING_REASON_FALLBACK : rawReason;
  const parsed = wireSchema.safeParse({ acao: wire.acao, motivo });
  if (!parsed.success) return failedDecision('Invalid AI response schema', content);

  const action = actionMap[parsed.data.acao.toUpperCase()];
  if (!action) return failedDecision(`Invalid AI action: ${parsed.data.acao}`, content);

  const amountUsdt = normaliseAmount(wire.valor_usdt);
  if (amountUsdt === null) return failedDecision('Invalid AI amount', content);

  const confidence = wire.confianca === undefined || wire.confianca === null ? 0 : normaliseConfidence(wire.confianca);
  if (confidence === null) return failedDecision('Invalid AI confidence', content);

  return { action, amountUsdt, confidence, reason: parsed.data.motivo, rawResponse: content, parseFailed: false };
}

/**
 * Inputs of the deterministic entry (BUY) confluence gate implemented in
 * `@bolinha/market-data` (`evaluateEntryConfluence`). The prompt description is
 * generated from this shape so the model cannot be told a rule the engine does
 * not enforce (TASK-17).
 */
export interface EntryGateDescriptionOptions {
  /** Timeframes evaluated by the gate (ENTRY_TIMEFRAMES). */
  timeframes?: readonly EntryTimeframe[] | null;
  /** RSI14 level at or above which a timeframe blocks the BUY (ENTRY_RSI_OVERBOUGHT). */
  rsiOverboughtThreshold?: number | null;
  /** How many timeframes must be confluent (ENTRY_MIN_CONFLUENT_TIMEFRAMES). */
  minConfluentTimeframes?: number | null;
}

export interface EntryGateRule {
  timeframes: EntryTimeframe[];
  rsiOverboughtThreshold: number;
  minConfluentTimeframes: number;
}

/**
 * Fallback used when the gate is called without `rsiOverboughtThreshold`.
 * Mirrors the `options.rsiOverboughtThreshold ?? 70` default in
 * `packages/market-data/src/index.ts`.
 */
export const DEFAULT_ENTRY_RSI_OVERBOUGHT_THRESHOLD = 70;

/**
 * Resolves the exact rule the deterministic gate applies. Defaults come from
 * the same validated config the worker feeds into the gate, so a non-default
 * ENTRY_TIMEFRAMES / ENTRY_RSI_OVERBOUGHT / ENTRY_MIN_CONFLUENT_TIMEFRAMES is
 * reflected in the prompt without duplicating literals.
 */
export function resolveEntryGateRule(overrides: EntryGateDescriptionOptions = {}): EntryGateRule {
  const timeframes =
    Array.isArray(overrides.timeframes) && overrides.timeframes.length
      ? [...overrides.timeframes]
      : config.ENTRY_TIMEFRAMES.length
        ? [...config.ENTRY_TIMEFRAMES]
        : [...entryTimeframes];
  const thresholdSource = overrides.rsiOverboughtThreshold ?? config.ENTRY_RSI_OVERBOUGHT;
  const threshold = Number.isFinite(thresholdSource) ? thresholdSource : DEFAULT_ENTRY_RSI_OVERBOUGHT_THRESHOLD;
  const minimumSource = overrides.minConfluentTimeframes ?? config.ENTRY_MIN_CONFLUENT_TIMEFRAMES;
  // Same clamp as the gate: `Math.min(timeframes.length, Math.max(1, Math.trunc(min)))`.
  const minimum = Number.isFinite(minimumSource)
    ? Math.min(timeframes.length, Math.max(1, Math.trunc(minimumSource)))
    : timeframes.length;
  return { timeframes, rsiOverboughtThreshold: threshold, minConfluentTimeframes: minimum };
}

/**
 * Single sentence describing the deterministic BUY gate. Used verbatim by the
 * prompt so the wording cannot drift from `evaluateEntryConfluence`.
 */
export function describeEntryConfluenceRule(overrides: EntryGateDescriptionOptions = {}): string {
  const rule = resolveEntryGateRule(overrides);
  const list = rule.timeframes.join(', ');
  const threshold = String(rule.rsiOverboughtThreshold);
  const scopeDescription =
    rule.minConfluentTimeframes === rule.timeframes.length
      ? `em TODOS os timeframes de entrada configurados (${list})`
      : `em pelo menos ${rule.minConfluentTimeframes} dos timeframes de entrada configurados (${list})`;
  return `EMA9 acima da EMA21 E RSI14 abaixo de ${threshold} (não sobrecomprado) ${scopeDescription}; o limite de RSI14 se aplica a cada um desses timeframes. Volume não é verificado pelo motor de risco, portanto não condicione o BUY a volume. Confluência exigida: ${rule.minConfluentTimeframes} de ${rule.timeframes.length} timeframe(s), e qualquer timeframe sem dados válidos invalida a entrada.`;
}

export interface BuyCapacityOptions {
  /**
   * Headroom sobre o custo real (slippage + emolumentos) reservado no cálculo da
   * capacidade de compra. Default: `config.RISK_BUY_COST_BUFFER_PCT`, exatamente o
   * mesmo valor que o worker passa para `applyB3Risk` — assim o prompt nunca anuncia
   * uma quantidade que o motor de risco irá reduzir depois.
   */
  buyCostBufferPct?: number;
  /** Modelo de custos do broker. Default: o mesmo usado por `B3PaperBroker`. */
  costModel?: B3CostModel;
  /** Incremento de lote da B3 (`SymbolRules.stepSize`). Default 1. */
  stepSize?: number;
  /** Lote mínimo (`SymbolRules.minQty`). Default 1. */
  minQty?: number;
  /** Notional mínimo (`SymbolRules.minNotional`). Default o mínimo da B3. */
  minNotional?: number;
  /**
   * Teto de alocação por posição (fração do patrimônio), exatamente o mesmo
   * `maxPositionPercent` que o worker passa para `applyB3Risk`. Sem ele o prompt
   * calcularia a capacidade apenas pelo caixa e anunciaria uma quantidade maior do
   * que o motor aprova sempre que o teto for menor que 100%
   * (`budget = (caixa + posição) * pct / 100`). Default:
   * `config.MAX_POSITION_PERCENT` (100), que reproduz o comportamento anterior.
   */
  maxPositionPercent?: number;
  /** Distância percentual do trailing stop a partir da máxima (ex: 0.006 para 0.6%). */
  trailingStopPct?: number;
  /** Percentual máximo de proteção do stop móvel (ex: 0.015 para +1.5%). */
  trailingStopCapPct?: number;
  /** Valor do ATR (Average True Range) do ativo */
  atr?: number | null;
  /** Multiplicador do ATR (padrão 2.0) */
  atrMultiplier?: number;
  /** Modo de Stop Loss: 'STATIC' ou 'ATR' */
  stopLossMode?: 'STATIC' | 'ATR';
  /** Gatilho de Take Profit Total Mecânico (ex: 0.008 para +0.8%) */
  fullTakeProfitPct?: number;
  /** Gatilho de Take Profit Parcial (ex: 0.006 para +0.6%) */
  partialTakeProfitTriggerPct?: number;
  /** Percentual de lucro garantido no Breakeven (ex: 0.002 para +0.2%) */
  breakevenProfitLockPct?: number;
  /** Modo de cálculo dos alvos de lucro ('NET' ou 'GROSS'). */
  profitTargetMode?: 'NET' | 'GROSS';
  /** Alíquota de imposto de renda sobre o ganho de Day Trade (ex: 0.20 = 20%). */
  dayTradeTaxRate?: number;
  /** Relatório da pré-análise dos robôs quantitativos determinísticos */
  preAnalysis?: PreAnalysisReport | null;
}

export function buildB3Prompt(
  snapshot: MarketSnapshot,
  account: { initialBankBrl: number; cashBrl: number; realizedPnlBrl?: number },
  position: { ticker: string; quantity: number; entryPrice: number; costBrl: number; highestPrice?: number } | null,
  currentPrice: number,
  stopLossPct = 0.012, // Default calibrado em 1.2% para tolerar ruído normal de 1-2 ciclos de 3 minutos
  breakevenTriggerPct = 0.008, // +0.8% de valorização ativa proteção no Breakeven
  entryGate: EntryGateDescriptionOptions = {},
  capacity: BuyCapacityOptions = {},
): string {
  // Capacidade COST-AWARE (fonte única em @bolinha/core): é a mesma quantidade que
  // `applyB3Risk` aprova e que `B3PaperBroker` consegue preencher. Substitui o antigo
  // `Math.floor(caixa/preço)`, que ignorava slippage + emolumentos e anunciava 10
  // ações onde o motor aprovava 9 (BUY rebaixado/rejeitado logo depois).
  //
  // O caixa elegível reproduz o teto de alocação de `applyB3Risk`
  // (`budget = (caixa + custo da posição) * pct / 100`, limitado ao caixa livre):
  // com `maxPositionPercent` < 100 o motor aprova menos que o caixa permitiria, e o
  // prompt precisa anunciar esse mesmo número.
  const requestedPercent = capacity.maxPositionPercent;
  const maxPositionPercent =
    typeof requestedPercent === 'number' && Number.isFinite(requestedPercent)
      ? requestedPercent
      : config.MAX_POSITION_PERCENT;
  const heldBrl = position ? position.costBrl : 0;
  const budgetBrl = ((account.cashBrl + heldBrl) * maxPositionPercent) / 100;
  const eligibleCashBrl = Math.min(account.cashBrl, Math.max(0, budgetBrl - heldBrl));
  const maxSharesCanBuy = maxAffordableB3BuyQuantity({
    cashBrl: eligibleCashBrl,
    price: currentPrice,
    stepSize: capacity.stepSize ?? 1,
    minQty: capacity.minQty ?? 1,
    minNotional: capacity.minNotional ?? B3_MIN_NOTIONAL_BRL,
    costModel: capacity.costModel,
    // Uma única leitura do mesmo knob de configuração que o worker usa no motor de risco.
    buyCostBufferPct: resolveBuyCostBufferPct(capacity.buyCostBufferPct ?? config.RISK_BUY_COST_BUFFER_PCT),
  });
  const hasBuyCapacity = maxSharesCanBuy > 0;
  // Notional (quantidade * preço, 2 casas) — nunca excede o caixa, pois a capacidade
  // já reserva os custos operacionais.
  const maxBuyAmountBrl = (maxSharesCanBuy * currentPrice).toFixed(2);
  const permitted = position
    ? (hasBuyCapacity ? 'BUY (aumentar posição), SELL (parcial ou total) ou HOLD' : 'SELL (parcial ou total) ou HOLD (caixa insuficiente para BUY)')
    : (hasBuyCapacity ? 'BUY ou HOLD' : 'HOLD (caixa insuficiente para compra de 1 ação)');
  const availableCashBrl = Number(account.cashBrl).toFixed(2);
  const initialBankFormatted = Number(account.initialBankBrl).toFixed(2);
  const capacitySummary = hasBuyCapacity
    ? `capacidade máxima de compra atual: ${maxSharesCanBuy} ação(ões) (máx R$ ${maxBuyAmountBrl}, já incluindo slippage e emolumentos da B3)`
    : 'capacidade máxima de compra atual: sem capacidade de compra no momento (o caixa disponível não cobre 1 ação somada aos custos operacionais)';
  const cashCapacityDetail = hasBuyCapacity
    ? `(permite comprar até ${maxSharesCanBuy} ação(ões) já com os custos operacionais descontados)`
    : '(não permite comprar nenhuma ação neste ciclo: o caixa não cobre 1 ação somada a slippage e emolumentos)';
  const buySizingRule = hasBuyCapacity
    ? `  * No BUY: informe no máximo R$ ${maxBuyAmountBrl} (de 1 ação até ${maxSharesCanBuy} ações). Ordens acima do caixa disponível serão REJEITADAS pelo motor de risco.`
    : '  * No BUY: NÃO há capacidade de compra neste ciclo (nem 1 ação cabe no caixa com os custos operacionais); um BUY será rebaixado para HOLD pelo motor de risco. Escolha HOLD ou SELL.';
  const sizingConvictionRule = hasBuyCapacity
    ? `- Varie o tamanho das ordens conforme a convicção: sinal moderado = 1 ação; sinal forte com alta confluência = até ${maxSharesCanBuy} ações. Entre escalonado e saia escalonado.`
    : '- Sem capacidade de compra neste ciclo não há tamanho de ordem a variar: mantenha HOLD (ou SELL, se houver posição aberta).';

  let positionInfo = 'nenhuma';
  let pnlInfo = '';
  let riskTargetsInfo = '';
  if (position) {
    const unrealizedPnlBrl = (currentPrice - position.entryPrice) * position.quantity;
    const unrealizedPnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const highest = Math.max(position.highestPrice ?? position.entryPrice, currentPrice);
    const maxGainPct = ((highest - position.entryPrice) / position.entryPrice) * 100;
    const isBreakevenActive = maxGainPct >= breakevenTriggerPct * 100;

    const isAtrMode = capacity.stopLossMode === 'ATR';
    const rawAtr = capacity.atr ?? snapshot?.atr ?? snapshot?.intervals?.['5m']?.atr ?? snapshot?.intervals?.['1m']?.atr;
    const hasValidAtr = typeof rawAtr === 'number' && Number.isFinite(rawAtr) && rawAtr > 0;
    let effectiveStopLossPct = stopLossPct;
    let atrStopDistanceBrl: number | null = null;

    if (isAtrMode && hasValidAtr && position.entryPrice > 0) {
      const multiplier = typeof capacity.atrMultiplier === 'number' && capacity.atrMultiplier > 0 ? capacity.atrMultiplier : 2.0;
      atrStopDistanceBrl = Number((rawAtr * multiplier).toFixed(4));
      const calculatedPct = atrStopDistanceBrl / position.entryPrice;
      const maxCap = config.MAX_STOP_LOSS_PCT ?? 0.018;
      effectiveStopLossPct = Math.min(calculatedPct, maxCap);
    }

    const isNetMode = capacity.profitTargetMode === 'NET';
    const taxRate = capacity.dayTradeTaxRate ?? config.DAY_TRADE_TAX_RATE;
    const costModel = capacity.costModel;

    const stopLossMultiplier = 1 - effectiveStopLossPct;
    const initialStopLossPrice = Number((position.entryPrice * stopLossMultiplier).toFixed(2));

    const lockPct = typeof capacity.breakevenProfitLockPct === 'number' && capacity.breakevenProfitLockPct > 0
      ? capacity.breakevenProfitLockPct
      : 0.0006;
    const breakevenFloorPrice = isNetMode
      ? b3RequiredPriceForNetTarget(position.entryPrice, lockPct, costModel, taxRate)
      : Number((position.entryPrice * (1 + lockPct)).toFixed(2));

    const trailingStopPct = capacity.trailingStopPct;
    const trailingStopCapPct = capacity.trailingStopCapPct;

    let trailingFloorPrice = breakevenFloorPrice;
    let isTrailingCapHit = false;
    let capPrice = 0;

    if (isBreakevenActive && typeof trailingStopPct === 'number' && trailingStopPct > 0) {
      let trailingFloor = highest * (1 - trailingStopPct);
      if (typeof trailingStopCapPct === 'number' && trailingStopCapPct > 0) {
        capPrice = Number((position.entryPrice * (1 + trailingStopCapPct)).toFixed(2));
        if (trailingFloor >= capPrice) {
          isTrailingCapHit = true;
          trailingFloor = capPrice;
        }
      }
      trailingFloorPrice = Math.max(breakevenFloorPrice, Number(trailingFloor.toFixed(2)));
    }

    const effectiveStopPrice = isBreakevenActive ? trailingFloorPrice : initialStopLossPrice;
    const stopLossFormatted = (effectiveStopLossPct * 100).toFixed(1).replace('.', ',');

    const netResult = calculateB3NetPnl(position.costBrl, position.quantity, currentPrice, costModel, taxRate);
    const netPnlPct = netResult.netReturnPct * 100;

    const partialTargetPct = capacity.partialTakeProfitTriggerPct ?? 0.006;
    const fullTargetPct = capacity.fullTakeProfitPct ?? 0.015;

    const takeProfitPartialPrice = isNetMode
      ? b3RequiredPriceForNetTarget(position.entryPrice, partialTargetPct, costModel, taxRate)
      : Number((position.entryPrice * (1 + partialTargetPct)).toFixed(2));
    const takeProfitFinalPrice = isNetMode
      ? b3RequiredPriceForNetTarget(position.entryPrice, fullTargetPct, costModel, taxRate)
      : Number((position.entryPrice * (1 + fullTargetPct)).toFixed(2));

    positionInfo = `${position.quantity} ações de ${position.ticker}, preço de entrada R$ ${position.entryPrice.toFixed(2)}, máxima atingida R$ ${highest.toFixed(2)} (+${maxGainPct.toFixed(2)}%), custo total R$ ${position.costBrl.toFixed(2)}`;
    pnlInfo = `PnL não realizado: bruto ${unrealizedPnlPct >= 0 ? '+' : ''}${unrealizedPnlPct.toFixed(2)}% (R$ ${unrealizedPnlBrl.toFixed(2)}) | líquido real estimado pós-taxas e IR 20%: ${netPnlPct >= 0 ? '+' : ''}${netPnlPct.toFixed(2)}% (R$ ${netResult.finalPnlBrl.toFixed(2)}).`;

    let trailingStatusText = '';
    if (isBreakevenActive) {
      if (isTrailingCapHit && typeof trailingStopCapPct === 'number') {
        trailingStatusText = `\n- PROTEÇÃO DE BREAKEVEN & TRAILING STOP ATIVOS: A posição já valorizou +${maxGainPct.toFixed(2)}% (>= +${(breakevenTriggerPct * 100).toFixed(1)}%). O Stop Móvel atingiu o Teto de Lucro Travado em R$ ${capPrice.toFixed(2)} (+${(trailingStopCapPct * 100).toFixed(1)}%), estacionando nesse piso para dar fôlego ao trade sem ser estopado precocemente por ruídos menores.`;
      } else if (effectiveStopPrice > breakevenFloorPrice) {
        trailingStatusText = `\n- PROTEÇÃO DE BREAKEVEN & TRAILING STOP ATIVOS: A posição já valorizou +${maxGainPct.toFixed(2)}% (>= +${(breakevenTriggerPct * 100).toFixed(1)}%). O Stop Móvel subiu para R$ ${effectiveStopPrice.toFixed(2)} para proteger os ganhos da máxima.`;
      } else {
        const lockFormatted = (lockPct * 100).toFixed(2);
        trailingStatusText = `\n- PROTEÇÃO DE BREAKEVEN ATIVA COM LUCRO TRAVADO: A posição já valorizou +${maxGainPct.toFixed(2)}% (>= +${(breakevenTriggerPct * 100).toFixed(1)}%). O Stop de Proteção foi elevado para R$ ${effectiveStopPrice.toFixed(2)} (garantindo lucro líquido de +${lockFormatted}%). É expressamente proibido deixar a posição devolver ganhos e virar prejuízo.`;
      }
    } else {
      const stopModeLabel = isAtrMode && hasValidAtr ? `Stop ATR (${(capacity.atrMultiplier ?? 2.0).toFixed(1)}x ATR)` : 'Stop Loss Inicial';
      trailingStatusText = `\n- ${stopModeLabel} (-${stopLossFormatted}%): R$ ${effectiveStopPrice.toFixed(2)}. Se o preço atual violar este nível, SELL obrigatório.`;
    }

    riskTargetsInfo = `\nMetas objetivas da posição aberta:${trailingStatusText}
- Stop Loss Efetivo: R$ ${effectiveStopPrice.toFixed(2)}. Se o preço atual estiver abaixo deste nível, é OBRIGATÓRIO emitir SELL para proteger o capital (proibido ficar em HOLD passivo). Se o preço atual for maior que R$ ${effectiveStopPrice.toFixed(2)}, o Stop Loss NÃO foi violado e é expressamente proibido alegar violação ou vender por medo.
- Take Profit Parcial (+${(partialTargetPct * 100).toFixed(1)}%${isNetMode ? ' líquido após taxas e IR' : ''}): R$ ${takeProfitPartialPrice.toFixed(2)}. Considere SELL parcial de pelo menos metade da posição para travar lucro.
- Take Profit Total Mecânico (+${(fullTargetPct * 100).toFixed(1)}%${isNetMode ? ' líquido após taxas e IR' : ''}): R$ ${takeProfitFinalPrice.toFixed(2)}. Nível de encerramento total da posição pelo motor de risco.`;
  }

  const effectiveAtr = capacity.atr ?? snapshot?.atr ?? snapshot?.intervals?.['5m']?.atr ?? snapshot?.intervals?.['1m']?.atr;
  const isAtrMode = capacity.stopLossMode === 'ATR';
  const hasAtr = typeof effectiveAtr === 'number' && Number.isFinite(effectiveAtr) && effectiveAtr > 0;
  let dynamicStopGuidelinePct = stopLossPct;
  let atrPromptInfo = '';

  if (hasAtr) {
    const mult = typeof capacity.atrMultiplier === 'number' && capacity.atrMultiplier > 0 ? capacity.atrMultiplier : 2.0;
    const stopDistance = Number((effectiveAtr * mult).toFixed(4));
    const stopDistancePct = currentPrice > 0 ? stopDistance / currentPrice : stopLossPct;
    const clampedStopPct = Math.min(stopDistancePct, config.MAX_STOP_LOSS_PCT ?? 0.018);
    if (isAtrMode) dynamicStopGuidelinePct = clampedStopPct;
    const atrStopPrice = (currentPrice * (1 - clampedStopPct)).toFixed(2);
    atrPromptInfo = `\nVolatilidade Real (ATR 14): R$ ${effectiveAtr.toFixed(4)} por ação. Stop ATR estimado (${mult.toFixed(1)}x ATR = R$ ${stopDistance.toFixed(2)}): ${(clampedStopPct * 100).toFixed(2)}% (gatilho de stop em ~R$ ${atrStopPrice}).`;
  }

  const stopLossGuideline = (dynamicStopGuidelinePct * 100).toFixed(1).replace('.', ',');
  const entryRule = describeEntryConfluenceRule(entryGate);

  let vwapPromptInfo = '';
  const snapshotVwap = snapshot?.vwap ?? snapshot?.intervals?.['1m']?.vwap;
  if (typeof snapshotVwap === 'number' && Number.isFinite(snapshotVwap)) {
    const distPct = ((currentPrice - snapshotVwap) / snapshotVwap) * 100;
    const sign = distPct >= 0 ? '+' : '';
    vwapPromptInfo = `\nVWAP Intradiária: R$ ${snapshotVwap.toFixed(2)} (Preço está a ${sign}${distPct.toFixed(2)}% da VWAP). A VWAP atua como suporte institucional de referência e filtro OBRIGATÓRIO de compra (BUY proibido se preço < VWAP).`;
  }

  let robotsPromptInfo = '';
  if (capacity.preAnalysis) {
    const pa = capacity.preAnalysis;
    const optionsText = pa.recommendedOptions.map((opt, i) =>
      `  ${i + 1}. [${opt.action}] Convicção Técnica: ${opt.score}% (${opt.votesCount} robôs a favor: ${opt.supportingRobots.join(', ')}). Risco: ${opt.suggestedRiskLevel}. Motivo: ${opt.primaryReason}`,
    ).join('\n');

    const robotsDetailText = pa.robots.map((r) =>
      `- ${r.robotName} [${r.category}]: Voto=${r.vote} (confiança ${(r.confidence * 100).toFixed(0)}%). Justificativa: ${r.rationale}`,
    ).join('\n');

    robotsPromptInfo = `\n\n=== PRÉ-ANÁLISE DE ROBÔS DETERMINÍSTICOS QUANTITATIVOS (SISTEMA DE APP DE MERCADO) ===
Um comitê de robôs matemáticos especializados pré-analisou as métricas técnicas e de risco e gerou a seguinte lista de opções pré-qualificadas para você:
${optionsText}

Detalhamento dos Robôs Analistas:
${robotsDetailText}
Consenso Geral dos Robôs: ${pa.consensusAction} (${pa.consensusScore}% de convicção).
========================================================================================`;
  }

  return `Você é o Decisor Final e Gerenciador de Risco especialista em Day Trade de Ações na B3.
Sua função NÃO É fazer uma análise do todo do zero: múltiplos robôs matemáticos especialistas já realizaram a pré-análise técnica e quantitativa do mercado e entregaram a lista de opções pré-qualificadas abaixo.
Sua missão é atuar como Comitê Executivo: escolher a decisão ideal a partir das opções pré-analisadas pelos robôs, validando se o contexto da banca, limites de perda e metas de posição são atendidos com total segurança.

Responda SOMENTE JSON: {"acao":"BUY|SELL|HOLD","valor_usdt":number,"confianca":0..1,"motivo":"..."} (onde "valor_usdt" representa o valor financeiro alocado em R$ BRL). A "confianca" deve ser uma fração entre 0 e 1 (ex.: 0.85) ou um percentual inteiro entre 0 e 100 (ex.: 85), nunca acima de 100.
Contexto financeiro B3: banca inicial R$ ${initialBankFormatted}; CAIXA DISPONÍVEL REAL R$ ${availableCashBrl}; ${capacitySummary}; posição atual: ${positionInfo}. ${pnlInfo}${riskTargetsInfo}
Ações permitidas agora: ${permitted}.
Preço atual da ação: R$ ${currentPrice.toFixed(2)}.${vwapPromptInfo}${atrPromptInfo}${robotsPromptInfo}

Regras de dimensionamento (banca pequena, a partir de R$ 100):
- Seu caixa livre para novas compras neste ciclo é EXATAMENTE R$ ${availableCashBrl} ${cashCapacityDetail}. NUNCA afirme que o caixa é R$ 0,00 se o caixa disponível informado for R$ ${availableCashBrl}.
- NUNCA emita BUY se o caixa disponível não cobrir 1 ação somada aos custos operacionais (slippage + emolumentos) — atualmente R$ ${currentPrice.toFixed(2)} de preço de mercado. Se a capacidade for 0 ações, escolha HOLD ou SELL.
- "valor_usdt" é o valor financeiro em R$ da ordem:
${buySizingRule}
  * No SELL: quanto vender agora em R$ (0 ou valor >= custo da posição encerra tudo; valores intermediários realizam lucro parcial).
${sizingConvictionRule}

Diretrizes de Trading (Relação Risco:Retorno mínima 2:1):
- SELEÇÃO A PARTIR DOS ROBÔS: Priorize a opção de maior convicção validada pelos robôs pré-analistas, a menos que as regras de capital e segurança impeçam.
- BUY: confluência de tendência. Alvo +1,0% a +2,5% com stop ~-1,0% a -${stopLossGuideline}%. Só escolha BUY se a opção de BUY foi pré-qualificada com confluência pelos robôs e houver caixa disponível. Pode somar à posição se a tese continuar válida.
- SELL: OBRIGATÓRIO vender (SELL) quando o Robô Gestor de Posição apontar Stop Loss atingido ou Take Profit. NÃO venda por medo ou proximidade: oscilações normais entre 0% e o Stop Loss Efetivo devem ser mantidas em HOLD. É TERMINANTEMENTE PROIBIDO emitir SELL discricionário com PnL negativo se o preço estiver acima do Stop Loss Efetivo (a venda prematura será sumariamente bloqueada pelo motor de risco como saída por pânico). Só venda antes do stop se o Robô Seguidor de Tendência confirmar reversão tripla (EMA9 abaixo da EMA21 em 1m, 5m e 15m).
- HOLD: é a ação PADRÃO de preservação caso não haja consenso forte ou se os robôs indicarem consolidação/aguardo.
- BUY (critério DETERMINÍSTICO aplicado pelo motor de risco): ${entryRule} BUY sem essa confluência é automaticamente rebaixado para HOLD. Na dúvida, HOLD.

Indicadores e Book da B3: ${JSON.stringify(snapshot)}`;
}

export interface OpenRouterRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class OpenRouterClient {
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;

  constructor(
    private key: string,
    private models: string[],
    private fetchFn: typeof fetch = fetch,
    private timeoutMs: number = 30_000,
    retryOptions?: OpenRouterRetryOptions,
  ) {
    this.maxRetries = retryOptions?.maxRetries ?? config.AI_RETRY_MAX_ATTEMPTS ?? 2;
    this.baseDelayMs = retryOptions?.baseDelayMs ?? config.AI_RETRY_BASE_DELAY_MS ?? 1_000;
    this.maxDelayMs = retryOptions?.maxDelayMs ?? config.AI_RETRY_MAX_DELAY_MS ?? 10_000;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateBackoff(attempt: number, retryAfterHeader?: string | null): number {
    if (retryAfterHeader) {
      const parsedSeconds = Number(retryAfterHeader);
      if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
        return Math.min(parsedSeconds * 1000, this.maxDelayMs);
      }
      const parsedDate = Date.parse(retryAfterHeader);
      if (!Number.isNaN(parsedDate)) {
        const diff = parsedDate - Date.now();
        if (diff > 0) return Math.min(diff, this.maxDelayMs);
      }
    }
    // Exponential backoff: base * 2^attempt + jitter (0% to 25%)
    const exponential = this.baseDelayMs * Math.pow(2, attempt);
    const jitter = exponential * (Math.random() * 0.25);
    return Math.min(Math.round(exponential + jitter), this.maxDelayMs);
  }

  async decide(prompt: string): Promise<{ decision: AiDecision; usage: AiUsage }> {
    let lastError = 'No model attempted';
    let totalRateLimitsEncountered = false;
    let totalRetriesPerformed = 0;

    for (const [index, model] of this.models.entries()) {
      const started = Date.now();
      let modelRetries = 0;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const response = await this.fetchFn('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.key}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0,
              response_format: { type: 'json_object' },
            }),
            signal: AbortSignal.timeout(this.timeoutMs),
          });

          if (!response.ok) {
            const isRateLimit = response.status === 429;
            if (isRateLimit) totalRateLimitsEncountered = true;

            // Retriable on current model: 429 (rate limit) or 503/504 (transient server unavailable)
            const isTransient = isRateLimit || response.status === 503 || response.status === 504;
            if (isTransient && attempt < this.maxRetries) {
              const retryAfter = response.headers.get('retry-after');
              const waitMs = this.calculateBackoff(attempt, retryAfter);
              modelRetries++;
              totalRetriesPerformed++;
              await this.sleep(waitMs);
              continue;
            }
            throw new Error(`OpenRouter HTTP ${response.status}`);
          }

          const body = (await response.json()) as {
            model?: string;
            choices?: Array<{ message?: { content?: string | null } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
          };

          const decision = parseAiContent(body.choices?.[0]?.message?.content);
          // Fail-closed retry decision driven by the structured flag, never by the
          // model-authored `reason` text (a legit motivo may start with "Invalid").
          if (decision.parseFailed) throw new Error(decision.reason);

          return {
            decision,
            usage: {
              modelRequested: model,
              modelReturned: body.model ?? model,
              promptTokens: body.usage?.prompt_tokens ?? null,
              completionTokens: body.usage?.completion_tokens ?? null,
              totalTokens: body.usage?.total_tokens ?? null,
              costUsd: body.usage?.cost ?? null,
              latencyMs: Date.now() - started,
              error: null,
              fallbackUsed: index > 0,
              fallbackReason: index > 0 ? `Triggered after prior model failure: ${lastError}` : null,
              retriesUsed: modelRetries,
              rateLimit429Hit: totalRateLimitsEncountered,
            },
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown AI error';
          if (attempt < this.maxRetries && (lastError.includes('429') || lastError.includes('timeout') || lastError.includes('fetch'))) {
            const waitMs = this.calculateBackoff(attempt);
            modelRetries++;
            totalRetriesPerformed++;
            await this.sleep(waitMs);
            continue;
          }
          break;
        }
      }
    }

    return {
      decision: {
        action: 'HOLD',
        amountUsdt: 0,
        confidence: 0,
        reason: `All OpenRouter fallbacks failed: ${lastError}`,
        rawResponse: null,
        parseFailed: true,
      },
      usage: {
        modelRequested: this.models.at(-1) ?? 'none',
        modelReturned: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs: 0,
        error: lastError,
        fallbackUsed: this.models.length > 1,
        fallbackReason: `All models failed, last error: ${lastError}`,
        retriesUsed: totalRetriesPerformed,
        rateLimit429Hit: totalRateLimitsEncountered,
      },
    };
  }
}
