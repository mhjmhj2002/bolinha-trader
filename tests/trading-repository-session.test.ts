import { describe, expect, it } from 'vitest';
import { TradingRepository } from '@bolinha/database';

type Query = { text: string; values?: unknown[] };

const sessionRepository = () => {
  const queries: Query[] = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rows: [] };
    },
  };
  return { queries, repo: new TradingRepository(client as never) };
};

describe('TradingRepository.updateSession', () => {
  it.each(['TRADING', 'FINISHED'] as const)('binds %s with explicit PostgreSQL types', async (phase) => {
    const { queries, repo } = sessionRepository();
    const at = new Date('2026-10-01T12:00:00.000Z');

    await expect(repo.updateSession(phase, null, at)).resolves.toMatchObject({ changed: true });

    const update = queries[1];
    expect(update.values).toEqual(['2026-10-01', 'America/Sao_Paulo', phase, at, null]);
    expect(update.text).toContain('$1::date');
    expect(update.text).toContain('$2::varchar(64)');
    expect(update.text).toContain('$3::varchar(32)');
    expect(update.text).toContain('$4::timestamptz');
    expect(update.text).toContain('$5::timestamptz');
    expect(update.text).toContain("$3::varchar(32)='TRADING'::varchar(32)");
    expect(update.text).toContain("$3::varchar(32)='FINISHED'::varchar(32)");
  });
});
