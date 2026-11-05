import 'dotenv/config';
import pino from 'pino';
import { z } from 'zod';
import { B3_DEFAULT_BUY_COST_BUFFER_PCT, B3_MAX_BUY_COST_BUFFER_PCT } from './b3-costs.js';

export * from './b3-costs.js';
export * from './rounding.js';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const numeric = (fallback: number) => z.coerce.number().finite().default(fallback);
/** Canonical timeframe set used by the multi-timeframe entry (BUY) confluence filter. */
export const entryTimeframes = ['1m', '5m', '15m'] as const;
export type EntryTimeframe = (typeof entryTimeframes)[number];
const entryTimeframeList = z
  .string()
  .default(entryTimeframes.join(','))
  .transform((value): EntryTimeframe[] => {
    const requested = value.split(',').map((entry) => entry.trim().toLowerCase());
    const selected = entryTimeframes.filter((timeframe) => requested.includes(timeframe));
    // An unusable list falls back to the safe default instead of disabling the filter.
    return selected.length ? [...selected] : [...entryTimeframes];
  });
/** Defaults seguros das variáveis financeiras, alinhados aos valores que já eram
 * efetivos em runtime (banca de R$ 100 e 100% de alocação por posição). */
export const DEFAULT_INITIAL_BANK_BRL = 100;
export const DEFAULT_MAX_POSITION_PERCENT = 100;
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgres://bolinha:bolinha@localhost:5432/bolinha'),
  API_HOST: z.string().default('127.0.0.1'), API_PORT: numeric(3000),
  // Chave de IA: vazia (ou só espaços) faz toda chamada OpenRouter retornar 401 e
  // toda decisão cair no HOLD fail-closed. `validateStartupConfiguration` transforma
  // esse cenário em WARN explícito no bootstrap; o trim normaliza o whitespace.
  OPENROUTER_API_KEY: z.string().trim().default(''),
  OPENROUTER_MODELS: z.string().default('google/gemini-2.5-flash,deepseek/deepseek-chat,meta-llama/llama-3.3-70b-instruct,mistralai/mistral-small-24b-instruct-2501'),
  OPENROUTER_TIMEOUT_MS: numeric(30_000),
  // TASK-38: Resiliência a rate limit (HTTP 429) e falhas transitórias com backoff exponencial e jitter
  AI_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(2),
  AI_RETRY_BASE_DELAY_MS: numeric(1_000),
  AI_RETRY_MAX_DELAY_MS: numeric(10_000),
  // Confiança mínima para compras (BUY) quando decididas por modelo de fallback (default 0.70; modelos primários usam 0.50)
  AI_FALLBACK_MIN_CONFIDENCE: z.coerce.number().finite().min(0).max(1).default(0.70),
  INTERVAL_SECONDS: numeric(180),
  STOP_LOSS_PCT: numeric(0.012),
  MAX_STOP_LOSS_PCT: numeric(0.018),
  STOP_LOSS_MODE: z.enum(['STATIC', 'ATR']).default('STATIC'),
  ATR_MULTIPLIER: numeric(2.0),
  BREAKEVEN_TRIGGER_PCT: numeric(0.005),
  BREAKEVEN_PROFIT_LOCK_PCT: numeric(0.002),
  TRAILING_STOP_PCT: numeric(0.004),
  TRAILING_STOP_CAP_PCT: z.coerce.number().finite().positive().max(1).optional(),
  PARTIAL_TAKE_PROFIT_TRIGGER_PCT: numeric(0.006),
  PARTIAL_TAKE_PROFIT_RATIO: numeric(0.5),
  FULL_TAKE_PROFIT_PCT: numeric(0.015),
  // TASK-35: economia da entrada. BUY só passa se o alvo líquido compensar o risco e os custos.
  // Razão mínima ganho líquido / perda líquida (alvo vs stop, ambos após custos de round-trip). 0 desativa.
  MIN_REWARD_RISK_RATIO: z.coerce.number().finite().min(0).max(10).default(1.0),
  // O alvo (take profit) precisa ser ao menos N vezes o custo de round-trip (slippage + emolumentos). 0 desativa.
  MIN_TARGET_COST_MULTIPLE: z.coerce.number().finite().min(0).max(100).default(3),
  // O stop precisa ser ao menos N vezes o ATR% do ativo (stop dentro do ruído é stopado à toa). 0 desativa.
  MIN_STOP_ATR_MULTIPLE: z.coerce.number().finite().min(0).max(20).default(1.0),
  // TASK-36: risco máximo por operação (fração do patrimônio). A quantidade do BUY é limitada para que a perda no
  // stop + custos não exceda esse valor. 0 desativa (usa todo o caixa permitido por MAX_POSITION_PERCENT).
  RISK_PER_TRADE_PCT: z.coerce.number().finite().min(0).max(1).default(0.005),
  // TASK-40: Time-Stop (encerramento de posição sem progresso após N minutos com PnL líquido <= 0)
  TIME_STOP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  TIME_STOP_MINUTES: numeric(45),
  // TASK-40: Entrada escalonada (fração da quantidade para teste inicial de posição; 1.0 usa tamanho total)
  ENTRY_SCALING_RATIO: z.coerce.number().finite().min(0.1).max(1.0).default(1.0),
  // TASK-41: Cooldown mínimo em minutos entre tranches de aumento/escalonamento de posição aberta (0 desativa)
  ENTRY_SCALING_COOLDOWN_MINUTES: numeric(5),
  // TASK-40: Filtro de abertura de sessão (minutos iniciais do pregão sem novas compras; 0 desativa)
  OPENING_NO_TRADE_MINUTES: numeric(0),
  // Modo de cálculo de alvos de lucro: 'NET' considera custos B3 e IR de Day Trade (20%);
  // 'GROSS' considera apenas a valorização percentual bruta nominal.
  PROFIT_TARGET_CALCULATION_MODE: z.enum(['NET', 'GROSS']).default('NET'),
  // Alíquota de Imposto de Renda para operações de Day Trade (padrão 20% = 0.20).
  DAY_TRADE_TAX_RATE: z.coerce.number().finite().min(0).max(0.50).default(0.20),
  SYMBOL: z.string().default('PETR4'),
  SYMBOLS: z.string().default('PETR4,VALE3,ITUB4,BBDC4,BBAS3'),
  TRADING_LOOP_ENABLED: bool,
  // Multi-timeframe entry (BUY) confluence filter: deterministic gate that blocks
  // buys at the top of transient noise. Insufficient/invalid data always holds.
  ENTRY_FILTER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  ENTRY_TIMEFRAMES: entryTimeframeList,
  ENTRY_MIN_CONFLUENT_TIMEFRAMES: numeric(2),
  ENTRY_RSI_OVERBOUGHT: numeric(70),
  // TASK-37: Nível mínimo de RSI (ex: 35) para rejeitar compras em queda livre / faca caindo (0 desativa)
  ENTRY_RSI_OVERSOLD: numeric(0),
  // TASK-37: Extensão máxima permitida do preço acima da VWAP (ex: 0.015 = +1.5%; 0 desativa)
  ENTRY_MAX_VWAP_DISTANCE_PCT: z.coerce.number().finite().min(0).max(0.10).default(0),
  // TASK-37: Extensão máxima permitida do preço acima da EMA21 (ex: 0.015 = +1.5%; 0 desativa)
  ENTRY_MAX_EMA_DISTANCE_PCT: z.coerce.number().finite().min(0).max(0.10).default(0),
  ENTRY_REQUIRE_VWAP_ABOVE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Synthetic B3 market model (packages/exchange/src/b3/market-data.ts): intraday momentum waves.
  SYNTHETIC_VOLATILITY: z.coerce.number().finite().positive().max(0.2).default(0.001),
  SYNTHETIC_MOMENTUM_DRIFT: z.coerce.number().finite().min(0).max(0.05).default(0.00075),
  SYNTHETIC_TREND_SEGMENT_CANDLES: z.coerce.number().int().min(1).max(1440).default(26),
  SYNTHETIC_REGIME_FLIP_PROBABILITY: z.coerce.number().finite().min(0).max(1).default(0.6),
  SYNTHETIC_CONSOLIDATION_PROBABILITY: z.coerce.number().finite().min(0).max(1).default(0.15),
  SYNTHETIC_PULLBACK_PROBABILITY: z.coerce.number().finite().min(0).max(0.9).default(0.3),
  SYNTHETIC_MAX_TREND_RUN: z.coerce.number().int().min(2).max(240).default(12),
  SYNTHETIC_MEAN_REVERSION: z.coerce.number().finite().min(0).max(0.5).default(0.014),
  SYNTHETIC_PRICE_BOUND_PCT: z.coerce.number().finite().gt(0).max(0.5).default(0.08),
  SYNTHETIC_SEED: z.coerce.number().int().min(0).default(0),
  // Headroom extra (além de slippage + emolumentos reais) reservado pelo motor de
  // risco ao dimensionar um BUY. Fail-closed: valor maior só reduz a quantidade;
  // nunca é aceito valor negativo (isso aprovaria ordens que o broker rejeita).
  RISK_BUY_COST_BUFFER_PCT: z.coerce.number().finite().min(0).max(B3_MAX_BUY_COST_BUFFER_PCT)
    .default(B3_DEFAULT_BUY_COST_BUFFER_PCT),
  // Banca inicial (em BRL) usada pelo paper broker da B3 e pelo ledger PostgreSQL
  // no bootstrap. `INITIAL_BANK_USDT` é um alias legado (a operação é 100% B3/paper
  // desde a TASK-08, não existe mais mercado USDT): a consolidação abaixo resolve
  // UM único valor canônico (`Config.INITIAL_BANK_BRL`) e nunca cria a segunda
  // fonte de verdade. Nenhum dos dois é removido do objeto — antes, ambos eram
  // silenciosamente descartados pelo `z.object()`.
  INITIAL_BANK_BRL: z.coerce.number().finite().positive().optional(),
  /** Alias legado de `INITIAL_BANK_BRL`; só é usado quando o canônico está ausente. */
  INITIAL_BANK_USDT: z.coerce.number().finite().positive().optional(),
  // Limite diário de perda máxima (Daily Loss Limit / Circuit Breaker).
  // Se realizedPnlBrl acumulado no dia for <= -limite, bloqueia novas entradas (BUY)
  // protegendo a banca contra sequências negativas intradiárias.
  DAILY_MAX_LOSS_PCT: z.coerce.number().finite().positive().max(1).default(0.05),
  DAILY_MAX_LOSS_BRL: z.coerce.number().finite().positive().optional(),
  // Teto de alocação por posição consumido por `applyB3Risk`
  // (`(caixa + posição) * MAX_POSITION_PERCENT / 100`). A linha da tabela
  // `trading_configuration` é autoritativa em runtime; esta entrada tipada é o
  // fallback/default validado do bootstrap. Bounds alinhados a
  // `validateTradingConfiguration` (0, 100] — acima de 100% não haveria lastro.
  MAX_POSITION_PERCENT: z.coerce.number().finite().gt(0).max(100).default(DEFAULT_MAX_POSITION_PERCENT),
  // Ingestão em Tempo Real (WebSocket / Ticks)
  WS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WS_HOST: z.string().default('127.0.0.1'),
  WS_PORT: numeric(8080),
  WS_PATH: z.string().default('/ws/ticks'),
})
  // Consolida o alias legado `INITIAL_BANK_USDT` em `INITIAL_BANK_BRL` para que
  // exista um único valor canônico, tipado e efetivo em runtime.
  .transform((value) => ({
    ...value,
    INITIAL_BANK_BRL: value.INITIAL_BANK_BRL ?? value.INITIAL_BANK_USDT ?? DEFAULT_INITIAL_BANK_BRL,
  }));
