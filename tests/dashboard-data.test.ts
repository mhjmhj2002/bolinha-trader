import { describe, expect, it } from 'vitest';
import { config, sessionDay } from '@bolinha/core';
import { TradingRepository } from '@bolinha/database';
// Side-effect import of the browser script: it publishes its pure helpers on
// `globalThis.DashboardPnl` before any DOM wiring and returns early when there
// is no `document`, so no DOM emulation is needed.
import '../apps/api/public/dashboard/dashboard.js';

/**
 * BUG-10 parte B: `dashboard.js` is a plain browser script and this repo has no
 * jsdom environment. The presentation logic (labels, breakdown, badge, tooltip,
 * cash message, open P/L) was therefore extracted into pure functions exposed
 * as `globalThis.DashboardPnl` (and `module.exports` when available) so it can
 * be asserted directly here.
 */
type DashboardPnlApi = {
  RESULT_LABEL: string;
  UNREALIZED_BADGE_TEXT: string;
  TRADE_PNL_PENDING_TEXT: string;
  pnlBreakdown: (performance?: { realizedPnlUsdt?: number | null; unrealizedPnlUsdt?: number | null }) => string;
  unrealizedBadge: (position: unknown, realizedPnlUsdt: number | null) => string;
  openPnl: (position: { quantity: number | null; costUsdt: number | null; price: number | null } | null) => { pnlUsdt: number | null; pct: number | null };
  positionDetail: (position: { quantity: number | null; costUsdt: number | null; price: number | null } | null) => string;
  cashDetail: (cashUsdt: number | null, price: number | null) => string;
  tradePnl: (trade: { side: string; netPnlUsdt: number | null }) => { text: string; title: string; tone: string };
};
const DashboardPnl = (globalThis as unknown as { DashboardPnl: DashboardPnlApi }).DashboardPnl;
const openPosition = { symbol: config.SYMBOL.replace('USDT', ''), quantity: 3, costUsdt: 89.76, price: 29.94 };

const result = (rows: Record<string, unknown>[]) => ({ rows });
const dashboardRepository = (responses: Array<Record<string, unknown>[]>) => {
  const client = { query: async () => result(responses.shift() ?? []) };
  return new TradingRepository(client as never);
};
/**
 * Fixture order is strict: `dashboardData` enqueues its reads in this order and
 * the fake client shifts one response per query. Any new read must be appended
 * (never inserted) so at least the historical fixtures keep their meaning.
 *  1 account · 2 session · 3 daily_result · 4 account_snapshots · 5 trades
 *  6 decisions · 7 ai_usage · 8 system_events · 9 decision counts
 *  10 open position (transactional truth for the current day)
 */
const historicalFixtures = (overrides: Partial<Record<number, Record<string, unknown>[]>> = {}) => {
  const base: Array<Record<string, unknown>[]> = [[], [], [], [], [], [], [], [], [], []];
  for (const [index, rows] of Object.entries(overrides)) base[Number(index) - 1] = rows;
  return base;
};

