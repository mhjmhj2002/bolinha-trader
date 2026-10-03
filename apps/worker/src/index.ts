import { config, logger, sessionPhase, type SessionPhase } from '@bolinha/core';
import { TradingRepository } from '@bolinha/database';
import { BinanceTestnetClient } from '@bolinha/exchange';
import { TradingService } from './service.js';
import { finishDailyIfPositionClosed, isCloseOnlyPhase } from './lifecycle.js';
import { nextCycleAt, reconciliationRetryDelay } from './scheduler.js';

const repo = new TradingRepository();
const service = new TradingService(repo);
const exchange = new BinanceTestnetClient(config.BINANCE_API_KEY, config.BINANCE_API_SECRET, config.SYMBOL);
let stopped = false;
let timer: NodeJS.Timeout | undefined;
let startupReconciled = false;
let reconciliationAttempts = 0;
let ticking = false;
async function transition(phase: SessionPhase, next: Date, at: Date) {
  const state = await repo.updateSession(phase, next, at);
  if (!state.changed) return;
  await repo.event('INFO', 'trading_phase_changed', 'Trading session phase changed', { previous: state.previous ?? null, phase, sessionDay: state.day });
  if (phase === 'TRADING') await repo.event('INFO', 'trading_session_started', 'Trading session started', { sessionDay: state.day });
  if (phase === 'FINISHED') await repo.event('INFO', 'trading_session_finished', 'Trading session finished', { sessionDay: state.day });
}
async function tick() {
  if (stopped || ticking) return;
  ticking = true;
  const at = new Date();
  let phase: SessionPhase | undefined;
  let consolidationRetry = false;
  try {
    await repo.ensureAccount(config.INITIAL_BANK_USDT); await repo.heartbeat();
    if (!startupReconciled) {
      try {
        reconciliationAttempts++;
        await service.reconcileStateOnStartup();
        startupReconciled = true;
        reconciliationAttempts = 0;
      } catch (error) {
        // Keep retrying with a capped backoff. Trading remains fail-closed
        // until reconciliation records a consistent state.
        logger.warn({ err: error, attempts: reconciliationAttempts }, 'Startup reconciliation will be retried');
      }
    }
    // A disabled loop still performs and retries startup reconciliation, but
    // never reaches a trading cycle.
    if (!startupReconciled || !config.TRADING_LOOP_ENABLED) return;
    await repo.recordOperationalCheck(at);
    phase = sessionPhase(at, undefined, Boolean(await repo.openPosition()));
    if (phase !== 'FINISHED') await transition(phase, nextCycleAt(phase, at), at);
    if (phase === 'TRADING') {
      await service.runOnce(at);
      await repo.completeDecisionCycle(new Date());
    } else if (isCloseOnlyPhase(phase)) {
      await service.runOnce(at);
    }
    phase = sessionPhase(at, undefined, Boolean(await repo.openPosition()));
    if (phase === 'FINISHED') {
      await transition(phase, nextCycleAt(phase, new Date()), at);
      // FINISHED is a trading state, not proof that ledger consolidation has
      // succeeded. This path never invokes AI or order placement.
      await finishDailyIfPositionClosed(repo, exchange, at);
    } else {
      await transition(phase, nextCycleAt(phase, new Date()), at);
    }
  } catch (error) { consolidationRetry = phase === 'FINISHED'; logger.error({ err: error, phase }, 'Scheduled worker cycle failed'); }
  finally {
    ticking = false;
    if (!stopped) {
      const scheduledAt = startupReconciled
        ? consolidationRetry ? new Date(Date.now() + 30_000) : nextCycleAt(phase ?? 'FORCE_CLOSE_PENDING', new Date())
        : new Date(Date.now() + reconciliationRetryDelay(reconciliationAttempts));
      timer = setTimeout(
        () => void tick(),
        Math.max(0, scheduledAt.getTime() - Date.now()),
      );
    }
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