export type Config = z.infer<typeof configSchema>;
export const config = configSchema.parse(process.env);

/**
 * Retorna a lista canônica de tickers a serem monitorados pelo scanner multi-ativos.
 * Faz parse da string `SYMBOLS` (separada por vírgula), normaliza para maiúsculas e remove vazios.
 * Se `SYMBOLS` estiver vazio, usa `[config.SYMBOL]`.
 */
export function parseTradingSymbols(symbolsString?: string, fallbackSymbol?: string): string[] {
  const source = symbolsString ?? config.SYMBOLS;
  const fallback = (fallbackSymbol ?? config.SYMBOL ?? 'PETR4').trim().toUpperCase();
  if (!source || typeof source !== 'string') return [fallback];
  const list = source
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  return list.length > 0 ? Array.from(new Set(list)) : [fallback];
}

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: ['OPENROUTER_API_KEY', '*.apiKey', '*.secret'] });

export interface StartupValidation {
  /** `false` quando `OPENROUTER_API_KEY` está vazia/só espaços. */
  openRouterApiKeyConfigured: boolean;
  warnings: string[];
}

/**
 * Validação de bootstrap das variáveis que não podem falhar em silêncio.
 * Nunca lança: a API e o worker continuam no ar (health/dashboard) e a operação
 * segue fail-closed — sem chave de IA toda decisão vira HOLD. O objetivo é tornar
 * a causa raiz visível no log de startup em vez de degradar sem aviso.
 */
