import 'dotenv/config';
import pino from 'pino';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const numeric = (fallback: number) => z.coerce.number().finite().default(fallback);
const time = (fallback: string) => z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^\d{2}:\d{2}$/).default(fallback));
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgres://bolinha:bolinha@localhost:5432/bolinha'),
  API_HOST: z.string().default('127.0.0.1'), API_PORT: numeric(3000),
  BINANCE_ENV: z.literal('testnet').default('testnet'), BINANCE_API_KEY: z.string().default(''), BINANCE_API_SECRET: z.string().default(''),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_MODELS: z.string().default('poolside/laguna-s-2.1:free,qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free,openrouter/free'),
  SYMBOL: z.literal('BTCUSDT').default('BTCUSDT'), INITIAL_BANK_USDT: z.coerce.number().finite().positive().default(20),
  MAX_POSITION_PERCENT: z.coerce.number().finite().min(0).max(100).default(100), TRADING_LOOP_ENABLED: bool,
  TRADING_INTERVAL_SECONDS: z.coerce.number().finite().int().positive().default(600),
  TRADING_TIMEZONE: z.literal('America/Sao_Paulo').default('America/Sao_Paulo'),
  TRADING_START_TIME: time('09:00'), TRADING_STOP_NEW_POSITIONS_TIME: time('17:50'), FORCE_CLOSE_TIME: time('17:55'), TRADING_END_TIME: time('18:00')
});
export type Config = z.infer<typeof configSchema>;
export const config = configSchema.parse(process.env);
// Deliberate guard: this version has no production Binance endpoint at all.
if (config.BINANCE_ENV !== 'testnet') throw new Error('BINANCE_ENV must be testnet; production is unsupported');
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: ['BINANCE_API_KEY', 'BINANCE_API_SECRET', 'OPENROUTER_API_KEY', '*.apiKey', '*.secret'] });

export type Action = 'BUY' | 'SELL' | 'HOLD';
export interface Position { quantity: number; entryPrice: number; costUsdt: number; openedAt: Date }
export interface Account { initialBankUsdt: number; cashUsdt: number; realizedPnlUsdt: number; aiCostUsd: number }
export interface SymbolRules { minNotional: number; minQty: number; stepSize: number }
export const now = () => new Date();
export const roundStepDown = (value: number, step: number) => Math.floor((value + 1e-12) / step) * step;

export type SessionPhase = 'BEFORE_START' | 'TRADING' | 'NO_NEW_POSITIONS' | 'FORCE_CLOSE' | 'FORCE_CLOSE_PENDING' | 'FINISHED';
export interface SessionSchedule { timezone: string; start: string; stopNewPositions: string; forceClose: string; end: string }
export const sessionSchedule = (c: Pick<Config, 'TRADING_TIMEZONE' | 'TRADING_START_TIME' | 'TRADING_STOP_NEW_POSITIONS_TIME' | 'FORCE_CLOSE_TIME' | 'TRADING_END_TIME'> = config): SessionSchedule => ({
  timezone: c.TRADING_TIMEZONE, start: c.TRADING_START_TIME, stopNewPositions: c.TRADING_STOP_NEW_POSITIONS_TIME, forceClose: c.FORCE_CLOSE_TIME, end: c.TRADING_END_TIME,
});
const localParts = (at: Date, timezone: string) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
export const sessionDay = (at = new Date(), timezone: string = config.TRADING_TIMEZONE) => { const p = localParts(at, timezone); return `${p.year}-${p.month}-${p.day}`; };
export const isSessionDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export const localTime = (at = new Date(), timezone: string = config.TRADING_TIMEZONE) => { const p = localParts(at, timezone); return `${p.hour}:${p.minute}:${p.second}`; };
/**
 * After the scheduled end, an open conceptual position keeps the worker in a
 * close-only state.  The caller supplies this persisted fact so a restart has
 * exactly the same behaviour as a continuously running worker.
 */
