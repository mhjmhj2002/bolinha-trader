import { defaultTradingConfiguration, localTime, sessionSchedule, type SessionPhase, type TradingConfiguration } from '@bolinha/core';
import { closeRetryDelayMs } from './lifecycle.js';

const reconciliationInitialDelayMs = 30_000;
const reconciliationMaxDelayMs = 5 * 60_000;
const minimumDelayMs = 250;
const dayMs = 24 * 60 * 60 * 1_000;

const secondsAt = (time: string) => {
  const [hour, minute, second = '0'] = time.split(':').map(Number);
  return hour * 3_600 + minute * 60 + Number(second);
};

/**
 * Single convention for every wall-clock calculation in this module: the
 * seconds elapsed since midnight are always read in the *configured* schedule
 * timezone, never in the process default.
 */
const localSecondsAt = (at: Date, timezone: string) => secondsAt(localTime(at, timezone));

/**
 * Resolve the next instant whose wall clock, in `timezone`, matches
 * `targetSeconds`. `timezone` is mandatory so the "current" and "target"
 * seconds always belong to the same clock (the previous optional fallback let
 * one call site use the configured timezone while the other used the process
 * default, silently shifting every cycle slot by the UTC-offset delta).
 *
 * `nextDay` asks explicitly for the following day (only the FINISHED phase
 * wants tomorrow's start). Without it, a target already at/behind `at` rolls a
 * full day forward; that rollover is safe only when the caller is certain the
 * whole session is over, so the phase logic — not this helper — decides it.
 */
const atLocalSecond = (at: Date, targetSeconds: number, timezone: string, nextDay = false) => {
  const currentSeconds = localSecondsAt(at, timezone);
  const offsetMs = (targetSeconds - currentSeconds) * 1_000 - at.getMilliseconds();
  return new Date(at.getTime() + (nextDay || offsetMs <= 0 ? offsetMs + dayMs : offsetMs));
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
  const timezone = schedule.timezone;
  const currentSeconds = localSecondsAt(at, timezone);
  const startSeconds = secondsAt(schedule.start);
  const stopSeconds = secondsAt(schedule.stopNewPositions);
  const forceSeconds = secondsAt(schedule.forceClose);
  const endSeconds = secondsAt(schedule.end);

  // A stale BEFORE_START observation taken inside an already running session
  // must be re-evaluated almost immediately: waiting for tomorrow's start would
  // park the loop for a whole trading day.
  if (phase === 'BEFORE_START')
    return currentSeconds >= startSeconds
      ? new Date(at.getTime() + minimumDelayMs)
      : atLocalSecond(at, startSeconds, timezone);
  if (phase === 'FINISHED') return atLocalSecond(at, startSeconds, timezone, true);
  if (phase === 'FORCE_CLOSE_PENDING') return new Date(at.getTime() + closeRetryDelayMs);
  if (phase === 'FORCE_CLOSE') {
    const retry = new Date(at.getTime() + closeRetryDelayMs);
    const end = atLocalSecond(at, endSeconds, timezone);
    return retry < end ? retry : end;
  }

  // The session (including force-close) is already over, so the next sensible
  // slot is tomorrow's start — never a rollover of the phase boundary itself.
  if (currentSeconds >= endSeconds) return atLocalSecond(at, startSeconds, timezone, true);

  const intervalSeconds = schedule.intervalSeconds;
  const elapsed = Math.max(0, currentSeconds - startSeconds);
  const nextSlotSeconds = startSeconds + (Math.floor(elapsed / intervalSeconds) + 1) * intervalSeconds;
  const boundarySeconds = phase === 'TRADING' ? stopSeconds : forceSeconds;
  // Clamping only makes sense while the boundary is still ahead. Once it is at
  // or behind `now` the boundary has fired, and clamping would push the cycle a
  // full day forward; instead keep walking the interval grid, capped at the
  // session end, so no session is ever skipped.
  const slotSeconds = currentSeconds < boundarySeconds
    ? Math.min(nextSlotSeconds, boundarySeconds)
    : Math.min(nextSlotSeconds, endSeconds);
  const slot = atLocalSecond(at, slotSeconds, timezone);
  return slot.getTime() - at.getTime() < minimumDelayMs
    ? new Date(at.getTime() + minimumDelayMs)
    : slot;
};

/** Continuous, capped retry: failures keep trading blocked but never stop the worker. */
export const reconciliationRetryDelay = (failedAttempts: number) =>
  Math.min(reconciliationInitialDelayMs * 2 ** Math.max(0, failedAttempts - 1), reconciliationMaxDelayMs);
