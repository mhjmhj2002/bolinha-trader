import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { defaultTradingConfiguration, sessionPhase, validateTradingConfiguration } from '@bolinha/core';
import { nextCycleAt } from '../apps/worker/src/scheduler.ts';

const eveningConfiguration = {
  ...defaultTradingConfiguration,
  start: '18:30', stopNewPositions: '21:20', forceClose: '21:25', end: '21:30', intervalSeconds: 600,
};

describe('persisted operational configuration fixtures', () => {
  it.each([
    [defaultTradingConfiguration, '2026-10-01T12:00:00Z', 'TRADING'],
    [eveningConfiguration, '2026-10-01T21:30:00Z', 'TRADING'],
    [eveningConfiguration, '2026-10-02T00:20:00Z', 'NO_NEW_POSITIONS'],
    [eveningConfiguration, '2026-10-02T00:25:00Z', 'FORCE_CLOSE'],
    [eveningConfiguration, '2026-10-02T00:30:00Z', 'FINISHED'],
  ] as const)('uses the explicit configuration fixture at %s', (configuration, at, expected) => {
    expect(sessionPhase(new Date(at), configuration)).toBe(expected);
  });

  it('uses a changed interval and schedule without a process restart', () => {
    expect(nextCycleAt('TRADING', eveningConfiguration, new Date('2026-10-01T21:31:00Z')).toISOString()).toBe('2026-10-01T21:40:00.000Z');
  });

  it('rejects invalid operational configurations before they can start trading', () => {
    expect(() => validateTradingConfiguration({ ...defaultTradingConfiguration, forceClose: '17:49' })).toThrow(/strictly ordered/);
    expect(() => validateTradingConfiguration({ ...defaultTradingConfiguration, intervalSeconds: 0 })).toThrow(/intervalSeconds/);
    expect(() => validateTradingConfiguration({ ...defaultTradingConfiguration, timezone: 'not/a-timezone' })).toThrow(/timezone/);
  });

  it('does not embed operational times in the dashboard script', async () => {
    const dashboard = await readFile(new URL('../apps/api/public/dashboard/dashboard.js', import.meta.url), 'utf8');
    for (const value of ['09:00', '17:50', '17:55', '18:00']) expect(dashboard).not.toContain(value);
  });
});