describe('dashboard P/L wording (BUG-10 parte B — unrealized is not realized)', () => {
  it('labels the result card as including the unrealized part and splits it in the breakdown', () => {
    expect(DashboardPnl.RESULT_LABEL).toBe('Resultado (inclui não realizado)');
    expect(DashboardPnl.pnlBreakdown({ realizedPnlUsdt: 0, unrealizedPnlUsdt: 0.06 })).toBe('Realizado: +0,00 R$ · Em aberto: +0,06 R$');
    // Null tolerance: never fabricate a number when the ledger cannot value it.
    expect(DashboardPnl.pnlBreakdown({ realizedPnlUsdt: null, unrealizedPnlUsdt: null })).toBe('Realizado: — · Em aberto: —');
  });

  it('shows the "posição aberta — lucro não realizado" badge only with an open position and zero realized P/L', () => {
    expect(DashboardPnl.unrealizedBadge(openPosition, 0)).toBe('posição aberta — lucro não realizado');
    expect(DashboardPnl.unrealizedBadge(null, 0)).toBe('');
    expect(DashboardPnl.unrealizedBadge(openPosition, 0.9659)).toBe('');
  });

  it('reports the open position P/L in R$ and % next to cost and current price', () => {
    const { pnlUsdt, pct } = DashboardPnl.openPnl(openPosition);
    expect(pnlUsdt).toBeCloseTo(0.06, 6);
    expect(pct).toBeCloseTo(0.0668, 4);
    expect(DashboardPnl.positionDetail(openPosition)).toBe('Custo: R$ 89,76 (Médio: R$ 29,92) · P/L aberto: +0,06 R$ (+0,07%) · Atual: R$ 29,94');
    expect(DashboardPnl.positionDetail(null)).toBe('—');
    // No trustworthy price => R$ and % stay unknown.
    const unknown = DashboardPnl.openPnl({ quantity: 3, costUsdt: 89.76, price: null });
    expect(unknown).toEqual({ pnlUsdt: null, pct: null });
    expect(DashboardPnl.positionDetail({ quantity: 3, costUsdt: 89.76, price: null })).toContain('P/L aberto: — (—)');
  });

  it('marks the P/L of a BUY with no sale as "—" and explains it in the tooltip', () => {
    expect(DashboardPnl.TRADE_PNL_PENDING_TEXT).toBe('P/L só é apurado na venda');
    expect(DashboardPnl.tradePnl({ side: 'BUY', netPnlUsdt: null })).toEqual({ text: '—', title: 'P/L só é apurado na venda', tone: '' });
    expect(DashboardPnl.tradePnl({ side: 'SELL', netPnlUsdt: 0.9659 })).toEqual({ text: '+0,97 R$', title: '', tone: 'text-success' });
  });

  it('explains insufficient cash instead of reporting a meaningless "até 0 ação(ões)"', () => {
    expect(DashboardPnl.cashDetail(10.2359, 29.94)).toBe('Caixa insuficiente para nova compra (mín. 1 ação = R$ 29,94)');
    expect(DashboardPnl.cashDetail(0, 29.94)).toBe('Caixa insuficiente para nova compra (mín. 1 ação = R$ 29,94)');
    expect(DashboardPnl.cashDetail(100, 29.94)).toBe('Comportamento: até 3 ação(ões)');
    // Null tolerance: no price and no cash => no invented quantity.
    expect(DashboardPnl.cashDetail(10.2359, null)).toBe('Disponível para compras');
    expect(DashboardPnl.cashDetail(null, 29.94)).toBe('Disponível para compras');
  });
});

