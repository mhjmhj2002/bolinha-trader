import { defaultTradingConfiguration, localTime, sessionSchedule, type SessionPhase, type TradingConfiguration } from '@bolinha/core';
import { closeRetryDelayMs } from './lifecycle.js';

const reconciliationInitialDelayMs = 30_000;
const reconciliationMaxDelayMs = 5 * 60_000;
const minimumDelayMs = 250;

const secondsAt = (time: string) => {
  const [hour, minute, second = '0'] = time.split(':').map(Number);
  return hour * 3_600 + minute * 60 + Number(second);
};

const atLocalSecond = (at: Date, targetSeconds: number, nextDay = false) => {
  const currentSeconds = secondsAt(localTime(at));
  let deltaMs = (targetSeconds - currentSeconds) * 1_000 - at.getMilliseconds();
  if (nextDay || deltaMs <= 0) deltaMs += 24 * 60 * 60 * 1_000;
  return new Date(at.getTime() + deltaMs);
};

/**
 * Select the next wall-clock slot instead of adding an interval to the end of
 * a cycle. A slow cycle skips to the next expected slot, avoiding drift and an
 * unnecessary full-interval wait.
 */
export const nextCycleAt = (phase: SessionPhase, configurationOrAt: TradingConfiguration | Date = defaultTradingConfiguration, maybeAt = new Date()) => {
  const configuration = configurationOrAt instanceof Date ? defaultTradingConfiguration : configurationOrAt;
  const at = configurationOrAt instanceof Date ? configurationOrAt : maybeAt;
  const schedule = sessionSchedule(configuration);
  const currentSeconds = secondsAt(localTime(at, schedule.timezone));
  const startSeconds = secondsAt(schedule.start);
  const stopSeconds = secondsAt(schedule.stopNewPositions);
  const forceSeconds = secondsAt(schedule.forceClose);
  const endSeconds = secondsAt(schedule.end);

  if (phase === 'BEFORE_START') return atLocalSecond(at, startSeconds);
  if (phase === 'FINISHED') return atLocalSecond(at, startSeconds, true);
  if (phase === 'FORCE_CLOSE_PENDING') return new Date(at.getTime() + closeRetryDelayMs);
  if (phase === 'FORCE_CLOSE') {
    const retry = new Date(at.getTime() + closeRetryDelayMs);
    const end = atLocalSecond(at, endSeconds);
    return retry < end ? retry : end;
  }

  const intervalSeconds = schedule.intervalSeconds;
  const elapsed = Math.max(0, currentSeconds - startSeconds);
  const nextSlotSeconds = startSeconds + (Math.floor(elapsed / intervalSeconds) + 1) * intervalSeconds;
  const boundarySeconds = phase === 'TRADING' ? stopSeconds : forceSeconds;
  const slot = atLocalSecond(at, Math.min(nextSlotSeconds, boundarySeconds));
  return slot.getTime() - at.getTime() < minimumDelayMs
    ? new Date(at.getTime() + minimumDelayMs)
    : slot;
};

/** Continuous, capped retry: failures keep trading blocked but never stop the worker. */
export const reconciliationRetryDelay = (failedAttempts: number) =>
  Math.min(reconciliationInitialDelayMs * 2 ** Math.max(0, failedAttempts - 1), reconciliationMaxDelayMs);
