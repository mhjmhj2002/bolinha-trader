import { config, type SessionPhase } from '@bolinha/core';
import type { BinanceGateway } from '@bolinha/exchange';

type DailyRepository = {
  openPosition(): Promise<unknown | null>;
  dailyResult(): Promise<unknown | null>;
  createDailyResult(price: number, at: Date): Promise<{ session_day?: unknown } | null>;
  event(level: string, event: string, message: string, payload?: unknown): Promise<unknown>;
};

/**
 * A daily ledger is final only after PostgreSQL says the conceptual position is
 * closed.  Always use a live price instead of manufacturing a zero valuation.
 */
export async function finishDailyIfPositionClosed(
  repo: DailyRepository,
  exchange: Pick<BinanceGateway, 'price'>,
  at: Date,
): Promise<boolean> {
  if (await repo.openPosition()) return false;
  const existing = await repo.dailyResult();
  const result = await repo.createDailyResult(await exchange.price(), at);
  if (!existing && result)
    await repo.event('INFO', 'daily_result_created', 'Daily result persisted', { sessionDay: result.session_day });
  return true;
}

export const isCloseOnlyPhase = (phase: SessionPhase) =>
  phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING';

export const closeRetryDelayMs = 30_000;
export const isLoopEnabled = () => config.TRADING_LOOP_ENABLED;