export const validateStartupConfiguration = (
  source: Pick<Config, 'OPENROUTER_API_KEY'> = config,
  log: Pick<typeof logger, 'warn'> = logger,
): StartupValidation => {
  const warnings: string[] = [];
  const openRouterApiKeyConfigured = source.OPENROUTER_API_KEY.trim().length > 0;
  if (!openRouterApiKeyConfigured) {
    const message =
      'OPENROUTER_API_KEY is missing or blank: every AI call will be rejected (401) and every decision will be HOLD. Trading is disabled until a valid key is configured.';
    warnings.push(message);
    log.warn(
      { event: 'openrouter_api_key_missing', openRouterApiKeyConfigured: false, decisions: 'HOLD' },
      message,
    );
  }
  return { openRouterApiKeyConfigured, warnings };
};

export type Action = 'BUY' | 'SELL' | 'HOLD';
export interface Position {
  quantity: number;
  entryPrice: number;
  costUsdt: number;
  openedAt: Date;
  symbol?: string;
}
export interface Account { initialBankUsdt: number; cashUsdt: number; realizedPnlUsdt: number; aiCostUsd: number }
export interface SymbolRules { minNotional: number; minQty: number; stepSize: number }
export const now = () => new Date();

export interface MarketTickEvent {
  symbol: string;
  price: number;
  volume?: number;
  timestamp: number;
}

