import { config, localTime, logger, sessionPhase, type SessionPhase } from '@bolinha/core';
import { TradingRepository } from '@bolinha/database';
import { TradingService } from './service.js';

const repo = new TradingRepository();
const service = new TradingService(repo);
let stopped = false;
let timer: NodeJS.Timeout | undefined;
const secondsUntil = (target: string, at = new Date()) => {
  const [h, m, s] = localTime(at).split(':').map(Number);
  const current = h * 3600 + m * 60 + s;
  const [targetHour, targetMinute] = target.split(':').map(Number);
  let seconds = targetHour * 3600 + targetMinute * 60 - current;
  if (seconds <= 0) seconds += 24 * 3600;
  return seconds * 1000;
};
const nextDelay = (phase: SessionPhase, at = new Date()) => {
  const interval = config.TRADING_INTERVAL_SECONDS * 1000;
  const boundary = phase === 'BEFORE_START' ? config.TRADING_START_TIME : phase === 'TRADING' ? config.TRADING_STOP_NEW_POSITIONS_TIME : phase === 'NO_NEW_POSITIONS' ? config.FORCE_CLOSE_TIME : phase === 'FORCE_CLOSE' ? config.TRADING_END_TIME : config.TRADING_START_TIME;
  return Math.max(250, Math.min(phase === 'FORCE_CLOSE' ? 30_000 : interval, secondsUntil(boundary, at)));
};
async function transition(phase: SessionPhase, next: Date, at: Date) {
  const state = await repo.updateSession(phase, next, at);
  if (!state.changed) return;
  await repo.event('INFO', 'trading_phase_changed', 'Trading session phase changed', { previous: state.previous ?? null, phase, sessionDay: state.day });
  if (phase === 'TRADING') await repo.event('INFO', 'trading_session_started', 'Trading session started', { sessionDay: state.day });
  if (phase === 'FINISHED') await repo.event('INFO', 'trading_session_finished', 'Trading session finished', { sessionDay: state.day });
}
async function finishDaily(at: Date) {
  const existing = await repo.dailyResult();
  const result = await repo.createDailyResult(0, at); // FORCE_CLOSE leaves no conceptual position.
  if (!existing && result) await repo.event('INFO', 'daily_result_created', 'Daily result persisted', { sessionDay: result.session_day });
}
async function tick() {
  if (stopped) return;
  const at = new Date(); const phase = sessionPhase(at); const delay = nextDelay(phase, at);
  try {
    await repo.ensureAccount(config.INITIAL_BANK_USDT); await repo.heartbeat();
    await transition(phase, new Date(at.getTime() + delay), at);
    if (phase === 'TRADING' || phase === 'NO_NEW_POSITIONS' || phase === 'FORCE_CLOSE') { await service.runOnce(at); await repo.completeCycle(new Date()); }
    if (phase === 'FINISHED') await finishDaily(at);
  } catch (error) { logger.error({ err: error, phase }, 'Scheduled worker cycle failed'); }
  finally { if (!stopped) timer = setTimeout(() => void tick(), delay); }
}
await repo.ensureAccount(config.INITIAL_BANK_USDT); await repo.heartbeat();
await repo.event('INFO', 'worker_started', 'Worker started', { loopEnabled: config.TRADING_LOOP_ENABLED });
setInterval(() => { void repo.heartbeat().catch((error: unknown) => logger.error({ err: error }, 'Heartbeat failure')); }, 30_000);
if (!config.TRADING_LOOP_ENABLED) logger.info({ event: 'worker_idle', loopEnabled: false }, 'Worker started with loop disabled');
else { logger.warn({ event: 'worker_loop_started', intervalSeconds: config.TRADING_INTERVAL_SECONDS }, 'Trading loop enabled'); void tick(); }
const stop = async () => { stopped = true; if (timer) clearTimeout(timer); try { await repo.event('INFO', 'worker_stopped', 'Worker stopped'); } catch (error) { logger.error({ err: error }, 'Could not persist worker_stopped event'); } logger.info({ event: 'shutdown' }, 'Worker shutdown'); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
