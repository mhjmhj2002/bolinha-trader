import { defaultTradingConfiguration, formatOperationalDateTime } from '@bolinha/core';
import { configurationEditabilityFromState } from '@bolinha/database';
import { describe, expect, it } from 'vitest';

const atTrading = new Date('2026-10-03T12:47:30.000Z'); // 09:47:30 in São Paulo
const clean = { status: 'OK' as const, stateConsistent: true, lastReconciliationAt: null, lastError: null };

describe('operational configuration editability', () => {
  it('allows editing inside the trading window when the loop is off and state is clean', () => {
    expect(configurationEditabilityFromState(atTrading, defaultTradingConfiguration, false, false, 0, clean))
      .toMatchObject({ editable: true, reason: null, message: null, sessionPhase: 'TRADING' });
  });

  it('blocks an active loop inside the trading window with its specific reason', () => {
    expect(configurationEditabilityFromState(atTrading, defaultTradingConfiguration, true, false, 0, clean))
      .toMatchObject({ editable: false, reason: 'LOOP_ACTIVE', message: 'Trading em execução. A configuração não pode ser alterada durante a sessão ativa.' });
  });

  it('blocks a position outside the normal trading window', () => {
    expect(configurationEditabilityFromState(new Date('2026-10-03T11:00:00.000Z'), defaultTradingConfiguration, false, true, 0, clean))
      .toMatchObject({ editable: false, reason: 'OPEN_POSITION', message: 'Existe uma posição aberta. Feche a posição antes de alterar a configuração.' });
  });

  it('blocks pending orders and failed reconciliation even when the loop is off', () => {
    expect(configurationEditabilityFromState(atTrading, defaultTradingConfiguration, false, false, 1, clean))
      .toMatchObject({ editable: false, reason: 'PENDING_ORDER', message: 'Existe uma ordem pendente de reconciliação.' });
    expect(configurationEditabilityFromState(atTrading, defaultTradingConfiguration, false, false, 0, { ...clean, status: 'ERROR' }))
      .toMatchObject({ editable: false, reason: 'RECONCILIATION_NOT_OK' });
  });

  it('reports an advisory-lock conflict as a running operational cycle', () => {
    expect(configurationEditabilityFromState(atTrading, defaultTradingConfiguration, false, false, 0, clean, true))
      .toMatchObject({ editable: false, reason: 'CYCLE_RUNNING' });
    expect(configurationEditabilityFromState(new Date('2026-10-03T20:56:00.000Z'), defaultTradingConfiguration, false, false, 0, clean, true))
      .toMatchObject({ editable: false, reason: 'FORCE_CLOSE_RUNNING' });
  });
});

describe('operator CLI timestamps', () => {
  it('formats cycle instants in the persisted operational timezone without changing their UTC value', () => {
    const persistedInstant = new Date('2026-10-03T12:47:30.000Z');
    expect(formatOperationalDateTime(persistedInstant, 'America/Sao_Paulo')).toBe('03/10/2026 09:47:30');
    expect(persistedInstant.toISOString()).toBe('2026-10-03T12:47:30.000Z');
  });
});
