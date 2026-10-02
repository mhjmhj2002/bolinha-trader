import { describe, expect, it } from 'vitest';
import { TradingRepository } from '@bolinha/database';

const result = (rows: Record<string, unknown>[]) => ({ rows });
const dashboardRepository = (responses: Array<Record<string, unknown>[]>) => {
  const client = { query: async () => result(responses.shift() ?? []) };
  return new TradingRepository(client as never);
};

describe('dashboard/data aggregation', () => {
  it('builds a safe completed-day payload with position, P/L, model usage and incidents', async () => {
    const repo = dashboardRepository([
      [{ initial_bank_usdt: '20', cash_usdt: '18', realized_pnl_usdt: '-1', ai_cost_usd: '0.9' }],
      [{ session_day: '2026-09-30', phase: 'FINISHED', timezone: 'America/Sao_Paulo', started_at: '2026-09-30T12:00:00Z', finished_at: '2026-09-30T21:00:00Z', last_cycle_at: '2026-09-30T20:50:00Z', next_cycle_at: null, cycles_today: '53' }],
      [{ initial_equity_usdt: '20', final_equity_usdt: '20.5', realized_pnl_usdt: '0.2', unrealized_pnl_usdt: '0', net_pnl_usdt: '0.5', ai_cost_usd: '0.0021', trade_count: '2', buy_count: '1', sell_count: '1', hold_count: '50', rejected_decision_count: '1', fees_usdt_known: '0.01', fallback_count: '1', error_count: '1', forced_close_occurred: false }],
      [{ cash_usdt: '10', equity_usdt: '20.5', realized_pnl_usdt: '0.2', unrealized_pnl_usdt: '0.3', net_pnl_usdt: '0.5', price: '105000', position_quantity: '0.0001', position_cost_usdt: '10', created_at: '2026-09-30T20:50:00Z' }],
      [{ side: 'SELL', quantity: '0.0001', quote_amount: '10.5', net_quantity: '0.0001', net_quote_amount: '10.49', gross_pnl_usdt: '0.5', fees_usdt_known: '0.01', net_pnl_usdt: '0.49', executed_at: '2026-09-30T20:00:00Z', binance_order_id: 'binance-1' }],
      [
        { timestamp: '2026-09-30T20:00:00Z', model_returned: 'Qwen', model_requested: 'fallback', action_requested: 'BUY', action_after_risk: 'HOLD', amount_requested: '10', amount_after_risk: '0', confidence: 0.8, reason: 'risk', rejection_reason: 'max position', raw_response: 'must not leak' },
        { timestamp: '2026-09-30T19:00:00Z', model_returned: 'Qwen', model_requested: 'Qwen', action_requested: 'SELL', action_after_risk: 'SELL', amount_requested: '10', amount_after_risk: '10', confidence: 0.9, reason: 'exit', rejection_reason: null },
      ],
      [{ model: 'Qwen', calls: '2', prompt_tokens: '50', completion_tokens: '20', total_tokens: '70', cost_usd: '0.0021' }],
      [{ level: 'ERROR', event: 'ai_error', message: 'Rate limited', payload: { OPENROUTER_API_KEY: 'must not leak' }, created_at: '2026-09-30T20:00:00Z' }, { level: 'WARN', event: 'ai_fallback', message: 'Fallback', created_at: '2026-09-30T19:00:00Z' }],
    ]);

    const data = await repo.dashboardData('2026-09-30');

    expect(data.performance).toMatchObject({ netPnlUsdt: 0.5, returnPct: 2.5 });
    expect(data.position).toMatchObject({ symbol: 'BTC', quantity: 0.0001 });
    expect(data.decisionCounts).toEqual({ BUY: 0, SELL: 1, HOLD: 1, rejectedByRisk: 1 });
    expect(data.aiUsage).toMatchObject({ fallbacks: 1, totalTokens: 70, totalCostUsd: 0.0021 });
    expect(data.aiUsage.models[0]).toMatchObject({ model: 'Qwen', calls: 2 });
    expect(data.events).toEqual([expect.objectContaining({ level: 'ERROR', message: 'Rate limited' }), expect.objectContaining({ level: 'WARN', event: 'ai_fallback' })]);
    expect(data.summary).toMatchObject({ final: true, tradeCount: 2, errorCount: 1 });
    expect(JSON.stringify(data)).not.toContain('must not leak');
    expect(JSON.stringify(data)).not.toContain('raw_response');
  });

  it('supports a quiet day without trades, decisions, snapshots, or events', async () => {
    const repo = dashboardRepository([
      [{ initial_bank_usdt: '20', cash_usdt: '20', realized_pnl_usdt: '0', ai_cost_usd: '0' }], [], [], [], [], [], [], [],
    ]);
    const data = await repo.dashboardData('2026-09-29');
    expect(data.trades).toEqual([]);
    expect(data.decisions).toEqual([]);
    expect(data.equityHistory).toEqual([]);
    expect(data.decisionCounts).toEqual({ BUY: 0, SELL: 0, HOLD: 0, rejectedByRisk: 0 });
    expect(data.eventCounts.errors).toBe(0);
  });
});