export const sessionPhase = (at = new Date(), schedule = sessionSchedule(), hasOpenPosition = false): SessionPhase => {
  const time = localTime(at, schedule.timezone).slice(0, 5);
  if (time < schedule.start) return 'BEFORE_START';
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
  | 'BINANCE_ERROR'
  | 'OPENROUTER_ERROR'
  | 'FALLBACK'
  | 'ORDER_REJECTED'
  | 'POSITION_OPEN_AFTER_END'
  | 'FORCE_CLOSE_NECESSARY'
  | 'INCONSISTENCY'
  | 'PENDING_ORDER'
  | 'RECONCILIATION_ISSUE'
  | 'PNL_DIVERGENT'
  | 'SESSION_INCOMPLETE';

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
  } | null;
  bank: {
    initialUsdt: number | null;
    finalUsdt: number | null;
    netPnlUsdt: number | null;
  };
  operations: { buy: number; sell: number; hold: number; rejectedByRisk: number; forceClose: boolean };
  ai: { calls: number; costUsd: number; fallbacks: number; models: Record<string, number> };
  infrastructure: {
    cyclesExpected: number;
    cyclesExecuted: number;
    maxCycleGapSeconds: number | null;
    workerRestarts: number;
    errors: number;
    binanceErrors: number;
    openRouterErrors: number;
    inconsistencies: number;
    reconciliationIssues: number;
    pendingOrders: number;
    rejectedOrders: number;
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
  const sessionFinished = input.session?.phase === 'FINISHED' && Boolean(input.session.finishedAt) && input.bank.finalUsdt !== null;
  const status = sessionFinished && !input.finalState.openPosition
    ? 'CONCLUÍDA'
    : input.session?.phase === 'FINISHED' ? 'INCOMPLETA' : input.session ? 'EM ANDAMENTO' : 'INCOMPLETA';
  const { infrastructure } = input;
  const intervalSeconds = Math.max(1, Math.round((
    ((Number(input.schedule.stopNewPositions.slice(0, 2)) * 60 + Number(input.schedule.stopNewPositions.slice(3))) -
      (Number(input.schedule.start.slice(0, 2)) * 60 + Number(input.schedule.start.slice(3)))) /
    Math.max(1, input.infrastructure.cyclesExpected)
  ) * 60));

  if (!sessionFinished) reportDiagnostic(diagnostics, 'SESSION_INCOMPLETE', 'WARN', 'A sessão não foi concluída.');
  if (input.session && infrastructure.cyclesExecuted < infrastructure.cyclesExpected)
    reportDiagnostic(diagnostics, 'CYCLE_MISSED', 'WARN', `${infrastructure.cyclesExpected - infrastructure.cyclesExecuted} ciclo(s) esperado(s) não foram executados.`, infrastructure.cyclesExpected - infrastructure.cyclesExecuted);
  if (infrastructure.maxCycleGapSeconds !== null && infrastructure.maxCycleGapSeconds > intervalSeconds * 1.5)
    reportDiagnostic(diagnostics, 'CYCLE_DELAYED', 'WARN', `Maior intervalo entre ciclos: ${infrastructure.maxCycleGapSeconds}s.`);
  if (infrastructure.workerRestarts > 0)
    reportDiagnostic(diagnostics, 'WORKER_RESTART', 'WARN', `${infrastructure.workerRestarts} reinício(s) do worker detectado(s).`, infrastructure.workerRestarts);
  if (infrastructure.binanceErrors > 0)
    reportDiagnostic(diagnostics, 'BINANCE_ERROR', 'ERROR', `${infrastructure.binanceErrors} erro(s) da Binance.`, infrastructure.binanceErrors);
  if (infrastructure.openRouterErrors > 0)
    reportDiagnostic(diagnostics, 'OPENROUTER_ERROR', 'ERROR', `${infrastructure.openRouterErrors} erro(s) do OpenRouter.`, infrastructure.openRouterErrors);
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
    `Operação Bolinha de Gude — ${report.date}`,
    '',
    'Sessão',
    `${report.schedule.start} → ${report.schedule.end}`,
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
    `Ciclos esperados: ${report.infrastructure.cyclesExpected}`,
    `Ciclos executados: ${report.infrastructure.cyclesExecuted}`,
    `Erros: ${report.infrastructure.errors}`,
    `Reinícios do worker: ${report.infrastructure.workerRestarts}`,
    `Maior intervalo sem ciclo: ${duration(report.infrastructure.maxCycleGapSeconds)}`,
    '',
    'Estado final',
    `Posição aberta: ${report.finalState.openPosition ? 'SIM' : 'NÃO'}`,
    '',
    'Diagnósticos',
    ...diagnosticLines,
    '',
    'Resultado operacional:',
    report.operationalResult,
  ].join('\n');
};
