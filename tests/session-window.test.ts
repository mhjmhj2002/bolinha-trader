import { describe, expect, it } from 'vitest';
import { sessionPhase } from '@bolinha/core';

describe('São Paulo daily session window', () => {
  const phaseAt = (iso: string) => sessionPhase(new Date(iso));
  it.each([
    ['08:59', '2026-10-01T11:59:00Z', 'BEFORE_START'],
    ['09:00', '2026-10-01T12:00:00Z', 'TRADING'],
    ['16:44', '2026-10-01T19:44:00Z', 'TRADING'],
    ['16:45', '2026-10-01T19:45:00Z', 'NO_NEW_POSITIONS'],
    ['17:14', '2026-10-01T20:14:00Z', 'NO_NEW_POSITIONS'],
    ['17:15', '2026-10-01T20:15:00Z', 'FORCE_CLOSE'],
    ['18:00', '2026-10-01T21:00:00Z', 'FINISHED'],
  ])('%s maps to %s', (_label, iso, expected) => expect(phaseAt(iso)).toBe(expected));

  it('keeps a post-close session in close-only mode when PostgreSQL reports an open position', () => {
    expect(sessionPhase(new Date('2026-10-01T21:00:00Z'), undefined, true)).toBe('FORCE_CLOSE_PENDING');
    expect(sessionPhase(new Date('2026-10-01T21:10:00Z'), undefined, true)).toBe('FORCE_CLOSE_PENDING');
  });

  it.each([
    ['02:00', '2026-10-01T05:00:00Z'],
    ['08:45', '2026-10-01T11:45:00Z'],
  ])('puts an overnight open position in FORCE_CLOSE_PENDING at %s', (_label, iso) => {
    expect(sessionPhase(new Date(iso), undefined, true)).toBe('FORCE_CLOSE_PENDING');
  });

  it('allows BEFORE_START only when no conceptual position is open', () => {
    expect(sessionPhase(new Date('2026-10-01T11:45:00Z'), undefined, false)).toBe('BEFORE_START');
  });
});
