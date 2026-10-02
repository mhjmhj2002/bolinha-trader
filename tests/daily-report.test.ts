import { buildDailyReport, formatDailyReport, type DailyReportInput } from '@bolinha/core';
import { describe, expect, it } from 'vitest';

const input = (overrides: Partial<DailyReportInput> = {}): DailyReportInput => ({
  date: '2026-10-02',
  schedule: { timezone: 'America/Sao_Paulo', start: '09:00', stopNewPositions: '17:50', forceClose: '17:55', end: '18:00' },
  session: { phase: 'FINISHED', startedAt: '2026-10-02T12:00:00.000Z', finishedAt: '2026-10-02T21:00:00.000Z', cyclesExecuted: 53 },
  bank: { initialUsdt: 20, finalUsdt: 20, netPnlUsdt: 0 },
  operations: { buy: 0, sell: 0, hold: 53, rejectedByRisk: 0, forceClose: false },
  ai: { calls: 53, costUsd: 0, fallbacks: 0, models: {} },
  infrastructure: { cyclesExpected: 53, cyclesExecuted: 53, maxCycleGapSeconds: 600, workerRestarts: 0, errors: 0, binanceErrors: 0, openRouterErrors: 0, inconsistencies: 0, reconciliationIssues: 0, pendingOrders: 0, rejectedOrders: 0 },
  finalState: { openPosition: false },
  ...overrides,
});

describe('daily operational report', () => {
  it('reports a completed day without trades as operationally OK', () => {
    const report = buildDailyReport(input());
    expect(report.status).toBe('CONCLUÍDA');
    expect(report.operations).toMatchObject({ buy: 0, sell: 0, hold: 53 });
    expect(report.operationalResult).toBe('OK');
    expect(formatDailyReport(report)).toContain('Posição aberta: NÃO');
  });

  it('calculates positive and negative return from the persisted bank snapshots', () => {
    expect(buildDailyReport(input({ bank: { initialUsdt: 20, finalUsdt: 20.1843, netPnlUsdt: 0.1843 } })).bank.returnPct).toBeCloseTo(0.9215, 4);
    const negative = buildDailyReport(input({ bank: { initialUsdt: 20, finalUsdt: 19.5, netPnlUsdt: -0.5 } }));
    expect(negative.bank.returnPct).toBe(-2.5);
    expect(formatDailyReport(negative)).toContain('Resultado líquido: -0.50000000 USDT');
  });

  it('highlights fallbacks and external errors', () => {
    const report = buildDailyReport(input({
      ai: { calls: 53, costUsd: 0.0031, fallbacks: 2, models: { Qwen: 53 } },
      infrastructure: { ...input().infrastructure, errors: 2, binanceErrors: 1, openRouterErrors: 1 },
    }));
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(['FALLBACK', 'BINANCE_ERROR', 'OPENROUTER_ERROR']));
    expect(report.operationalResult).toBe('CRÍTICO');
  });

  it('detects a worker restart and a necessary force-close', () => {
    const report = buildDailyReport(input({
      operations: { ...input().operations, forceClose: true },
      infrastructure: { ...input().infrastructure, workerRestarts: 1 },
    }));
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(['WORKER_RESTART', 'FORCE_CLOSE_NECESSARY']));
    expect(report.operationalResult).toBe('ATENÇÃO');
  });

  it('marks an unfinished session and missing cycles for attention', () => {
    const report = buildDailyReport(input({
      session: { phase: 'TRADING', startedAt: '2026-10-02T12:00:00.000Z', finishedAt: null, cyclesExecuted: 5 },
      infrastructure: { ...input().infrastructure, cyclesExecuted: 5, maxCycleGapSeconds: 1_200 },
    }));
    expect(report.status).toBe('EM ANDAMENTO');
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(['SESSION_INCOMPLETE', 'CYCLE_MISSED', 'CYCLE_DELAYED']));
  });
});
