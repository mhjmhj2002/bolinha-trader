import { config, type SessionPhase } from '@bolinha/core';
import type { BrokerGateway } from '@bolinha/exchange';

type DailyRepository = {
  openPosition(): Promise<unknown | null>;
  dailyResult(): Promise<unknown | null>;
  createDailyResult(price: number, at: Date): Promise<{ session_day?: unknown } | null>;
  event(level: string, event: string, message: string, payload?: unknown): Promise<unknown>;
  eventOnceForSession?: (level: string, event: string, message: string, at: Date, payload?: unknown) => Promise<boolean>;
  markDailyResultPending?: (at: Date) => Promise<void>;
  markDailyResultFailed?: (error: string, at: Date) => Promise<void>;
  markDailyResultOk?: (at: Date) => Promise<void>;
};

/**
 * A daily ledger is final only after PostgreSQL says the conceptual position is
 * closed.  Always use a live price instead of manufacturing a zero valuation.
 */
export async function finishDailyIfPositionClosed(
  repo: DailyRepository,
  exchange: Pick<BrokerGateway, 'price'>,
  at: Date,
  force = false,
): Promise<boolean> {
  if (await repo.openPosition()) return false;
  const existing = await repo.dailyResult();
  if (existing && !force) { await repo.markDailyResultOk?.(at); return true; }
  await repo.markDailyResultPending?.(at);
  const emit = async (level: string, type: string, message: string, payload?: unknown) => {
    if (repo.eventOnceForSession) await repo.eventOnceForSession(level, type, message, at, payload);
    else await repo.event(level, type, message, payload);
  };
  await emit('INFO', 'daily_result_pending', 'Daily result consolidation pending');
  try {
    const result = await repo.createDailyResult(await exchange.price(), at);
    // A null result means the consolidation transaction did not leave a
    // readable daily_result behind. Returning success here used to strand the
    // session in `PENDING` forever because no retry would ever be scheduled
    // (BUG-10 parte C). Fail closed instead so the worker retries.
    if (!result) throw new Error('Daily result consolidation produced no persisted daily_result row');
    // The repository already flips the session to OK inside the same flow; the
    // explicit call makes the pending marker impossible to survive here, even
    // for reduced repositories.
    await repo.markDailyResultOk?.(at);
    await emit('INFO', 'daily_result_created', 'Daily result persisted', { sessionDay: result.session_day });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown daily result failure';
    await repo.markDailyResultFailed?.(message, at);
    await emit('ERROR', 'daily_result_failed', 'Daily result consolidation failed', { error: message });
    throw error;
  }
}

export const isCloseOnlyPhase = (phase: SessionPhase) =>
  phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING';

export const closeRetryDelayMs = 30_000;
export const isLoopEnabled = () => config.TRADING_LOOP_ENABLED;
