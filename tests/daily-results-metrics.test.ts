import { describe, expect, it } from 'vitest';
import { TradingRepository } from '@bolinha/database';

describe('TASK-39 daily_results metrics and expectation calculation', () => {
  it('correctly separates gross vs net return pct and separates AI calls from bypass count', async () => {
    // Mock database responses:
    // 1. configuration
    // 2. sessionForDay
    // 3. scheduledEnd
    // 4. performance
    // 5. openPosition
    // 6. feeSummaryForSession
    // 7. metrics (trades & ai_decisions)
    // 8. posStatsRes (positions win/loss)
    // 9. insert daily_results
    // 10. update trading_sessions
    // 11. markDailyResultOk
    // 12. dailyResult
    let insertedValues: unknown[] = [];
    const client = {
      query: async (queryText: string, params?: unknown[]) => {
        const text = queryText.toLowerCase();
        if (text.includes('from trading_configuration_versions') || text.includes('from trading_configurations')) {
          return { rows: [{ timezone: 'America/Sao_Paulo', start_time: '09:00:00', end_time: '18:00:00' }] };
        }
        if (text.includes('from trading_sessions where session_day=')) {
          return { rows: [{ phase: 'FINISHED', session_day: '2026-10-30', started_at: '2026-10-30T12:00:00Z', finished_at: '2026-10-30T21:00:00Z', initial_equity_usdt: '100' }] };
        }
        if (text.includes('select (($1::date + $2::time)')) {
          return { rows: [{ at: new Date('2026-10-30T21:00:00Z') }] };
        }
        if (text.includes('from trading_account order by id limit 1')) {
          return { rows: [{ initial_bank_usdt: '100', cash_usdt: '97.20', realized_pnl_usdt: '-2.80' }] };
        }
        if (text.includes("select coalesce(sum(gross_pnl_usdt),0) as gross from trades where side='sell'")) {
          return { rows: [{ gross: '-2.80' }] };
        }
        if (text.includes('select count(*) from trades')) {
          return { rows: [{ count: 16 }] };
        }
        if (text.includes('select asset, coalesce(sum(amount),0) as amount')) {
          return { rows: [{ asset: 'BRL', amount: '0.43', amount_usdt: '0.43' }] };
        }
        if (text.includes("from positions where status='open'")) {
          return { rows: [] };
        }
        if (text.includes('from trade_fees tf join trades t')) {
          return { rows: [{ asset: 'BRL', amount: '0.43', amount_usdt: '0.43' }] };
        }
        if (text.includes('from trades t where t.executed_at >=')) {
          return {
            rows: [{
              buy_count: 8,
              sell_count: 8,
              trade_count: 16,
              hold_count: 120,
              rejected_count: 3,
              ai_calls: 31,
              bypass_count: 123,
              ai_cost: '0.005',
              models: ['qwen/qwen3.8-27b:free'],
              fallback_count: 0,
              error_count: 0,
              forced_close: true,
              gross_pnl: '-2.80',
              net_pnl: '-3.23',
            }],
          };
        }
        if (text.includes('from positions') && text.includes('status=\'closed\'')) {
          return {
            rows: [{
              position_count: 8,
              win_count: 4,
              loss_count: 4,
              avg_win: '0.50',
              avg_loss: '1.25',
              gross_win: '2.00',
              gross_loss: '5.00',
            }],
          };
        }
        if (text.includes('insert into daily_results')) {
          insertedValues = params ?? [];
          return { rows: [] };
        }
        if (text.includes('update trading_sessions set decision_cycles=')) {
          return { rows: [] };
        }
        if (text.includes('update trading_sessions set consolidation_status=')) {
          return { rows: [] };
        }
        if (text.includes('from daily_results where session_day=')) {
          return {
            rows: [{
              session_day: '2026-10-30',
              gross_return_pct: insertedValues[11],
              net_return_pct: insertedValues[12],
              ai_call_count: insertedValues[18],
              bypass_count: insertedValues[19],
              rate_limit_429_count: insertedValues[23],
              position_count: insertedValues[28],
              win_count: insertedValues[29],
              loss_count: insertedValues[30],
              avg_win_usdt: insertedValues[31],
              avg_loss_usdt: insertedValues[32],
              profit_factor: insertedValues[33],
              expectancy_usdt: insertedValues[34],
              fees_pct_of_gross: insertedValues[35],
            }],
          };
        }
        return { rows: [] };
      },
    };

    const repo = new TradingRepository(client as never);
    // Initial bank = 100, gross_pnl = -2.80 => grossReturnPct = -2.80%
    // Performance equity = 97.20 (if net pnl is around -2.80/3.01)
    const result = await repo.createDailyResult(30, new Date('2026-10-30T21:00:00Z'));
    expect(result).not.toBeNull();

    // Verify gross return is calculated as gross_pnl / initial_equity
    // grossPnl = -2.80, initial = 100 => -2.8%
    expect(result?.gross_return_pct).toBeCloseTo(-2.8, 2);

    // Verify AI calls vs bypass count distinction
    expect(result?.ai_call_count).toBe(31);
    expect(result?.bypass_count).toBe(123);

    // Verify position stats
    expect(result?.position_count).toBe(8);
    expect(result?.win_count).toBe(4);
    expect(result?.loss_count).toBe(4);
    expect(result?.avg_win_usdt).toBe(0.50);
    expect(result?.avg_loss_usdt).toBe(1.25);

    // Profit Factor = gross_win (2.00) / gross_loss (5.00) = 0.40
    expect(result?.profit_factor).toBe(0.4);

    // Expectancy = (winRate * avgWin) - (lossRate * avgLoss)
    // = (0.5 * 0.50) - (0.5 * 1.25) = 0.25 - 0.625 = -0.375 R$
    expect(result?.expectancy_usdt).toBe(-0.375);

    // Fees % of gross = 0.43 / 2.80 * 100 = 15.357%
    expect(result?.fees_pct_of_gross).toBeCloseTo(15.357, 1);
  });
});
