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

export type SessionPhase = 'BEFORE_START' | 'TRADING' | 'NO_NEW_POSITIONS' | 'FORCE_CLOSE' | 'FINISHED';
export interface SessionSchedule { timezone: string; start: string; stopNewPositions: string; forceClose: string; end: string }
export const sessionSchedule = (c: Pick<Config, 'TRADING_TIMEZONE' | 'TRADING_START_TIME' | 'TRADING_STOP_NEW_POSITIONS_TIME' | 'FORCE_CLOSE_TIME' | 'TRADING_END_TIME'> = config): SessionSchedule => ({
  timezone: c.TRADING_TIMEZONE, start: c.TRADING_START_TIME, stopNewPositions: c.TRADING_STOP_NEW_POSITIONS_TIME, forceClose: c.FORCE_CLOSE_TIME, end: c.TRADING_END_TIME,
});
const localParts = (at: Date, timezone: string) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
export const sessionDay = (at = new Date(), timezone: string = config.TRADING_TIMEZONE) => { const p = localParts(at, timezone); return `${p.year}-${p.month}-${p.day}`; };
export const localTime = (at = new Date(), timezone: string = config.TRADING_TIMEZONE) => { const p = localParts(at, timezone); return `${p.hour}:${p.minute}:${p.second}`; };
export const sessionPhase = (at = new Date(), schedule = sessionSchedule()): SessionPhase => {
  const time = localTime(at, schedule.timezone).slice(0, 5);
  if (time < schedule.start) return 'BEFORE_START';
  if (time < schedule.stopNewPositions) return 'TRADING';
  if (time < schedule.forceClose) return 'NO_NEW_POSITIONS';
  if (time < schedule.end) return 'FORCE_CLOSE';
  return 'FINISHED';
};