export interface MarketCandleEvent {
  symbol: string;
  interval: '1m' | '5m' | '15m';
  candle: {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
  };
}

export type SessionPhase = 'BEFORE_START' | 'TRADING' | 'NO_NEW_POSITIONS' | 'FORCE_CLOSE' | 'FORCE_CLOSE_PENDING' | 'FINISHED';
export interface SessionSchedule { timezone: string; start: string; stopNewPositions: string; forceClose: string; end: string; intervalSeconds: number }
export interface TradingConfiguration extends SessionSchedule {
  initialBankUsdt: number;
  maxPositionPercent: number;
  trailingStopCapPct?: number;
  updatedAt?: Date | null;
}
/** Bootstrap values only. Runtime operational behaviour must use PostgreSQL. */
export const defaultTradingConfiguration: TradingConfiguration = Object.freeze({
  timezone: 'America/Sao_Paulo', start: '09:00', stopNewPositions: '16:45', forceClose: '17:15', end: '18:00',
  intervalSeconds: config.INTERVAL_SECONDS, initialBankUsdt: config.INITIAL_BANK_BRL, maxPositionPercent: config.MAX_POSITION_PERCENT,
  trailingStopCapPct: config.TRAILING_STOP_CAP_PCT,
});
export const sessionSchedule = (configuration: Pick<TradingConfiguration, 'timezone' | 'start' | 'stopNewPositions' | 'forceClose' | 'end' | 'intervalSeconds'> = defaultTradingConfiguration): SessionSchedule => ({ ...configuration });
const timeValue = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
export const validateTradingConfiguration = (value: TradingConfiguration): TradingConfiguration => {
  if (![value.start, value.stopNewPositions, value.forceClose, value.end].every((time) => timeValue.test(time)))
    throw new Error('Configuration times must use HH:MM');
  try { new Intl.DateTimeFormat('en-CA', { timeZone: value.timezone }).format(); }
  catch { throw new Error('Configuration timezone is invalid'); }
  if (!(minutes(value.start) < minutes(value.stopNewPositions) && minutes(value.stopNewPositions) < minutes(value.forceClose) && minutes(value.forceClose) < minutes(value.end)))
    throw new Error('Configuration times must be strictly ordered');
  if (!Number.isInteger(value.intervalSeconds) || value.intervalSeconds <= 0) throw new Error('Configuration intervalSeconds must be positive');
  if (!Number.isFinite(value.initialBankUsdt) || value.initialBankUsdt <= 0) throw new Error('Configuration initialBankUsdt must be positive');
  if (!Number.isFinite(value.maxPositionPercent) || value.maxPositionPercent <= 0 || value.maxPositionPercent > 100) throw new Error('Configuration maxPositionPercent must be between 0 and 100');
  if (value.trailingStopCapPct !== undefined && (!Number.isFinite(value.trailingStopCapPct) || value.trailingStopCapPct <= 0 || value.trailingStopCapPct > 1))
    throw new Error('Configuration trailingStopCapPct must be positive and at most 1');
  return value;
};
const localParts = (at: Date, timezone: string) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
export const sessionDay = (at = new Date(), timezone: string = defaultTradingConfiguration.timezone) => { const p = localParts(at, timezone); return `${p.year}-${p.month}-${p.day}`; };
export const isSessionDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export const localTime = (at = new Date(), timezone: string = defaultTradingConfiguration.timezone) => { const p = localParts(at, timezone); return `${p.hour}:${p.minute}:${p.second}`; };
/** Formats an instant for an operator without changing the UTC instant stored in PostgreSQL. */
export const formatOperationalDateTime = (at: Date, timezone: string = defaultTradingConfiguration.timezone) => {
  const p = localParts(at, timezone);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
};

