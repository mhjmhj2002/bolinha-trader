import { config, localTime, logger, sessionPhase, type SessionPhase } from '@bolinha/core';
import { TradingRepository } from '@bolinha/database';
import { BinanceTestnetClient } from '@bolinha/exchange';
import { TradingService } from './service.js';
import { closeRetryDelayMs, finishDailyIfPositionClosed, isCloseOnlyPhase } from './lifecycle.js';

const repo = new TradingRepository();
const service = new TradingService(repo);
const exchange = new BinanceTestnetClient(config.BINANCE_API_KEY, config.BINANCE_API_SECRET, config.SYMBOL);
let stopped = false;
let timer: NodeJS.Timeout | undefined;
let startupReconciled = false;
let reconciliationAttempts = 0;
const reconciliationRetryDelayMs = 30_000;
const reconciliationMaxAttempts = 3;
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
  if (phase === 'FORCE_CLOSE_PENDING') return closeRetryDelayMs;
  const boundary = phase === 'BEFORE_START' ? config.TRADING_START_TIME : phase === 'TRADING' ? config.TRADING_STOP_NEW_POSITIONS_TIME : phase === 'NO_NEW_POSITIONS' ? config.FORCE_CLOSE_TIME : phase === 'FORCE_CLOSE' ? config.TRADING_END_TIME : config.TRADING_START_TIME;
  return Math.max(250, Math.min(phase === 'FORCE_CLOSE' ? closeRetryDelayMs : interval, secondsUntil(boundary, at)));
};
async function transition(phase: SessionPhase, next: Date, at: Date) {
  const state = await repo.updateSession(phase, next, at);
  if (!state.changed) return;
  await repo.event('INFO', 'trading_phase_changed', 'Trading session phase changed', { previous: state.previous ?? null, phase, sessionDay: state.day });
  if (phase === 'TRADING') await repo.event('INFO', 'trading_session_started', 'Trading session started', { sessionDay: state.day });
  if (phase === 'FINISHED') await repo.event('INFO', 'trading_session_finished', 'Trading session finished', { sessionDay: state.day });
}
async function tick() {
  if (stopped) return;
  const at = new Date();
  let phase: SessionPhase | undefined;
  try {
    await repo.ensureAccount(config.INITIAL_BANK_USDT); await repo.heartbeat();
    if (!startupReconciled) {
      if (reconciliationAttempts < reconciliationMaxAttempts) {
        reconciliationAttempts++;
        await service.reconcileStateOnStartup();
        startupReconciled = true;
      } else {
        // Keep the process observable after bounded retries, but never allow a
        // trading cycle until a restart obtains a clean reconciliation.
        return;
      }
    }
    // A disabled loop still performs and retries startup reconciliation, but
    // never reaches a trading cycle.
    if (!config.TRADING_LOOP_ENABLED) return;
    phase = sessionPhase(at, undefined, Boolean(await repo.openPosition()));
    if (phase !== 'FINISHED') await transition(phase, new Date(at.getTime() + nextDelay(phase, at)), at);
    if (phase === 'TRADING' || phase === 'NO_NEW_POSITIONS' || isCloseOnlyPhase(phase)) {
      await service.runOnce(at);
      await repo.completeCycle(new Date());
    }
    phase = sessionPhase(at, undefined, Boolean(await repo.openPosition()));
    if (phase === 'FINISHED') {
      // Persist the daily result before exposing a completed session.
      await finishDailyIfPositionClosed(repo, exchange, at);
      await transition(phase, new Date(at.getTime() + nextDelay(phase, at)), at);
    } else {
      await transition(phase, new Date(at.getTime() + nextDelay(phase, at)), at);
    }
  } catch (error) { logger.error({ err: error, phase }, 'Scheduled worker cycle failed'); }
  finally {
    if (!stopped)
      timer = setTimeout(
        () => void tick(),
        startupReconciled
          ? nextDelay(phase ?? 'FORCE_CLOSE_PENDING', at)
          : reconciliationAttempts < reconciliationMaxAttempts
            ? reconciliationRetryDelayMs
            : nextDelay(phase ?? 'FORCE_CLOSE_PENDING', at),
      );
  }
}
await repo.ensureAccount(config.INITIAL_BANK_USDT); await repo.heartbeat();
await repo.event('INFO', 'worker_started', 'Worker started', { loopEnabled: config.TRADING_LOOP_ENABLED });
setInterval(() => { void repo.heartbeat().catch((error: unknown) => logger.error({ err: error }, 'Heartbeat failure')); }, 30_000);
if (!config.TRADING_LOOP_ENABLED) logger.info({ event: 'worker_idle', loopEnabled: false }, 'Worker started with loop disabled');
else logger.warn({ event: 'worker_loop_started', intervalSeconds: config.TRADING_INTERVAL_SECONDS }, 'Worker loop enabled');
void tick();
const stop = async () => { stopped = true; if (timer) clearTimeout(timer); try { await repo.event('INFO', 'worker_stopped', 'Worker stopped'); } catch (error) { logger.error({ err: error }, 'Could not persist worker_stopped event'); } logger.info({ event: 'shutdown' }, 'Worker shutdown'); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