describe('dashboard/data aggregation', () => {
  it('builds a safe completed-day payload with position, P/L, model usage and incidents', async () => {
    const repo = dashboardRepository(historicalFixtures({
      1: [{ initial_bank_usdt: '20', cash_usdt: '18', realized_pnl_usdt: '-1', ai_cost_usd: '0.9' }],
      2: [{ session_day: '2026-09-30', phase: 'FINISHED', timezone: 'America/Sao_Paulo', start_time: '18:30:00', stop_new_positions_time: '21:20:00', force_close_time: '21:25:00', end_time: '21:30:00', interval_seconds: '600', started_at: '2026-09-30T21:30:00Z', finished_at: '2026-10-01T00:30:00Z', last_cycle_at: '2026-10-01T00:20:00Z', next_cycle_at: null, cycles_today: '17' }],
      3: [{ initial_equity_usdt: '20', final_equity_usdt: '20.5', realized_pnl_usdt: '0.2', unrealized_pnl_usdt: '0', net_pnl_usdt: '0.5', ai_cost_usd: '0.0021', trade_count: '2', buy_count: '1', sell_count: '1', hold_count: '50', rejected_decision_count: '1', fees_usdt_known: '0.01', fallback_count: '1', error_count: '1', forced_close_occurred: false }],
      4: [{ cash_usdt: '10', equity_usdt: '20.5', realized_pnl_usdt: '0.2', unrealized_pnl_usdt: '0.3', net_pnl_usdt: '0.5', price: '105000', position_quantity: '0.0001', position_cost_usdt: '10', created_at: '2026-09-30T20:50:00Z' }],
      5: [{ side: 'SELL', quantity: '0.0001', quote_amount: '10.5', net_quantity: '0.0001', net_quote_amount: '10.49', gross_pnl_usdt: '0.5', fees_usdt_known: '0.01', net_pnl_usdt: '0.49', executed_at: '2026-09-30T20:00:00Z', binance_order_id: 'binance-1' }],
      6: [
        { timestamp: '2026-09-30T20:00:00Z', model_returned: 'Qwen', model_requested: 'fallback', action_requested: 'BUY', action_after_risk: 'HOLD', amount_requested: '10', amount_after_risk: '0', confidence: 0.8, reason: 'risk', rejection_reason: 'max position', raw_response: 'must not leak' },
        { timestamp: '2026-09-30T19:00:00Z', model_returned: 'Qwen', model_requested: 'Qwen', action_requested: 'SELL', action_after_risk: 'SELL', amount_requested: '10', amount_after_risk: '10', confidence: 0.9, reason: 'exit', rejection_reason: null },
      ],
      7: [{ model: 'Qwen', calls: '2', prompt_tokens: '50', completion_tokens: '20', total_tokens: '70', cost_usd: '0.0021' }],
      8: [{ level: 'ERROR', event: 'ai_error', message: 'Rate limited', payload: { OPENROUTER_API_KEY: 'must not leak' }, created_at: '2026-09-30T20:00:00Z' }, { level: 'WARN', event: 'ai_fallback', message: 'Fallback', created_at: '2026-09-30T19:00:00Z' }],
      9: [
        { action_after_risk: 'HOLD', count: 1, rejected_by_risk: 1 },
        { action_after_risk: 'SELL', count: 1, rejected_by_risk: 0 },
      ],
    }));

    const data = await repo.dashboardData('2026-09-30');

    expect(data.account).toMatchObject({
      initialBankUsdt: 20,
      cashUsdt: 10,
      equityUsdt: 20.5,
      positionCostUsdt: 10,
      positionMarketValueUsdt: 10.5,
    });
    expect(data.performance).toMatchObject({ realizedPnlUsdt: 0.2, unrealizedPnlUsdt: 0.5, netPnlUsdt: 0.5, returnPct: 2.5 });
    expect(data.position).toMatchObject({ symbol: config.SYMBOL.replace('USDT', ''), quantity: 0.0001 });
    expect(data.decisionCounts).toEqual({ BUY: 0, SELL: 1, HOLD: 1, rejectedByRisk: 1 });
    expect(data.aiUsage).toMatchObject({ fallbacks: 1, totalTokens: 70, totalCostUsd: 0.0021 });
    expect(data.aiUsage.models[0]).toMatchObject({ model: 'Qwen', calls: 2 });
    expect(data.events).toEqual([expect.objectContaining({ level: 'ERROR', message: 'Rate limited' }), expect.objectContaining({ level: 'WARN', event: 'ai_fallback' })]);
    expect(data.summary).toMatchObject({ final: true, tradeCount: 2, errorCount: 1 });
    expect(data.schedule).toEqual({ timezone: 'America/Sao_Paulo', startTime: '18:30', stopNewPositionsTime: '21:20', forceCloseTime: '21:25', endTime: '21:30', intervalSeconds: 600 });
    expect(JSON.stringify(data)).not.toContain('must not leak');
    expect(JSON.stringify(data)).not.toContain('raw_response');
  });

  it('accurately counts decisions for the entire day even when > 100 decisions exist (BUG-09)', async () => {
    // 100 HOLD decisions returned in the paginated query
    const paginated100Holds = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 9, 19, 10, i % 60, 0)).toISOString(),
      model_returned: 'Qwen',
      model_requested: 'Qwen',
      action_requested: 'HOLD',
      action_after_risk: 'HOLD',
      amount_requested: '0',
      amount_after_risk: '0',
      confidence: 0.95,
      reason: 'hold',
      rejection_reason: null,
    }));

    // But for the whole day, there were 2 BUYs, 1 SELL, 120 HOLDs, and 3 rejected by risk
    const fullDayDecisionCounts = [
      { action_after_risk: 'BUY', count: 2, rejected_by_risk: 1 },
      { action_after_risk: 'SELL', count: 1, rejected_by_risk: 0 },
      { action_after_risk: 'HOLD', count: 120, rejected_by_risk: 2 },
    ];

    const repo = dashboardRepository(historicalFixtures({
      1: [{ initial_bank_usdt: '100', cash_usdt: '100', realized_pnl_usdt: '5', ai_cost_usd: '0.05' }],
      2: [{ session_day: '2026-10-19', phase: 'RUNNING', timezone: 'America/Sao_Paulo' }],
      6: paginated100Holds, // Paginated decisions limit 100 only contains HOLDs
      9: fullDayDecisionCounts, // Aggregated count query for full day
    }));

    const data = await repo.dashboardData('2026-10-19');

    // decisions array length is 100
    expect(data.decisions.length).toBe(100);
    // decisionCounts reflects the entire day including BUY and SELL from earlier
    expect(data.decisionCounts).toEqual({
      BUY: 2,
      SELL: 1,
      HOLD: 120,
      rejectedByRisk: 3,
    });
  });

  it('supports a quiet day without trades, decisions, snapshots, or events', async () => {
    const repo = dashboardRepository(historicalFixtures({
      1: [{ initial_bank_usdt: '20', cash_usdt: '20', realized_pnl_usdt: '0', ai_cost_usd: '0' }],
    }));
    const data = await repo.dashboardData('2026-09-29');
    expect(data.trades).toEqual([]);
    expect(data.decisions).toEqual([]);
    expect(data.equityHistory).toEqual([]);
    expect(data.decisionCounts).toEqual({ BUY: 0, SELL: 0, HOLD: 0, rejectedByRisk: 0 });
    expect(data.eventCounts.errors).toBe(0);
  });

  it('reflects the post-sale ledger on the current day after a force close with no new cycle (BUG-10 parte C)', async () => {
    // The last account_snapshot of the day predates the force close: it still
    // carries the pre-sale cash and the 3 shares. The ledger says the position
    // was sold and R$ 100,9659 came back. The panel must follow the ledger.
    const repo = dashboardRepository([
      [{ initial_bank_usdt: '100', cash_usdt: '100.9659', realized_pnl_usdt: '0.9659', ai_cost_usd: '0.05' }],
      [{ session_day: sessionDay(), phase: 'FORCE_CLOSE_PENDING', timezone: 'America/Sao_Paulo', interval_seconds: '60' }],
      [],
      [
        { cash_usdt: '10.24', equity_usdt: '100.69', realized_pnl_usdt: '0.9659', unrealized_pnl_usdt: '0.69', net_pnl_usdt: '1.6559', price: '29.94', position_quantity: '3', position_cost_usdt: '89.76', created_at: `${sessionDay()}T20:48:00Z` },
      ],
      [
        { side: 'BUY', quantity: '3', quote_amount: '89.79', net_quantity: '3', net_quote_amount: '89.79', gross_pnl_usdt: null, fees_usdt_known: '0.03', net_pnl_usdt: null, executed_at: `${sessionDay()}T20:30:00Z`, broker_order_id: 'buy-1' },
        { side: 'SELL', quantity: '3', quote_amount: '90.75', net_quantity: '3', net_quote_amount: '90.75', gross_pnl_usdt: '0.99', fees_usdt_known: '0.03', net_pnl_usdt: '0.9659', executed_at: `${sessionDay()}T20:55:00Z`, broker_order_id: 'sell-1' },
      ],
      [],
      [],
      [{ level: 'WARN', event: 'force_close_completed', message: 'Forced close completed', created_at: `${sessionDay()}T20:55:00Z` }],
      [{ action_after_risk: 'BUY', count: 1, rejected_by_risk: 0 }, { action_after_risk: 'HOLD', count: 4, rejected_by_risk: 0 }],
      [], // positions WHERE status='OPEN' => closed by the force close
    ]);

    const data = await repo.dashboardData(sessionDay());

    expect(data.account.cashUsdt).toBeCloseTo(100.9659, 4);
    expect(data.account.positionCostUsdt).toBe(0);
    expect(data.account.positionMarketValueUsdt).toBe(0);
    expect(data.position).toBeNull();
    expect(data.performance.unrealizedPnlUsdt).toBe(0);
    expect(data.account.equityUsdt).toBe(data.account.cashUsdt);
    expect(data.performance.netPnlUsdt).toBe(data.performance.realizedPnlUsdt);
    expect(data.performance.realizedPnlUsdt).toBeCloseTo(0.9659, 4);
    // The pre-sale snapshot still feeds the historical chart.
    expect(data.equityHistory).toHaveLength(1);
    expect(data.equityHistory[0].cashUsdt).toBeCloseTo(10.24, 2);
    expect(data.summary).toBeNull();
  });

  it('keeps the free cash equal to the real database cash when the session is FINISHED (BUG-10 parte C)', async () => {
    const repo = dashboardRepository([
      [{ initial_bank_usdt: '100', cash_usdt: '100.9659', realized_pnl_usdt: '0.9659', ai_cost_usd: '0.05' }],
      [{ session_day: sessionDay(), phase: 'FINISHED', timezone: 'America/Sao_Paulo', interval_seconds: '60', finished_at: `${sessionDay()}T21:00:00Z` }],
      [{ initial_equity_usdt: '100', final_equity_usdt: '100.9659', realized_pnl_usdt: '0.9659', unrealized_pnl_usdt: '0', net_pnl_usdt: '0.9659', ai_cost_usd: '0.05', trade_count: '2', buy_count: '1', sell_count: '1', hold_count: '4', rejected_decision_count: '0', fees_usdt_known: '0.06', fallback_count: '0', error_count: '0', forced_close_occurred: true }],
      [
        { cash_usdt: '10.24', equity_usdt: '100.69', realized_pnl_usdt: '0.9659', unrealized_pnl_usdt: '0.69', net_pnl_usdt: '1.6559', price: '29.94', position_quantity: '3', position_cost_usdt: '89.76', created_at: `${sessionDay()}T20:48:00Z` },
      ],
      [
        { side: 'SELL', quantity: '3', quote_amount: '90.75', net_quantity: '3', net_quote_amount: '90.75', gross_pnl_usdt: '0.99', fees_usdt_known: '0.03', net_pnl_usdt: '0.9659', executed_at: `${sessionDay()}T20:55:00Z`, broker_order_id: 'sell-1' },
      ],
      [], [], [], [], [],
    ]);

    const data = await repo.dashboardData(sessionDay());

    expect(data.session?.phase).toBe('FINISHED');
    // R$ 100,97 — the real cash, never the R$ 10,24 of the stale snapshot.
    expect(data.account.cashUsdt).toBeCloseTo(100.97, 2);
    expect(data.account.cashUsdt).not.toBeCloseTo(10.24, 2);
    expect(data.account.equityUsdt).toBeCloseTo(100.9659, 4);
    expect(data.position).toBeNull();
    expect(data.performance.unrealizedPnlUsdt).toBe(0);
    expect(data.performance.netPnlUsdt).toBeCloseTo(0.9659, 4);
    expect(data.summary?.final).toBe(true);
  });

  it('derives an open position from the ledger instead of the stale snapshot (BUG-10 parte C)', async () => {
    const repo = dashboardRepository([
      [{ initial_bank_usdt: '100', cash_usdt: '10.2359', realized_pnl_usdt: '0', ai_cost_usd: '0.05' }],
      [{ session_day: sessionDay(), phase: 'TRADING', timezone: 'America/Sao_Paulo', interval_seconds: '60' }],
      [],
      [{ cash_usdt: '10.2359', equity_usdt: '100.06', realized_pnl_usdt: '0', unrealized_pnl_usdt: '0.06', net_pnl_usdt: '0.06', price: '29.94', position_quantity: '3', position_cost_usdt: '89.76', created_at: `${sessionDay()}T20:40:00Z` }],
      [], [], [], [], [],
      [{ quantity: '3', entry_price: '29.92', cost_usdt: '89.76' }],
    ]);

    const data = await repo.dashboardData(sessionDay());

    expect(data.position).toMatchObject({ quantity: 3, costUsdt: 89.76 });
    expect(data.account.positionCostUsdt).toBe(89.76);
    expect(data.account.positionMarketValueUsdt).toBe(89.82);
    expect(data.performance.unrealizedPnlUsdt).toBeCloseTo(0.06, 6);
    expect(data.account.equityUsdt).toBeCloseTo(data.account.cashUsdt! + 89.82, 6);
    expect(data.performance.netPnlUsdt).toBeCloseTo(data.performance.realizedPnlUsdt + 0.06, 6);
  });

  it('keeps netPnl = realized + unrealized and realized = 0 when there is no SELL (BUG-10 parte B)', async () => {
    // The reported incident: 1 BUY (3 × R$ 29,91, fee R$ 0,03), open position
    // costing R$ 89,76, last price R$ 29,94 => +R$ 0,06 floating and R$ 0,00
    // realized. The profit is unrealized, never a calculation error.
    const repo = dashboardRepository(historicalFixtures({
      1: [{ initial_bank_usdt: '100', cash_usdt: '10.2359', realized_pnl_usdt: '0', ai_cost_usd: '0.05' }],
      2: [{ session_day: sessionDay(), phase: 'TRADING', timezone: 'America/Sao_Paulo', interval_seconds: '60' }],
      4: [{ cash_usdt: '10.2359', equity_usdt: '100.06', realized_pnl_usdt: '0', unrealized_pnl_usdt: '0.06', net_pnl_usdt: '0.06', price: '29.94', position_quantity: '3', position_cost_usdt: '89.76', created_at: `${sessionDay()}T20:40:00Z` }],
      5: [{ side: 'BUY', quantity: '3', quote_amount: '89.79', net_quantity: '3', net_quote_amount: '89.79', gross_pnl_usdt: null, fees_usdt_known: '0.03', net_pnl_usdt: null, executed_at: `${sessionDay()}T20:30:00Z`, broker_order_id: 'buy-1' }],
      10: [{ quantity: '3', entry_price: '29.92', cost_usdt: '89.76' }],
    }));

    const data = await repo.dashboardData(sessionDay());

    expect(data.trades.map((trade) => trade.side)).toEqual(['BUY']);
    expect(data.trades[0].netPnlUsdt).toBeNull();
    expect(data.performance.realizedPnlUsdt).toBe(0);
    expect(data.performance.unrealizedPnlUsdt).toBeCloseTo(0.06, 6);
    expect(data.performance.netPnlUsdt).toBeCloseTo((data.performance.realizedPnlUsdt ?? 0) + (data.performance.unrealizedPnlUsdt ?? 0), 6);
    expect(data.position).not.toBeNull();
    // The panel must render this as an open (floating) result, with the badge.
    expect(DashboardPnl.unrealizedBadge(data.position, data.performance.realizedPnlUsdt)).toBe('posição aberta — lucro não realizado');
    expect(DashboardPnl.pnlBreakdown(data.performance)).toBe('Realizado: +0,00 R$ · Em aberto: +0,06 R$');
    expect(DashboardPnl.tradePnl(data.trades[0]).title).toBe('P/L só é apurado na venda');
  });

  it('never fabricates equity when the current-day ledger has an open position but no trustworthy price', async () => {
    const repo = dashboardRepository([
      [{ initial_bank_usdt: '100', cash_usdt: '10.2359', realized_pnl_usdt: '0', ai_cost_usd: '0' }],
      [{ session_day: sessionDay(), phase: 'TRADING', timezone: 'America/Sao_Paulo', interval_seconds: '60' }],
      [], // no snapshot => no last observed price
      [], [], [], [], [], [],
      [{ quantity: '3', entry_price: '29.92', cost_usdt: '89.76' }],
    ]);

    const data = await repo.dashboardData(sessionDay());

    expect(data.account.equityUsdt).toBeNull();
    expect(data.account.positionMarketValueUsdt).toBeNull();
    expect(data.performance.unrealizedPnlUsdt).toBeNull();
    expect(data.performance.netPnlUsdt).toBeNull();
    expect(data.performance.returnPct).toBeNull();
  });
});
