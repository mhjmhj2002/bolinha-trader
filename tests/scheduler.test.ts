import { describe, expect, it } from 'vitest';
import { defaultTradingConfiguration } from '@bolinha/core';
import { nextCycleAt, reconciliationRetryDelay } from '../apps/worker/src/scheduler.ts';

// Slot arithmetic below is asserted in exact minutes, so the interval is pinned
// here instead of being inherited from the ambient INTERVAL_SECONDS env var:
// `defaultTradingConfiguration.intervalSeconds` is `config.INTERVAL_SECONDS`, so
// without pinning these assertions would change meaning (and fail) on any host
// whose .env uses a different cycle interval — a non-deterministic test.
const pinnedIntervalSeconds = 180;
const pinSchedule = (timezone: string) => ({
  ...defaultTradingConfiguration,
  timezone,
  intervalSeconds: pinnedIntervalSeconds,
});
const saoPauloConfiguration = pinSchedule('America/Sao_Paulo');
const utcConfiguration = pinSchedule('UTC');
const lisbonConfiguration = pinSchedule('Europe/Lisbon');
const tokyoConfiguration = pinSchedule('Asia/Tokyo');

const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

describe('worker scheduler', () => {
  it('uses stable wall-clock slots and skips a delayed slot without a full extra interval', () => {
    expect(nextCycleAt('TRADING', saoPauloConfiguration, new Date('2026-10-01T12:00:03Z')).toISOString()).toBe('2026-10-01T12:03:00.000Z');
    // A cycle that ends at 09:04 São Paulo resumes at the 09:06 expected slot,
    // not at 09:07 after another full three-minute interval.
    expect(nextCycleAt('TRADING', saoPauloConfiguration, new Date('2026-10-01T12:04:00Z')).toISOString()).toBe('2026-10-01T12:06:00.000Z');
  });

  it('caps a normal cycle at the next session boundary', () => {
    // StopNewPositions at 16:45 São Paulo (19:45Z in UTC)
    expect(nextCycleAt('TRADING', saoPauloConfiguration, new Date('2026-10-01T19:44:59Z')).toISOString()).toBe('2026-10-01T19:45:00.000Z');
  });

  it('keeps reconciliation retries continuous with a capped backoff', () => {
    expect(reconciliationRetryDelay(1)).toBe(30_000);
    expect(reconciliationRetryDelay(3)).toBe(120_000);
    expect(reconciliationRetryDelay(4)).toBe(240_000);
    expect(reconciliationRetryDelay(5)).toBe(300_000);
    expect(reconciliationRetryDelay(20)).toBe(300_000);
  });
});

