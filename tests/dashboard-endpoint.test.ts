import { afterAll, describe, expect, it } from 'vitest';
import { dashboardApp } from '../apps/api/src/index.ts';

describe('dashboard endpoints', () => {
  afterAll(async () => { await dashboardApp.close(); });

  it('serves the dashboard shell and rejects an invalid historical date before querying data', async () => {
    const page = await dashboardApp.inject({ method: 'GET', url: '/dashboard' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Operação Bolinha de Gude');

    const data = await dashboardApp.inject({ method: 'GET', url: '/dashboard/data?date=not-a-date' });
    expect(data.statusCode).toBe(400);
    expect(data.json()).toEqual({ error: 'date must use YYYY-MM-DD' });
  });
});
