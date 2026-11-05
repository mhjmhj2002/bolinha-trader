import { config, type SessionPhase } from '@bolinha/core';
import type { BrokerGateway } from '@bolinha/exchange';

type DailyRepository = {
  openPosition(): Promise<unknown | null>;
  dailyResult(): Promise<unknown | null>;
  createDailyResult(price: number, at: Date): Promise<{
    session_day?: unknown;
    gross_return_pct?: unknown;
    net_return_pct?: unknown;
    position_count?: unknown;
    win_count?: unknown;
    loss_count?: unknown;
    profit_factor?: unknown;
    expectancy_usdt?: unknown;
    fees_pct_of_gross?: unknown;
    ai_call_count?: unknown;
    bypass_count?: unknown;
  } | null>;
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
    await emit('INFO', 'daily_result_created', `Daily result persisted: gross=${result.gross_return_pct}% net=${result.net_return_pct}% winRate=${result.win_count}/${result.position_count} profitFactor=${result.profit_factor ?? 'N/A'} exp=${result.expectancy_usdt}R$`, {
      sessionDay: result.session_day,
      grossReturnPct: result.gross_return_pct,
      netReturnPct: result.net_return_pct,
      positionCount: result.position_count,
      winCount: result.win_count,
      lossCount: result.loss_count,
      profitFactor: result.profit_factor,
      expectancyUsdt: result.expectancy_usdt,
      feesPctOfGross: result.fees_pct_of_gross,
      aiCallCount: result.ai_call_count,
      bypassCount: result.bypass_count,
    });
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
