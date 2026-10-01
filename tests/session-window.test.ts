import { describe, expect, it } from 'vitest';
import { sessionPhase } from '@bolinha/core';

describe('São Paulo daily session window', () => {
  const phaseAt = (iso: string) => sessionPhase(new Date(iso));
  it.each([
    ['08:59', '2026-10-01T11:59:00Z', 'BEFORE_START'],
    ['09:00', '2026-10-01T12:00:00Z', 'TRADING'],
    ['17:49', '2026-10-01T20:49:00Z', 'TRADING'],
    ['17:50', '2026-10-01T20:50:00Z', 'NO_NEW_POSITIONS'],
    ['17:55', '2026-10-01T20:55:00Z', 'FORCE_CLOSE'],
    ['18:00', '2026-10-01T21:00:00Z', 'FINISHED'],
  ])('%s maps to %s', (_label, iso, expected) => expect(phaseAt(iso)).toBe(expected));
});
