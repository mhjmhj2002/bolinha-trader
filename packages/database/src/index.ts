import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config, sessionDay, type Account, type Position, type SessionPhase } from '@bolinha/core';
import type { AiDecision, AiUsage } from '@bolinha/ai';
import type { MarketSnapshot } from '@bolinha/market-data';
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
export const db = drizzle(pool); // Drizzle is the ORM boundary; explicit SQL below keeps ledger transactions auditable.
type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value);
export class TradingRepository {
  constructor(private client: pg.Pool = pool) {}
  async health() {
    await this.client.query('select 1');
    return true;
  }
  async ensureAccount(initial: number): Promise<Account> {
    await this.client.query(
      'insert into trading_account (initial_bank_usdt,cash_usdt) select $1,$1 where not exists (select 1 from trading_account)',
      [initial],
    );
    return this.account();
  }
  async account(): Promise<Account> {
    const { rows } = await this.client.query<Row>('select * from trading_account order by id limit 1');
    if (!rows[0]) throw new Error('Trading account not initialized');
    const r = rows[0];
    return {
      initialBankUsdt: num(r.initial_bank_usdt),
      cashUsdt: num(r.cash_usdt),
      realizedPnlUsdt: num(r.realized_pnl_usdt),
      aiCostUsd: num(r.ai_cost_usd),
    };
  }
  async openPosition(): Promise<(Position & { id: number }) | null> {
    const { rows } = await this.client.query<Row>(
      "select * from positions where status='OPEN' order by id desc limit 1",
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: num(r.id),
      quantity: num(r.quantity),
      entryPrice: num(r.entry_price),
      costUsdt: num(r.cost_usdt),
      openedAt: new Date(String(r.opened_at)),
    };
  }
  async pendingOrder(): Promise<boolean> {
    const { rows } = await this.client.query("select 1 from orders where status='PENDING' limit 1");
    return rows.length > 0;
  }
  async heartbeat(id = 'worker') {
    await this.client.query('insert into worker_heartbeats(worker_id,status) values($1,$2)', [id, 'UP']);
  }
  /** PostgreSQL advisory lock protects the whole decision-to-order critical section across workers. */
  async withTradingLock<T>(work: () => Promise<T>): Promise<T | null> {
    const connection = await this.client.connect();
    try {
      const result = await connection.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtext('bolinha-trading-cycle')) as acquired",
      );
      if (!result.rows[0]?.acquired) return null;
      try { return await work(); }
      finally { await connection.query("select pg_advisory_unlock(hashtext('bolinha-trading-cycle'))"); }
    } finally { connection.release(); }
  }
  async updateSession(phase: SessionPhase, nextCycleAt: Date | null, at = new Date()) {
    const day = sessionDay(at);
    const existing = await this.client.query<Row>('select phase from trading_sessions where session_day=$1', [day]);
    const previous = existing.rows[0]?.phase as SessionPhase | undefined;
    await this.client.query(
      `insert into trading_sessions(session_day,timezone,phase,started_at,finished_at,next_cycle_at,updated_at)
       values($1,$2,$3,case when $3='TRADING' then $4 else null end,case when $3='FINISHED' then $4 else null end,$5,$4)
       on conflict(session_day) do update set phase=excluded.phase, next_cycle_at=excluded.next_cycle_at,
         started_at=coalesce(trading_sessions.started_at, case when excluded.phase='TRADING' then excluded.updated_at else null end),
         finished_at=case when excluded.phase='FINISHED' then coalesce(trading_sessions.finished_at,excluded.updated_at) else trading_sessions.finished_at end,
         updated_at=excluded.updated_at`,
      [day, config.TRADING_TIMEZONE, phase, at, nextCycleAt],
    );
    return { day, changed: previous !== phase, previous };
  }
  async completeCycle(at = new Date()) {
    await this.client.query('update trading_sessions set last_cycle_at=$2,cycles_today=cycles_today+1,updated_at=$2 where session_day=$1', [sessionDay(at), at]);
  }
  async session(at = new Date()) {
    return (await this.client.query('select * from trading_sessions where session_day=$1', [sessionDay(at)])).rows[0] ?? null;
  }
  async event(level: string, event: string, message: string, payload?: unknown) {
    await this.client.query('insert into system_events(level,event,message,payload) values($1,$2,$3,$4)', [
      level,
      event,
      message,
      payload ?? null,
    ]);
  }
  async saveSnapshot(snapshot: MarketSnapshot): Promise<number> {
    const { rows } = await this.client.query<{ id: number }>(
      'insert into market_snapshots(symbol,payload) values($1,$2) returning id',
      [snapshot.symbol, snapshot],
    );
    return rows[0].id;
  }
  async saveDecision(
    decision: AiDecision,
    usage: AiUsage,
    after: string,
    amount: number,
    rejection: string | null,
    snapshotId: number,
  ): Promise<number> {
    const { rows } = await this.client.query<{ id: number }>(
      'insert into ai_decisions(model_requested,model_returned,action_requested,action_after_risk,amount_requested,amount_after_risk,confidence,reason,raw_response,rejection_reason,market_snapshot_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id',
      [
        usage.modelRequested,
        usage.modelReturned,
        decision.action,
        after,
        decision.amountUsdt,
        amount,
        decision.confidence,
        decision.reason,
        decision.rawResponse,
        rejection,
        snapshotId,
      ],
    );
    await this.client.query(
      'insert into ai_usage(decision_id,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,latency_ms,error) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        rows[0].id,
        usage.modelReturned ?? usage.modelRequested,
        usage.promptTokens,
        usage.completionTokens,
        usage.totalTokens,
        usage.costUsd,
        usage.latencyMs,
        usage.error,
      ],
    );
    if (usage.costUsd)
      await this.client.query('update trading_account set ai_cost_usd=ai_cost_usd+$1,updated_at=now()', [
        usage.costUsd,
      ]);
    return rows[0].id;
  }
  async createPendingOrder(clientOrderId: string, side: string, amount: number): Promise<number> {
    const { rows } = await this.client.query<{ id: number }>(
      'insert into orders(client_order_id,side,requested_amount,status) values($1,$2,$3,$4) returning id',
      [clientOrderId, side, amount, 'PENDING'],
    );
    return rows[0].id;
  }
  async markOrderRejected(id: number) {
    await this.client.query("update orders set status='REJECTED' where id=$1 and status='PENDING'", [id]);
  }
  async recordExecution(order: {
    id: number;
    binanceOrderId: string;
    side: string;
    quantity: number;
    quote: number;
    commission: number;
    at: Date;
  }): Promise<void> {
    const c = await this.client.connect();
    try {
      await c.query('begin');
      await c.query(
        "update orders set binance_order_id=$1,executed_quantity=$2,executed_quote_amount=$3,commission=$4,status='FILLED',executed_at=$5 where id=$6",
        [order.binanceOrderId, order.quantity, order.quote, order.commission, order.at, order.id],
      );
      if (order.side === 'BUY') {
        const p = await c.query<{ id: number }>(
          'insert into positions(symbol,quantity,entry_price,cost_usdt,status,opened_at) values($1,$2,$3,$4,$5,$6) returning id',
          ['BTCUSDT', order.quantity, order.quote / order.quantity, order.quote, 'OPEN', order.at],
        );
        await c.query(
          'insert into trades(order_id,position_id,side,quantity,quote_amount,commission,executed_at) values($1,$2,$3,$4,$5,$6,$7)',
          [order.id, p.rows[0].id, 'BUY', order.quantity, order.quote, order.commission, order.at],
        );
        await c.query('update trading_account set cash_usdt=cash_usdt-$1,updated_at=now()', [order.quote]);
      } else {
        const pos = await c.query<Row>(
          "select * from positions where status='OPEN' order by id desc limit 1 for update",
        );
        if (!pos.rows[0]) throw new Error('Cannot close absent position');
        const p = pos.rows[0];
        const cost = num(p.cost_usdt);
        const pnl = order.quote - cost - order.commission;
        await c.query("update positions set status='CLOSED',closed_at=$1,realized_pnl_usdt=$2 where id=$3", [
          order.at,
          pnl,
          p.id,
        ]);
        await c.query(
          'insert into trades(order_id,position_id,side,quantity,quote_amount,commission,executed_at) values($1,$2,$3,$4,$5,$6,$7)',
          [order.id, p.id, 'SELL', order.quantity, order.quote, order.commission, order.at],
        );
        await c.query(
          'update trading_account set cash_usdt=cash_usdt+$1,realized_pnl_usdt=realized_pnl_usdt+$2,updated_at=now()',
          [order.quote, pnl],
        );
      }
      await c.query('commit');
    } catch (error) {
      await c.query('rollback');
      throw error;
    } finally {
      c.release();
    }
  }
  async positions() {
    return (await this.client.query('select * from positions order by id desc')).rows;
  }
  async orders() {
    return (await this.client.query('select * from orders order by id desc')).rows;
  }
  async trades() {
    return (await this.client.query('select * from trades order by id desc')).rows;
  }
  async decisions() {
    return (await this.client.query('select * from ai_decisions order by id desc limit 100')).rows;
  }
  async events() {
    return (await this.client.query('select * from system_events order by id desc limit 100')).rows;
  }
  async lastHeartbeat() {
    return (
      (await this.client.query('select * from worker_heartbeats order by created_at desc limit 1')).rows[0] ??
      null
    );
  }
  async lastDecision() {
    return (await this.client.query('select * from ai_decisions order by id desc limit 1')).rows[0] ?? null;
  }
  async dailyResult(day = sessionDay()) {
    return (await this.client.query('select * from daily_results where session_day=$1', [day])).rows[0] ?? null;
  }
  async createDailyResult(price: number, at = new Date()) {
    const day = sessionDay(at);
    const performance = await this.performance(price);
    const { rows } = await this.client.query<Row>(
      `select
       count(*) filter (where t.side='BUY')::int as buy_count, count(*) filter (where t.side='SELL')::int as sell_count,
       count(*)::int as trade_count,
       (select count(*)::int from ai_decisions d where to_char(d.timestamp at time zone $2,'YYYY-MM-DD')=$1 and d.action_after_risk='HOLD') as hold_count,
       (select count(*)::int from ai_decisions d where to_char(d.timestamp at time zone $2,'YYYY-MM-DD')=$1 and d.rejection_reason is not null) as rejected_count,
       (select count(*)::int from ai_usage u where to_char(u.created_at at time zone $2,'YYYY-MM-DD')=$1) as ai_calls,
       (select coalesce(sum(u.cost_usd),0) from ai_usage u where to_char(u.created_at at time zone $2,'YYYY-MM-DD')=$1) as ai_cost,
       (select coalesce(jsonb_agg(distinct u.model) filter (where u.model is not null),'[]'::jsonb) from ai_usage u where to_char(u.created_at at time zone $2,'YYYY-MM-DD')=$1) as models,
       (select count(*)::int from system_events e where to_char(e.created_at at time zone $2,'YYYY-MM-DD')=$1 and e.event='ai_fallback') as fallback_count,
       (select count(*)::int from system_events e where to_char(e.created_at at time zone $2,'YYYY-MM-DD')=$1 and e.level='ERROR') as error_count,
       (select exists(select 1 from system_events e where to_char(e.created_at at time zone $2,'YYYY-MM-DD')=$1 and e.event='force_close_started')) as forced_close,
       (select min(created_at) from system_events e where to_char(e.created_at at time zone $2,'YYYY-MM-DD')=$1 and e.event='trading_session_started') as started_at
       from trades t where to_char(t.executed_at at time zone $2,'YYYY-MM-DD')=$1`,
      [day, config.TRADING_TIMEZONE],
    );
    const metrics = rows[0];
    await this.client.query(
      `insert into daily_results(day,session_day,timezone,equity_usdt,initial_equity_usdt,final_equity_usdt,realized_pnl_usdt,unrealized_pnl_usdt,gross_return_pct,trade_count,buy_count,sell_count,hold_count,rejected_decision_count,ai_call_count,ai_cost_usd,models_used,fallback_count,error_count,forced_close_occurred,started_at,finished_at)
       values($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict(session_day) where session_day is not null do update set final_equity_usdt=excluded.final_equity_usdt,equity_usdt=excluded.equity_usdt,realized_pnl_usdt=excluded.realized_pnl_usdt,unrealized_pnl_usdt=excluded.unrealized_pnl_usdt,gross_return_pct=excluded.gross_return_pct,trade_count=excluded.trade_count,buy_count=excluded.buy_count,sell_count=excluded.sell_count,hold_count=excluded.hold_count,rejected_decision_count=excluded.rejected_decision_count,ai_call_count=excluded.ai_call_count,ai_cost_usd=excluded.ai_cost_usd,models_used=excluded.models_used,fallback_count=excluded.fallback_count,error_count=excluded.error_count,forced_close_occurred=excluded.forced_close_occurred,finished_at=excluded.finished_at`,
      [at, day, config.TRADING_TIMEZONE, performance.equityUsdt, performance.initialBankUsdt, performance.realizedPnlUsdt, performance.unrealizedPnlUsdt, ((performance.equityUsdt-performance.initialBankUsdt)/performance.initialBankUsdt)*100, metrics.trade_count, metrics.buy_count, metrics.sell_count, metrics.hold_count, metrics.rejected_count, metrics.ai_calls, metrics.ai_cost, metrics.models, metrics.fallback_count, metrics.error_count, metrics.forced_close, metrics.started_at, at],
    );
    return this.dailyResult(day);
  }
  async performance(price: number) {
    const a = await this.account();
    const p = await this.openPosition();
    const unrealized = p ? p.quantity * price - p.costUsdt : 0;
    return {
      initialBankUsdt: a.initialBankUsdt,
      cashUsdt: a.cashUsdt,
      equityUsdt: a.cashUsdt + (p ? p.quantity * price : 0),
      realizedPnlUsdt: a.realizedPnlUsdt,
      unrealizedPnlUsdt: unrealized,
      aiCostUsd: a.aiCostUsd,
      tradeCount: Number((await this.client.query('select count(*) from trades')).rows[0].count),
    };
  }
}
