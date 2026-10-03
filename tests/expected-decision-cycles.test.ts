import { calculateExpectedDecisionCycles, type SessionSchedule } from '@bolinha/core';
import { describe, expect, it } from 'vitest';

const schedule: SessionSchedule = {
  timezone: 'America/Sao_Paulo', start: '09:00', stopNewPositions: '17:50', forceClose: '17:55', end: '18:00', intervalSeconds: 600,
};
const expected = (actualTradingStart: string | null, finishedAt: string | null, nowAt?: string) =>
  calculateExpectedDecisionCycles({
    sessionDay: '2026-10-03', schedule, actualTradingStart, finishedAt,
    ...(nowAt ? { nowAt: new Date(nowAt) } : {}),
  }).expectedDecisionCycles;

describe('expected decision cycles', () => {
  it('counts the immediate startup run and the regular full-session slots', () => {
    expect(expected('2026-10-03T12:00:00.000Z', '2026-10-03T21:00:00.000Z')).toBe(53);
  });

  it('starts counting at a late first activation, then follows fixed scheduler slots', () => {
    // 09:47 immediate, then 09:50, 10:00, ..., 17:40.
    expect(expected('2026-10-03T12:47:00.000Z', '2026-10-03T21:00:00.000Z')).toBe(49);
  });

  it('does not count the morning when the loop first starts at 14:00', () => {
    expect(expected('2026-10-03T17:00:00.000Z', '2026-10-03T21:00:00.000Z')).toBe(23);
  });

  it('keeps the original effective start through worker restarts and manual pauses', () => {
    // The caller retains the first started_at. Gaps after 09:00 remain in the
    // expected total and can therefore be diagnosed as missed cycles.
    expect(expected('2026-10-03T12:00:00.000Z', '2026-10-03T21:00:00.000Z')).toBe(53);
  });

  it('has no decision opportunities when the first activation is at stop-buy', () => {
    expect(expected('2026-10-03T20:50:00.000Z', '2026-10-03T21:00:00.000Z')).toBe(0);
  });

  it('only counts slots that have occurred for an in-progress session', () => {
    expect(expected('2026-10-03T12:00:00.000Z', null, '2026-10-03T12:25:00.000Z')).toBe(3);
  });

  it('ends at the earlier of finishedAt and stop-new-positions', () => {
    expect(expected('2026-10-03T12:00:00.000Z', '2026-10-03T16:00:00.000Z')).toBe(24);
    expect(expected('2026-10-03T12:00:00.000Z', '2026-10-03T21:00:00.000Z')).toBe(53);
  });
});