describe('worker scheduler configured timezone', () => {
  it('honours a UTC configuration for every phase instead of the process default timezone', () => {
    // 11:59 UTC is one minute before the 12:00 UTC slot (start 09:00 + 60 * 180s).
    // The pre-fix helper read the current clock in America/Sao_Paulo (08:59) and
    // produced 15:00Z, silently shifting every cycle slot by the UTC offset.
    const at = new Date('2026-10-01T11:59:00Z');
    expect(nextCycleAt('TRADING', utcConfiguration, at).toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(nextCycleAt('TRADING', saoPauloConfiguration, at).toISOString()).not.toBe(nextCycleAt('TRADING', utcConfiguration, at).toISOString());

    // 08:00 UTC is before the 09:00 start; 09:00 UTC is its first TRADING slot.
    expect(nextCycleAt('BEFORE_START', utcConfiguration, new Date('2026-10-01T08:00:00Z')).toISOString()).toBe(
      '2026-10-01T09:00:00.000Z',
    );
    // 17:56 UTC sits in the force-close window; the retry stays inside it.
    expect(nextCycleAt('FORCE_CLOSE', utcConfiguration, new Date('2026-10-01T17:56:00Z')).toISOString()).toBe(
      '2026-10-01T17:56:30.000Z',
    );
    // 20:00 UTC is past the 18:00 end: only tomorrow's 09:00 UTC start is next.
    const finished = nextCycleAt('FINISHED', utcConfiguration, new Date('2026-10-01T20:00:00Z'));
    expect(finished.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    // The same instant under the default timezone resolves to 09:00 São Paulo
    // (12:00Z), which is exactly the shift the timezone bug produced.
    expect(finished.toISOString()).not.toBe(nextCycleAt('FINISHED', saoPauloConfiguration, new Date('2026-10-01T20:00:00Z')).toISOString());
  });

  it('honours Europe/Lisbon (UTC+1 in October) for every phase', () => {
    // 08:00Z is 09:00 WEST -> first TRADING slot is 09:03 WEST = 08:03Z.
    expect(nextCycleAt('TRADING', lisbonConfiguration, new Date('2026-10-01T08:00:00Z')).toISOString()).toBe(
      '2026-10-01T08:03:00.000Z',
    );
    // Default timezone would answer 12:03Z (09:03 São Paulo) for the same instant.
    expect(nextCycleAt('TRADING', saoPauloConfiguration, new Date('2026-10-01T08:00:00Z')).toISOString()).toBe('2026-10-01T12:03:00.000Z');
    // 07:00Z is 08:00 WEST -> wait for the 09:00 WEST start.
    expect(nextCycleAt('BEFORE_START', lisbonConfiguration, new Date('2026-10-01T07:00:00Z')).toISOString()).toBe(
      '2026-10-01T08:00:00.000Z',
    );
    // The 16:45 WEST boundary is 15:45Z, not 19:45Z.
    expect(nextCycleAt('TRADING', lisbonConfiguration, new Date('2026-10-01T15:44:59Z')).toISOString()).toBe(
      '2026-10-01T15:45:00.000Z',
    );
    // 18:30 WEST is after the end: next run is tomorrow's 09:00 WEST.
    expect(nextCycleAt('FINISHED', lisbonConfiguration, new Date('2026-10-01T17:30:00Z')).toISOString()).toBe(
      '2026-10-02T08:00:00.000Z',
    );
  });

  it('honours Asia/Tokyo (UTC+9) across the UTC day boundary', () => {
    // 00:00Z is 09:00 JST -> next slot is 09:03 JST = 00:03Z on the same UTC day.
    expect(nextCycleAt('TRADING', tokyoConfiguration, new Date('2026-10-01T00:00:00Z')).toISOString()).toBe(
      '2026-10-01T00:03:00.000Z',
    );
    // Under the default timezone that instant is 21:00 (previous day) in São
    // Paulo, i.e. after the session end, so it waits for tomorrow's start.
    expect(nextCycleAt('TRADING', saoPauloConfiguration, new Date('2026-10-01T00:00:00Z')).toISOString()).toBe('2026-10-01T12:00:00.000Z');
    // 16:49Z is 01:49 the following JST day; a stale TRADING phase before the
    // Tokyo start must wait only until 09:03 JST = 00:03Z tomorrow.
    expect(nextCycleAt('TRADING', tokyoConfiguration, new Date('2026-10-01T20:00:00Z')).toISOString()).toBe(
      '2026-10-02T00:03:00.000Z',
    );
  });
});

describe('worker scheduler boundary clamp', () => {
  it('does not jump ~24h when now lands exactly on the 16:45 stop-new-positions boundary', () => {
    const at = new Date('2026-10-01T19:45:00Z'); // exactly 16:45:00 in São Paulo
    const next = nextCycleAt('TRADING', saoPauloConfiguration, at);
    // Pre-fix the clamped target equalled `now`, so the helper added 24h and
    // parked the loop until 2026-10-02T19:45:00Z.
    expect(next.toISOString()).toBe('2026-10-01T19:48:00.000Z');
    expect(hoursBetween(at, next)).toBeLessThan(1);
    // The next run must stay inside the same session (before the 18:00 end).
    expect(next.getTime()).toBeLessThan(new Date('2026-10-01T21:00:00Z').getTime());
  });

  it('advances to the next interval slot when the clamped boundary is already in the past mid-session', () => {
    // 17:16 São Paulo is past the 17:15 force-close boundary but inside the
    // session (end 18:00); the old clamp returned tomorrow's 17:15.
    const at = new Date('2026-10-01T20:16:00Z');
    const next = nextCycleAt('NO_NEW_POSITIONS', saoPauloConfiguration, at);
    expect(next.toISOString()).toBe('2026-10-01T20:18:00.000Z');
    expect(hoursBetween(at, next)).toBeLessThan(1);

    // Walking the interval grid reaches the 18:00 session end at most, so the
    // wait stays inside the same session instead of jumping to tomorrow.
    expect(nextCycleAt('NO_NEW_POSITIONS', saoPauloConfiguration, new Date('2026-10-01T20:57:00Z')).toISOString()).toBe(
      '2026-10-01T21:00:00.000Z',
    );
  });

  it('still waits for the next day start once the session has ended', () => {
    // 18:30 São Paulo: the session is over, so tomorrow 09:00 is correct.
    expect(nextCycleAt('FINISHED', saoPauloConfiguration, new Date('2026-10-01T21:30:00Z')).toISOString()).toBe('2026-10-02T12:00:00.000Z');
    // A stale TRADING/NO_NEW_POSITIONS observation after the end must not skip
    // the session: it also targets tomorrow's start instead of rolling a
    // boundary clamp 24h forward.
    expect(nextCycleAt('TRADING', saoPauloConfiguration, new Date('2026-10-01T21:30:00Z')).toISOString()).toBe('2026-10-02T12:00:00.000Z');
    expect(nextCycleAt('NO_NEW_POSITIONS', saoPauloConfiguration, new Date('2026-10-01T21:30:00Z')).toISOString()).toBe(
      '2026-10-02T12:00:00.000Z',
    );
  });
});