const secondsOfDay = (time: string) => {
  const [hour, minute, second = 0] = time.split(':').map(Number);
  return hour * 3_600 + minute * 60 + second;
};

/** Turns a local session date/time into its UTC instant without relying on the
 * process timezone. The small correction loop also keeps named IANA timezones
 * correct when their UTC offset changes. */
export const atSessionTime = (day: string, time: string, timezone: string) => {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, date, hour, minute, second);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Number.isNaN(candidate.getTime())) throw new Error(`Invalid session time: ${day} ${time}`);
    const local = localParts(candidate, timezone);
    const observed = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second));
    const adjustment = desired - observed;
    if (adjustment === 0) break;
    candidate = new Date(candidate.getTime() + adjustment);
  }
  return candidate;
};

export type ExpectedDecisionCycles = {
  expectedDecisionCycles: number;
  effectiveStartAt: Date | null;
  effectiveEndAt: Date | null;
};

/**
 * Counts the decision-cycle opportunities produced by the current scheduler:
 * one immediate run when the loop first reaches TRADING, followed by the
 * fixed slots anchored at the configured start. Close-only phases are never
 * included. `actualTradingStart` is intentionally retained across restarts,
 * so downtime after that first activation remains visible as missed slots.
 */
export const calculateExpectedDecisionCycles = ({
  sessionDay: day,
  schedule,
  actualTradingStart,
  finishedAt = null,
  nowAt = new Date(),
}: {
  sessionDay: string;
  schedule: SessionSchedule;
  actualTradingStart: Date | string | null;
  finishedAt?: Date | string | null;
  nowAt?: Date;
}): ExpectedDecisionCycles => {
  const configuredStart = atSessionTime(day, schedule.start, schedule.timezone);
  const stopNewPositions = atSessionTime(day, schedule.stopNewPositions, schedule.timezone);
  const actualStart = actualTradingStart === null ? null : new Date(actualTradingStart);
  if (!actualStart || Number.isNaN(actualStart.getTime()))
    return { expectedDecisionCycles: 0, effectiveStartAt: null, effectiveEndAt: null };
  const effectiveStartAt = new Date(Math.max(configuredStart.getTime(), actualStart.getTime()));
  const completedAt = finishedAt === null ? null : new Date(finishedAt);
  const endCandidate = completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : nowAt;
  const effectiveEndAt = new Date(Math.min(stopNewPositions.getTime(), endCandidate.getTime()));
  if (effectiveStartAt >= effectiveEndAt)
    return { expectedDecisionCycles: 0, effectiveStartAt, effectiveEndAt };

  // The immediate startup run is a real decision opportunity. Subsequent
  // opportunities are precisely the fixed wall-clock slots scheduled after it.
  let expectedDecisionCycles = 1;
  const startSeconds = secondsOfDay(schedule.start);
  const stopSeconds = secondsOfDay(schedule.stopNewPositions);
  for (let seconds = startSeconds; seconds < stopSeconds; seconds += schedule.intervalSeconds) {
    const slotTime = `${String(Math.floor(seconds / 3_600)).padStart(2, '0')}:${String(Math.floor((seconds % 3_600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    const slot = atSessionTime(day, slotTime, schedule.timezone);
    if (slot > effectiveStartAt && slot < effectiveEndAt) expectedDecisionCycles++;
  }
  return { expectedDecisionCycles, effectiveStartAt, effectiveEndAt };
};
/**
 * After the scheduled end, an open conceptual position keeps the worker in a
 * close-only state.  The caller supplies this persisted fact so a restart has
 * exactly the same behaviour as a continuously running worker.
 */
export const sessionPhase = (at = new Date(), schedule = sessionSchedule(), hasOpenPosition = false): SessionPhase => {
  const time = localTime(at, schedule.timezone).slice(0, 5);
  // A conceptual position is never allowed to wait for the next session. This
  // includes the overnight period before the normal start time.
  if (time < schedule.start) return hasOpenPosition ? 'FORCE_CLOSE_PENDING' : 'BEFORE_START';
  if (time < schedule.stopNewPositions) return 'TRADING';
  if (time < schedule.forceClose) return 'NO_NEW_POSITIONS';
  if (time < schedule.end) return 'FORCE_CLOSE';
  return hasOpenPosition ? 'FORCE_CLOSE_PENDING' : 'FINISHED';
};

export type DiagnosticSeverity = 'INFO' | 'WARN' | 'ERROR';
export type DailyDiagnosticCode =
  | 'CYCLE_MISSED'
  | 'CYCLE_DELAYED'
  | 'WORKER_RESTART'
  | 'BROKER_ERROR'
  | 'OPENROUTER_ERROR'
  | 'FALLBACK'
  | 'ORDER_REJECTED'
  | 'POSITION_OPEN_AFTER_END'
  | 'FORCE_CLOSE_NECESSARY'
  | 'INCONSISTENCY'
  | 'PENDING_ORDER'
  | 'RECONCILIATION_ISSUE'
  | 'PNL_DIVERGENT'
  | 'SESSION_INCOMPLETE'
  | 'CONSOLIDATION_PENDING';

export type DailyDiagnostic = {
  code: DailyDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  count?: number;
};

export type DailyReportInput = {
  date: string;
  schedule: SessionSchedule;
  session: {
    phase: string;
    startedAt: string | null;
    finishedAt: string | null;
    cyclesExecuted: number;
    decisionCycles?: number;
    operationalChecks?: number;
    forceCloseAttempts?: number;
    reconciliationRuns?: number;
  } | null;
  bank: {
    initialUsdt: number | null;
    finalUsdt: number | null;
    netPnlUsdt: number | null;
  };
  operations: { buy: number; sell: number; hold: number; rejectedByRisk: number; forceClose: boolean };
  ai: { calls: number; costUsd: number; fallbacks: number; models: Record<string, number> };
  consolidationStatus?: 'PENDING' | 'OK' | 'ERROR' | null;
  infrastructure: {
    cyclesExpected: number;
    cyclesExecuted: number;
    effectiveStartAt?: string | null;
    maxCycleGapSeconds: number | null;
    workerRestarts: number;
    errors: number;
    brokerErrors: number;
    openRouterErrors: number;
    inconsistencies: number;
    reconciliationIssues: number;
    pendingOrders: number;
    rejectedOrders: number;
    operationalChecks?: number;
    forceCloseAttempts?: number;
    reconciliationRuns?: number;
  };
  finalState: { openPosition: boolean };
};

export type DailyReport = DailyReportInput & {
  status: 'CONCLUÍDA' | 'EM ANDAMENTO' | 'INCOMPLETA';
  bank: DailyReportInput['bank'] & { returnPct: number | null };
  diagnostics: DailyDiagnostic[];
  operationalResult: 'OK' | 'ATENÇÃO' | 'CRÍTICO';
};

const reportDiagnostic = (
  diagnostics: DailyDiagnostic[],
  code: DailyDiagnosticCode,
  severity: DiagnosticSeverity,
  message: string,
  count?: number,
) => diagnostics.push({ code, severity, message, ...(count === undefined ? {} : { count }) });

/**
 * Turns persisted daily evidence into a stable operational conclusion.  It is
 * deliberately pure so reports can be regenerated and tested without logs,
 * the worker, or an exchange connection.
 */
export const buildDailyReport = (input: DailyReportInput): DailyReport => {
  const diagnostics: DailyDiagnostic[] = [];
  const sessionFinished = input.session?.phase === 'FINISHED' && Boolean(input.session.finishedAt) && input.bank.finalUsdt !== null && (input.consolidationStatus ?? 'OK') === 'OK';
  const status = sessionFinished && !input.finalState.openPosition
    ? 'CONCLUÍDA'
    : input.session?.phase === 'FINISHED' ? 'INCOMPLETA' : input.session ? 'EM ANDAMENTO' : 'INCOMPLETA';
  const { infrastructure } = input;
  const intervalSeconds = Math.max(1, input.schedule.intervalSeconds || Math.round((
    ((Number(input.schedule.stopNewPositions.slice(0, 2)) * 60 + Number(input.schedule.stopNewPositions.slice(3))) -
      (Number(input.schedule.start.slice(0, 2)) * 60 + Number(input.schedule.start.slice(3)))) /
    Math.max(1, input.infrastructure.cyclesExpected)
  ) * 60));

  if (!sessionFinished) reportDiagnostic(diagnostics, 'SESSION_INCOMPLETE', 'WARN', 'A sessão não foi concluída.');
  if (input.session?.phase === 'FINISHED' && input.consolidationStatus && input.consolidationStatus !== 'OK')
    reportDiagnostic(diagnostics, 'CONSOLIDATION_PENDING', input.consolidationStatus === 'ERROR' ? 'ERROR' : 'WARN', `Consolidação diária: ${input.consolidationStatus}.`);
  if (input.session && infrastructure.cyclesExecuted < infrastructure.cyclesExpected)
    reportDiagnostic(diagnostics, 'CYCLE_MISSED', 'WARN', `${infrastructure.cyclesExpected - infrastructure.cyclesExecuted} ciclo(s) esperado(s) não foram executados.`, infrastructure.cyclesExpected - infrastructure.cyclesExecuted);
  if (infrastructure.maxCycleGapSeconds !== null && infrastructure.maxCycleGapSeconds > intervalSeconds * 1.5)
    reportDiagnostic(diagnostics, 'CYCLE_DELAYED', 'WARN', `Maior intervalo entre ciclos: ${infrastructure.maxCycleGapSeconds}s.`);
  if (infrastructure.workerRestarts > 0)
    reportDiagnostic(diagnostics, 'WORKER_RESTART', 'WARN', `${infrastructure.workerRestarts} reinício(s) do worker detectado(s).`, infrastructure.workerRestarts);
  if (infrastructure.brokerErrors > 0)
    reportDiagnostic(diagnostics, 'BROKER_ERROR', 'ERROR', `${infrastructure.brokerErrors} erro(s) do broker.`, infrastructure.brokerErrors);
  if (infrastructure.openRouterErrors > 0)
    reportDiagnostic(diagnostics, 'OPENROUTER_ERROR', 'WARN', `${infrastructure.openRouterErrors} erro(s) do OpenRouter com HOLD seguro.`, infrastructure.openRouterErrors);
  if (input.ai.fallbacks > 0)
    reportDiagnostic(diagnostics, 'FALLBACK', 'WARN', `${input.ai.fallbacks} fallback(s) de IA utilizado(s).`, input.ai.fallbacks);
  const rejectedOrders = input.operations.rejectedByRisk + infrastructure.rejectedOrders;
  if (rejectedOrders > 0)
    reportDiagnostic(diagnostics, 'ORDER_REJECTED', 'WARN', `${input.operations.rejectedByRisk} decisão(ões) rejeitada(s) pelo risco e ${infrastructure.rejectedOrders} ordem(ns) rejeitada(s).`, rejectedOrders);
  if (input.operations.forceClose)
    reportDiagnostic(diagnostics, 'FORCE_CLOSE_NECESSARY', 'WARN', 'Foi necessário acionar o force-close.');
  if (input.finalState.openPosition)
    reportDiagnostic(diagnostics, 'POSITION_OPEN_AFTER_END', 'ERROR', 'Há posição aberta após o encerramento previsto da sessão.');
  if (infrastructure.inconsistencies > 0)
    reportDiagnostic(diagnostics, 'INCONSISTENCY', 'ERROR', `${infrastructure.inconsistencies} inconsistência(s) de estado detectada(s).`, infrastructure.inconsistencies);
  if (infrastructure.pendingOrders > 0)
    reportDiagnostic(diagnostics, 'PENDING_ORDER', 'ERROR', `${infrastructure.pendingOrders} ordem(ns) pendente(s).`, infrastructure.pendingOrders);
  if (infrastructure.reconciliationIssues > 0)
    reportDiagnostic(diagnostics, 'RECONCILIATION_ISSUE', 'WARN', `${infrastructure.reconciliationIssues} problema(s) de reconciliação.`, infrastructure.reconciliationIssues);
  const returnPct = input.bank.initialUsdt && input.bank.finalUsdt !== null
    ? ((input.bank.finalUsdt - input.bank.initialUsdt) / input.bank.initialUsdt) * 100
    : null;
  if (input.bank.initialUsdt !== null && input.bank.finalUsdt !== null && input.bank.netPnlUsdt !== null && Math.abs((input.bank.finalUsdt - input.bank.initialUsdt) - input.bank.netPnlUsdt) > 0.00000001)
    reportDiagnostic(diagnostics, 'PNL_DIVERGENT', 'ERROR', 'O P/L persistido diverge da variação da banca.');
  const operationalResult = diagnostics.some((diagnostic) => diagnostic.severity === 'ERROR')
    ? 'CRÍTICO'
    : diagnostics.some((diagnostic) => diagnostic.severity === 'WARN') ? 'ATENÇÃO' : 'OK';
  return { ...input, status, bank: { ...input.bank, returnPct }, diagnostics, operationalResult };
};

const fixed = (value: number | null, digits = 8) => value === null ? 'não consolidada' : value.toFixed(digits);
const signed = (value: number | null, digits = 8) => value === null ? 'não consolidado' : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const duration = (seconds: number | null) => {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes ? `${minutes}m` : ''}${Math.round(seconds % 60)}s`;
};

export const formatDailyReport = (report: DailyReport): string => {
  const models = Object.entries(report.ai.models)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, calls]) => `${model}: ${calls}`);
  const diagnosticLines = report.diagnostics.length
    ? report.diagnostics.map((diagnostic) => `- [${diagnostic.severity}] ${diagnostic.message}`)
    : ['- Nenhum diagnóstico.'];
  return [
    `Bolinha Trader — ${report.date}`,
    '',
    'Sessão',
    `${report.schedule.start} → ${report.schedule.end}`,
    `Fuso: ${report.schedule.timezone}`,
    `Status: ${report.status}`,
    '',
    'Banca',
    `Inicial: ${fixed(report.bank.initialUsdt)} USDT`,
    `Final: ${fixed(report.bank.finalUsdt)} USDT`,
    `Resultado líquido: ${signed(report.bank.netPnlUsdt)} USDT`,
    `Retorno: ${report.bank.returnPct === null ? 'não consolidado' : `${signed(report.bank.returnPct, 4)}%`}`,
    '',
    'Operações',
    `BUY: ${report.operations.buy}`,
    `SELL: ${report.operations.sell}`,
    `HOLD: ${report.operations.hold}`,
    `Rejeitadas pelo risco: ${report.operations.rejectedByRisk}`,
    `Force close: ${report.operations.forceClose ? 'sim' : 'não'}`,
    '',
    'IA',
    `Chamadas: ${report.ai.calls}`,
    `Custo: US$ ${report.ai.costUsd.toFixed(4)}`,
    `Fallbacks: ${report.ai.fallbacks}`,
    '',
    'Modelos',
    ...(models.length ? models : ['Nenhum modelo utilizado.']),
    '',
    'Infraestrutura',
    `Início configurado: ${report.schedule.start}`,
    `Início efetivo: ${report.infrastructure.effectiveStartAt ? localTime(new Date(report.infrastructure.effectiveStartAt), report.schedule.timezone).slice(0, 5) : '—'}`,
    `Ciclos esperados: ${report.infrastructure.cyclesExpected}`,
    `Decision cycles executados: ${report.infrastructure.cyclesExecuted}`,
    `Decision cycles perdidos: ${Math.max(0, report.infrastructure.cyclesExpected - report.infrastructure.cyclesExecuted)}`,
    `Operational checks: ${report.infrastructure.operationalChecks ?? 0}`,
    `Force-close attempts: ${report.infrastructure.forceCloseAttempts ?? 0}`,
    `Reconciliações: ${report.infrastructure.reconciliationRuns ?? 0}`,
    `Erros: ${report.infrastructure.errors}`,
    `Reinícios do worker: ${report.infrastructure.workerRestarts}`,
    `Maior intervalo sem ciclo: ${duration(report.infrastructure.maxCycleGapSeconds)}`,
    '',
    'Estado final',
    `Posição aberta: ${report.finalState.openPosition ? 'SIM' : 'NÃO'}`,
    `Daily result: ${report.consolidationStatus ?? 'PENDING'}`,
    '',
    'Diagnósticos',
    ...diagnosticLines,
    '',
    'Resultado operacional:',
    report.operationalResult,
  ].join('\n');
};
