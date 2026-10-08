import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { buildDailyReport, calculateExpectedDecisionCycles, config, defaultTradingConfiguration, isSessionDay, sessionDay, sessionPhase, sessionSchedule, validateTradingConfiguration, type Account, type DailyReport, type DailyReportInput, type Position, type SessionPhase, type TradingConfiguration } from '@bolinha/core';
import type { AiDecision, AiUsage } from '@bolinha/ai';
import type { MarketSnapshot } from '@bolinha/market-data';
import { executionAccounting, type ExecutionFill } from './accounting.js';
export { executionAccounting, summarizeFees, type ExecutionFill } from './accounting.js';
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
export const db = drizzle(pool); // Drizzle is the ORM boundary; explicit SQL below keeps ledger transactions auditable.
type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value);
const clock = (value: unknown) => String(value).slice(0, 5);
const configurationFromRow = (row: Row): TradingConfiguration => validateTradingConfiguration({
  timezone: String(row.timezone), start: clock(row.start_time), stopNewPositions: clock(row.stop_new_positions_time),
  forceClose: clock(row.force_close_time), end: clock(row.end_time), intervalSeconds: num(row.interval_seconds),
  initialBankUsdt: num(row.initial_bank_usdt), maxPositionPercent: num(row.max_position_percent),
  updatedAt: row.updated_at ? new Date(String(row.updated_at)) : null,
});
/** Never pass JS arrays/objects directly to pg for a jsonb parameter. */
export const serializeJsonb = (value: unknown) => JSON.stringify(value);
export type PendingOrder = {
  id: number;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  requestedAmount: number;
  requestedQuantity: number | null;
};
export type ReconciliationState = {
  status: 'OK' | 'RUNNING' | 'ERROR';
  stateConsistent: boolean;
  lastReconciliationAt: Date | null;
  lastError: string | null;
};
export type ConfigurationEditability = {
  editable: boolean;
  reason: ConfigurationBlockReason | null;
  message: string | null;
  /** @deprecated Use reason. Kept for existing dashboard/API consumers. */
  blockedReason: ConfigurationBlockReason | null;
  sessionPhase: SessionPhase;
  openPosition: boolean;
  pendingOrders: number;
  reconciliationStatus: ReconciliationState['status'];
  stateConsistent: boolean;
};
export type ConfigurationBlockReason =
  | 'LOOP_ACTIVE'
  | 'OPEN_POSITION'
  | 'PENDING_ORDER'
  | 'RECONCILIATION_NOT_OK'
  | 'CYCLE_RUNNING'
  | 'FORCE_CLOSE_RUNNING';
const configurationBlockMessage: Record<ConfigurationBlockReason, string> = {
  LOOP_ACTIVE: 'Trading em execução. A configuração não pode ser alterada durante a sessão ativa.',
  OPEN_POSITION: 'Existe uma posição aberta. Feche a posição antes de alterar a configuração.',
  PENDING_ORDER: 'Existe uma ordem pendente de reconciliação.',
  RECONCILIATION_NOT_OK: 'A configuração está bloqueada enquanto a reconciliação não estiver OK.',
  CYCLE_RUNNING: 'Um ciclo operacional está em execução. Aguarde a conclusão para alterar a configuração.',
  FORCE_CLOSE_RUNNING: 'O force close está em andamento. Aguarde o encerramento para alterar a configuração.',
};
export class ConfigurationBlockedError extends Error {
  constructor(public readonly state: ConfigurationEditability) {
    super(state.message ?? 'Configuração operacional não pode ser alterada agora.');
    this.name = 'ConfigurationBlockedError';
  }
}
const configurationMetadata = (configuration: TradingConfiguration) => ({
  timezone: configuration.timezone, startTime: configuration.start, stopNewPositionsTime: configuration.stopNewPositions,
  forceCloseTime: configuration.forceClose, endTime: configuration.end, intervalSeconds: configuration.intervalSeconds,
  initialBankUsdt: configuration.initialBankUsdt, maxPositionPercent: configuration.maxPositionPercent,
});
export const configurationEditabilityFromState = (
  at: Date,
  configuration: TradingConfiguration,
  loopEnabled: boolean,
  hasOpenPosition: boolean,
  pendingOrders: number,
  reconciliation: ReconciliationState,
  operationRunning = false,
): ConfigurationEditability => {
  const phase = sessionPhase(at, configuration, hasOpenPosition);
  const activeSession = phase !== 'BEFORE_START' && phase !== 'FINISHED';
  const reason: ConfigurationBlockReason | null =
    operationRunning ? (phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING' ? 'FORCE_CLOSE_RUNNING' : 'CYCLE_RUNNING')
      : hasOpenPosition ? 'OPEN_POSITION'
        : pendingOrders > 0 ? 'PENDING_ORDER'
          : reconciliation.status !== 'OK' || !reconciliation.stateConsistent ? 'RECONCILIATION_NOT_OK'
            : loopEnabled && activeSession ? 'LOOP_ACTIVE'
              : null;
  return {
    editable: reason === null,
    reason,
    message: reason ? configurationBlockMessage[reason] : null,
    blockedReason: reason,
    sessionPhase: phase,
    openPosition: hasOpenPosition,
    pendingOrders,
    reconciliationStatus: reconciliation.status,
    stateConsistent: reconciliation.stateConsistent,
  };
};
export class TradingRepository {
  constructor(private client: pg.Pool = pool) {}
  async health() {
    await this.client.query('select 1');
    return true;
  }
  /** Reads PostgreSQL on each operational boundary. It is one query per worker
   * tick, so configuration changes take effect without a restart. */
  async configuration(): Promise<TradingConfiguration> {
    let result = await this.client.query<Row>('select * from trading_configuration order by id limit 1');
    if (!result.rows[0]) {
      await this.client.query(
        `insert into trading_configuration(id,timezone,start_time,stop_new_positions_time,force_close_time,end_time,interval_seconds,initial_bank_usdt,max_position_percent)
         select 1,$1,$2::time,$3::time,$4::time,$5::time,$6,$7,$8
         where not exists (select 1 from trading_configuration)
         on conflict (id) do nothing`,
        [defaultTradingConfiguration.timezone, defaultTradingConfiguration.start, defaultTradingConfiguration.stopNewPositions, defaultTradingConfiguration.forceClose, defaultTradingConfiguration.end, defaultTradingConfiguration.intervalSeconds, defaultTradingConfiguration.initialBankUsdt, defaultTradingConfiguration.maxPositionPercent],
      );
      result = await this.client.query<Row>('select * from trading_configuration order by id limit 1');
    }
    // Lightweight repository doubles used by pure read-model tests have no
    // mutable backing store. Production PostgreSQL reaches this only if a
    // migration/permission failure prevented the bootstrap INSERT.
    if (!result.rows[0]) return { ...defaultTradingConfiguration };
    return configurationFromRow(result.rows[0]);
  }
  async configurationEditability(at = new Date(), configuration?: TradingConfiguration): Promise<ConfigurationEditability> {
    configuration ??= await this.configuration();
    const [position, pendingOrders, reconciliation, operationRunning] = await Promise.all([
      this.openPosition(), this.pendingOrderCount(), this.reconciliationState(),
      this.tradingOperationRunning(),
    ]);
    return this.editabilityFromState(at, configuration, Boolean(position), pendingOrders, reconciliation, operationRunning);
  }
  /** A non-blocking probe of the worker's advisory lock for the configuration UI. */
  private async tradingOperationRunning(): Promise<boolean> {
    const connection = await this.client.connect();
    try {
      const result = await connection.query<{ acquired: boolean }>("select pg_try_advisory_lock(hashtext('bolinha-trading-cycle')) as acquired");
      if (!result.rows[0]?.acquired) return true;
      await connection.query("select pg_advisory_unlock(hashtext('bolinha-trading-cycle'))");
      return false;
    } finally { connection.release(); }
  }
  private editabilityFromState(
    at: Date, configuration: TradingConfiguration, hasOpenPosition: boolean, pendingOrders: number, reconciliation: ReconciliationState, operationRunning = false,
  ): ConfigurationEditability {
    return configurationEditabilityFromState(at, configuration, config.TRADING_LOOP_ENABLED, hasOpenPosition, pendingOrders, reconciliation, operationRunning);
  }
  /**
   * Changes the singleton live row and appends an immutable version in the
   * same transaction. The trading advisory lock closes the race with a worker
   * cycle that may otherwise submit an order while this request is in flight.
   */
  async updateConfiguration(next: TradingConfiguration, at = new Date(), eventName: 'configuration_updated' | 'configuration_created' = 'configuration_updated'): Promise<TradingConfiguration> {
    validateTradingConfiguration(next);
    const connection = await this.client.connect();
    try {
      await connection.query('begin');
      const configurationLock = await connection.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(hashtext('bolinha-configuration-change')) as acquired");
      const tradingLock = configurationLock.rows[0]?.acquired
        ? await connection.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(hashtext('bolinha-trading-cycle')) as acquired")
        : { rows: [{ acquired: false }] };
      const currentResult = await connection.query<Row>('select * from trading_configuration where id=1 for update');
      const current = currentResult.rows[0] ? configurationFromRow(currentResult.rows[0]) : await this.configuration();
      const attemptedPayload = { previous: configurationMetadata(current), next: configurationMetadata(next), at: at.toISOString() };
      await connection.query('insert into system_events(level,event,message,payload,created_at) values($1,$2,$3,$4::jsonb,$5)', [
        'INFO', 'configuration_update_attempted', 'Operational configuration update attempted', serializeJsonb(attemptedPayload), at,
      ]);
      if (!configurationLock.rows[0]?.acquired || !tradingLock.rows[0]?.acquired) {
        const state = configurationEditabilityFromState(at, current, config.TRADING_LOOP_ENABLED, false, 0,
          { status: 'RUNNING', stateConsistent: false, lastReconciliationAt: null, lastError: null }, true);
        await connection.query('insert into system_events(level,event,message,payload,created_at) values($1,$2,$3,$4::jsonb,$5)', [
          'WARN', 'configuration_update_blocked', 'Operational configuration update blocked', serializeJsonb({ ...attemptedPayload, reason: state.blockedReason }), at,
        ]);
        await connection.query('commit');
        throw new ConfigurationBlockedError(state);
      }
      const [positionResult, pendingResult, reconciliationResult] = await Promise.all([
        connection.query("select 1 from positions where status='OPEN' limit 1"),
        connection.query("select count(*) from orders where status='PENDING'"),
        connection.query<Row>('select * from reconciliation_state where id=true'),
      ]);
      const reconciliationRow = reconciliationResult.rows[0];
      const reconciliation: ReconciliationState = !reconciliationRow
        ? { status: 'ERROR', stateConsistent: false, lastReconciliationAt: null, lastError: 'Startup reconciliation has not run' }
        : { status: String(reconciliationRow.status) as ReconciliationState['status'], stateConsistent: Boolean(reconciliationRow.state_consistent), lastReconciliationAt: reconciliationRow.last_reconciled_at ? new Date(String(reconciliationRow.last_reconciled_at)) : null, lastError: reconciliationRow.last_error === null ? null : String(reconciliationRow.last_error) };
      const state = this.editabilityFromState(at, current, positionResult.rows.length > 0, Number(pendingResult.rows[0].count), reconciliation);
      if (!state.editable) {
        await connection.query('insert into system_events(level,event,message,payload,created_at) values($1,$2,$3,$4::jsonb,$5)', [
          'WARN', 'configuration_update_blocked', 'Operational configuration update blocked', serializeJsonb({ ...attemptedPayload, reason: state.blockedReason }), at,
        ]);
        await connection.query('commit');
        throw new ConfigurationBlockedError(state);
      }
      await connection.query(
        `update trading_configuration set timezone=$1,start_time=$2::time,stop_new_positions_time=$3::time,force_close_time=$4::time,end_time=$5::time,
         interval_seconds=$6,initial_bank_usdt=$7,max_position_percent=$8 where id=1`,
        [next.timezone, next.start, next.stopNewPositions, next.forceClose, next.end, next.intervalSeconds, next.initialBankUsdt, next.maxPositionPercent],
      );
      await connection.query('update trading_configuration_versions set valid_to=$1 where configuration_id=1 and valid_to is null', [at]);
      const version = await connection.query<{ id: number }>(
        `insert into trading_configuration_versions(configuration_id,timezone,start_time,stop_new_positions_time,force_close_time,end_time,interval_seconds,initial_bank_usdt,max_position_percent,valid_from)
         values(1,$1,$2::time,$3::time,$4::time,$5::time,$6,$7,$8,$9) returning id`,
        [next.timezone, next.start, next.stopNewPositions, next.forceClose, next.end, next.intervalSeconds, next.initialBankUsdt, next.maxPositionPercent, at],
      );
      // A BEFORE_START row is only a planning marker, not historical
      // evidence yet. Keep it aligned with a safe edit so the next session is
      // stamped with the configuration the worker will actually use.
      // Keep the current day's session aligned with the updated configuration
      // so the session timeline and worker reflect the active parameters.
      await connection.query(
        `update trading_sessions set timezone=$1,start_time=$2::time,stop_new_positions_time=$3::time,force_close_time=$4::time,end_time=$5::time,
         interval_seconds=$6,configuration_version_id=$7,updated_at=$8 where session_day=$9`,
        [next.timezone, next.start, next.stopNewPositions, next.forceClose, next.end, next.intervalSeconds, version.rows[0].id, at, sessionDay(at, current.timezone)],
      );
      await connection.query('insert into system_events(level,event,message,payload,created_at) values($1,$2,$3,$4::jsonb,$5)', [
        'INFO', eventName, eventName === 'configuration_created' ? 'Operational configuration version created' : 'Operational configuration updated', serializeJsonb(attemptedPayload), at,
      ]);
      await connection.query('commit');
      return { ...next, updatedAt: at };
    } catch (error) {
      try { await connection.query('rollback'); } catch { /* already committed audit before a blocked response */ }
      throw error;
    } finally { connection.release(); }
  }
  configurationForSession(session: Row | null | undefined, fallback: TradingConfiguration): TradingConfiguration {
    if (!session?.start_time || !session.stop_new_positions_time || !session.force_close_time || !session.end_time || !session.interval_seconds)
      return fallback;
    return validateTradingConfiguration({
      timezone: String(session.timezone), start: clock(session.start_time), stopNewPositions: clock(session.stop_new_positions_time),
      forceClose: clock(session.force_close_time), end: clock(session.end_time), intervalSeconds: num(session.interval_seconds),
      initialBankUsdt: fallback.initialBankUsdt, maxPositionPercent: fallback.maxPositionPercent,
    });
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
  async pendingOrderCount(): Promise<number> {
    return Number((await this.client.query("select count(*) from orders where status='PENDING'")).rows[0].count);
  }
  async pendingOrders(): Promise<PendingOrder[]> {
    const { rows } = await this.client.query<Row>(
      "select * from orders where status='PENDING' order by id",
    );
    return rows.map((r) => ({
      id: num(r.id),
      clientOrderId: String(r.client_order_id),
      side: String(r.side) as 'BUY' | 'SELL',
      requestedAmount: num(r.requested_amount),
      requestedQuantity: r.requested_quantity === null ? null : num(r.requested_quantity),
    }));
  }
  async pendingOrderDetails(): Promise<PendingOrder | null> {
    return (await this.pendingOrders())[0] ?? null;
  }
  async reconciliationState(): Promise<ReconciliationState> {
    const { rows } = await this.client.query<Row>('select * from reconciliation_state where id=true');
    if (!rows[0]) return { status: 'ERROR', stateConsistent: false, lastReconciliationAt: null, lastError: 'Startup reconciliation has not run' };
    const r = rows[0];
    return {
      status: String(r.status) as ReconciliationState['status'],
      stateConsistent: Boolean(r.state_consistent),
      lastReconciliationAt: r.last_reconciled_at ? new Date(String(r.last_reconciled_at)) : null,
      lastError: r.last_error === null ? null : String(r.last_error),
    };
  }
  async reconciliationStarted() {
    await this.client.query("insert into reconciliation_state(id,status,state_consistent,last_error,updated_at) values(true,'RUNNING',false,null,now()) on conflict(id) do update set status='RUNNING',state_consistent=false,last_error=null,updated_at=now()");
  }
  async reconciliationCompleted() {
    await this.client.query("insert into reconciliation_state(id,status,state_consistent,last_reconciled_at,last_error,updated_at) values(true,'OK',true,now(),null,now()) on conflict(id) do update set status='OK',state_consistent=true,last_reconciled_at=now(),last_error=null,updated_at=now()");
  }
  async reconciliationFailed(error: string) {
    await this.client.query("insert into reconciliation_state(id,status,state_consistent,last_error,updated_at) values(true,'ERROR',false,$1,now()) on conflict(id) do update set status='ERROR',state_consistent=false,last_error=excluded.last_error,updated_at=now()", [error]);
  }
  async stateConsistency(): Promise<{ consistent: boolean; reason: string | null }> {
    const { rows } = await this.client.query<{ pending: string; execution_without_trade: string }>(
      `select
        (select count(*) from orders where status='PENDING') as pending,
        (select count(*) from orders o left join trades t on t.order_id=o.id where o.status='FILLED' and t.id is null) as execution_without_trade`,
    );
    const pending = Number(rows[0].pending);
    const missingTrades = Number(rows[0].execution_without_trade);
    if (pending) return { consistent: false, reason: `${pending} pending order(s) remain` };
    if (missingTrades) return { consistent: false, reason: `${missingTrades} filled order(s) have no ledger trade` };
    return { consistent: true, reason: null };
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
  async updateSession(phase: SessionPhase, nextCycleAt: Date | null, configurationOrAt: TradingConfiguration | Date = defaultTradingConfiguration, maybeAt = new Date()) {
    const configuration = configurationOrAt instanceof Date ? defaultTradingConfiguration : configurationOrAt;
    const at = configurationOrAt instanceof Date ? configurationOrAt : maybeAt;
    const day = sessionDay(at, configuration.timezone);
    const existing = await this.client.query<Row>('select phase from trading_sessions where session_day=$1', [day]);
    const previous = existing.rows[0]?.phase as SessionPhase | undefined;
    await this.client.query(
      `insert into trading_sessions(session_day,timezone,phase,started_at,finished_at,next_cycle_at,initial_equity_usdt,updated_at)
       values($1::date,$2::varchar(64),$3::varchar(32),
         case when $3::varchar(32)='TRADING'::varchar(32) then $4::timestamptz else null::timestamptz end,
         case when $3::varchar(32)='FINISHED'::varchar(32) then $4::timestamptz else null::timestamptz end,
         $5::timestamptz,(select cash_usdt from trading_account order by id limit 1),$4::timestamptz)
       on conflict(session_day) do update set phase=excluded.phase, next_cycle_at=excluded.next_cycle_at,
         started_at=coalesce(trading_sessions.started_at, case when excluded.phase='TRADING'::varchar(32) then excluded.updated_at else null::timestamptz end),
         finished_at=case when excluded.phase='FINISHED'::varchar(32) then coalesce(trading_sessions.finished_at,excluded.updated_at) else trading_sessions.finished_at end,
         updated_at=excluded.updated_at`,
      [day, configuration.timezone, phase, at, nextCycleAt],
    );
    // Only fill a snapshot once. Future configuration edits must never rewrite
    // a historical session's effective schedule.
    await this.client.query(
      `update trading_sessions set start_time=coalesce(start_time,$2::time),
       stop_new_positions_time=coalesce(stop_new_positions_time,$3::time), force_close_time=coalesce(force_close_time,$4::time),
       end_time=coalesce(end_time,$5::time), interval_seconds=coalesce(interval_seconds,$6),
       configuration_version_id=coalesce(configuration_version_id,(
         select id from trading_configuration_versions where configuration_id=1 and valid_to is null order by id desc limit 1
       ))
       where session_day=$1`,
      [day, configuration.start, configuration.stopNewPositions, configuration.forceClose, configuration.end, configuration.intervalSeconds],
    );
    return { day, changed: previous !== phase, previous };
  }
  /** @deprecated Kept for callers outside this repository; a cycle here means a decision cycle. */
  async completeCycle(at = new Date()) { return this.completeDecisionCycle(at); }
  async completeDecisionCycle(at = new Date()) {
    await this.client.query(
      'update trading_sessions set last_cycle_at=$2,cycles_today=cycles_today+1,decision_cycles=decision_cycles+1,updated_at=$2 where session_day=$1',
      [sessionDay(at), at],
    );
  }
  async recordOperationalCheck(at = new Date()) {
    await this.client.query(
      'update trading_sessions set operational_checks=operational_checks+1,updated_at=$2 where session_day=$1',
      [sessionDay(at), at],
    );
  }
  async recordForceCloseAttempt(at = new Date()) {
    await this.client.query(
      'update trading_sessions set force_close_attempts=force_close_attempts+1,updated_at=$2 where session_day=$1',
      [sessionDay(at), at],
    );
  }
  async recordReconciliationRun(at = new Date()) {
    await this.client.query(
      'update trading_sessions set reconciliation_runs=reconciliation_runs+1,updated_at=$2 where session_day=$1',
      [sessionDay(at), at],
    );
  }
  async session(at = new Date(), timezone = defaultTradingConfiguration.timezone) {
    return (await this.client.query('select * from trading_sessions where session_day=$1', [sessionDay(at, timezone)])).rows[0] ?? null;
  }
  /** Recovery path for a stopped worker: record the configured end, never "now". */
  async markSessionFinishedAtScheduledEnd(at = new Date(), configuration?: TradingConfiguration) {
    configuration ??= await this.configuration();
    const day = sessionDay(at, configuration.timezone);
    const schedule = sessionSchedule(configuration);
    await this.client.query(
      `update trading_sessions set phase='FINISHED',finished_at=coalesce(finished_at, (($1::date + $2::time) at time zone $3)),
       next_cycle_at=null,updated_at=$4 where session_day=$1 and phase <> 'FINISHED'`,
      [day, schedule.end, schedule.timezone, at],
    );
    return this.session(at, schedule.timezone);
  }
  async event(level: string, event: string, message: string, payload?: unknown) {
    await this.client.query('insert into system_events(level,event,message,payload) values($1,$2,$3,$4::jsonb)', [
      level,
      event,
      message,
      payload === undefined ? null : serializeJsonb(payload),
    ]);
  }
  /** Emits a phase-level marker once for a session, preventing retry noise. */
  async eventOnceForSession(level: string, event: string, message: string, at = new Date(), payload?: unknown) {
    const day = sessionDay(at);
    const { rows } = await this.client.query<{ inserted: boolean }>(
      `insert into system_events(level,event,message,payload,created_at)
       select $1,$2::varchar(100),$3,$4::jsonb,$5
       where not exists (
         select 1 from system_events e join trading_sessions s on s.session_day=$6::date
         where e.event=$2::varchar(100) and e.created_at >= s.started_at and e.created_at <= coalesce(s.finished_at,$5)
       ) returning true as inserted`,
      [level, event, message, payload === undefined ? null : serializeJsonb(payload), at, day],
    );
    return Boolean(rows[0]?.inserted);
  }
  async saveSnapshot(snapshot: MarketSnapshot): Promise<number> {
    const { rows } = await this.client.query<{ id: number }>(
      'insert into market_snapshots(symbol,payload) values($1,$2) returning id',
      [snapshot.symbol, snapshot],
    );
    return rows[0].id;
  }
  /** A compact financial point for the operational dashboard, persisted once per worker cycle. */
  async saveAccountSnapshot(price: number, at = new Date()) {
    const [performance, position] = await Promise.all([this.performance(price), this.openPosition()]);
    await this.client.query(
      `insert into account_snapshots(cash_usdt,equity_usdt,realized_pnl_usdt,unrealized_pnl_usdt,net_pnl_usdt,price,position_quantity,position_cost_usdt,created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [performance.cashUsdt, performance.equityUsdt, performance.realizedPnlUsdt, performance.unrealizedPnlUsdt,
        performance.netPnlUsdt, price, position?.quantity ?? null, position?.costUsdt ?? null, at],
    );
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
  async createPendingOrder(clientOrderId: string, side: string, amount: number, quantity: number): Promise<number> {
    const { rows } = await this.client.query<{ id: number }>(
      'insert into orders(client_order_id,side,requested_amount,requested_quantity,status) values($1,$2,$3,$4,$5) returning id',
      [clientOrderId, side, amount, quantity, 'PENDING'],
    );
    return rows[0].id;
  }
  async markOrderRejected(id: number, reason = 'Rejected during reconciliation') {
    await this.client.query("update orders set status='REJECTED',reconciliation_reason=$2 where id=$1 and status='PENDING'", [id, reason]);
  }
  async recordExecution(order: {
    id: number;
    binanceOrderId: string;
    side: string;
    quantity: number;
    quote: number;
    commission: number;
    fills?: ExecutionFill[];
    at: Date;
  }): Promise<{ applied: boolean }> {
    const c = await this.client.connect();
    try {
      await c.query('begin');
      // The local order id is tied to the unique clientOrderId; the alternate
      // lookup makes a replay with a known Binance id idempotent too.
      const persisted = await c.query<Row>(
        'select * from orders where id=$1 or binance_order_id=$2 order by id=$1 desc for update',
        [order.id, order.binanceOrderId],
      );
      if (!persisted.rows[0]) throw new Error('Cannot record execution for an absent order');
      const pending = persisted.rows[0];
      if (String(pending.status) === 'FILLED') {
        if (String(pending.binance_order_id) !== order.binanceOrderId || String(pending.side) !== order.side)
          throw new Error('Execution identity conflicts with an already filled order');
        await c.query('commit');
        return { applied: false };
      }
      if (String(pending.status) !== 'PENDING') throw new Error('Cannot record execution for a non-pending order');
      if (String(pending.side) !== order.side) throw new Error('Execution side does not match pending order');
      const fills = order.fills ?? [];
      const accounting = executionAccounting(order.side as 'BUY' | 'SELL', order.quantity, order.quote, fills);
      if (accounting.positionQuantity <= 0)
        throw new Error('Execution leaves no positive BTC quantity after base-asset fees');
      const requestedQuantity = pending.requested_quantity === null ? null : num(pending.requested_quantity);
      const fulfilledQuantity = order.side === 'SELL' ? accounting.positionQuantity : order.quantity;
      if (requestedQuantity !== null && Math.abs(requestedQuantity - fulfilledQuantity) > 1e-12)
        throw new Error('Execution quantity does not match the pending order quantity after base-asset fees');
      await c.query(
        "update orders set binance_order_id=$1,executed_quantity=$2,executed_quote_amount=$3,commission=$4,status='FILLED',executed_at=$5 where id=$6",
        [order.binanceOrderId, order.quantity, order.quote, accounting.quoteFee, order.at, order.id],
      );
      const persistedFills: Array<{ id: number; fill: ExecutionFill }> = [];
      for (const fill of fills) {
        const inserted = await c.query<{ id: number }>(
          `insert into order_fills(order_id,trade_id,price,quantity,commission,commission_asset,raw)
           values($1,$2,$3,$4,$5,$6,$7) returning id`,
          [order.id, fill.tradeId ?? null, fill.price, fill.qty, fill.commission, fill.commissionAsset, fill],
        );
        persistedFills.push({ id: inserted.rows[0].id, fill });
      }
      if (order.side === 'BUY') {
        const p = await c.query<{ id: number }>(
          'insert into positions(symbol,quantity,entry_price,cost_usdt,status,opened_at) values($1,$2,$3,$4,$5,$6) returning id',
          ['BTCUSDT', accounting.positionQuantity, accounting.effectiveQuoteAmount / accounting.positionQuantity, accounting.effectiveQuoteAmount, 'OPEN', order.at],
        );
        const trade = await c.query<{ id: number }>(
          `insert into trades(order_id,position_id,side,quantity,quote_amount,net_quantity,net_quote_amount,fees_usdt_known,commission,executed_at)
           values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning id`,
          [order.id, p.rows[0].id, 'BUY', order.quantity, order.quote, accounting.positionQuantity, accounting.effectiveQuoteAmount, accounting.quoteFee, order.at],
        );
        await this.recordTradeFees(c, trade.rows[0].id, persistedFills);
        await c.query('update trading_account set cash_usdt=cash_usdt-$1,updated_at=now()', [accounting.effectiveQuoteAmount]);
      } else {
        const pos = await c.query<Row>(
          "select * from positions where status='OPEN' order by id desc limit 1 for update",
        );
        if (!pos.rows[0]) throw new Error('Cannot close absent position');
        const p = pos.rows[0];
        const positionQuantity = num(p.quantity);
        if (Math.abs(positionQuantity - accounting.positionQuantity) > 1e-12)
          throw new Error('Refusing to close a position after a partial SELL execution or an unaccounted base-asset fee');
        const cost = num(p.cost_usdt);
        const opening = await c.query<Row>(
          "select quote_amount from trades where position_id=$1 and side='BUY' order by id limit 1",
          [p.id],
        );
        if (!opening.rows[0]) throw new Error('Cannot calculate P/L without the opening BUY trade');
        const grossPnl = order.quote - num(opening.rows[0].quote_amount);
        const pnl = accounting.effectiveQuoteAmount - cost;
        await c.query("update positions set status='CLOSED',closed_at=$1,realized_pnl_usdt=$2 where id=$3", [
          order.at,
          pnl,
          p.id,
        ]);
        const trade = await c.query<{ id: number }>(
          `insert into trades(order_id,position_id,side,quantity,quote_amount,net_quantity,net_quote_amount,gross_pnl_usdt,fees_usdt_known,net_pnl_usdt,commission,executed_at)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11) returning id`,
          [order.id, p.id, 'SELL', order.quantity, order.quote, accounting.positionQuantity, accounting.effectiveQuoteAmount, grossPnl, accounting.quoteFee, pnl, order.at],
        );
        await this.recordTradeFees(c, trade.rows[0].id, persistedFills);
        await c.query(
          'update trading_account set cash_usdt=cash_usdt+$1,realized_pnl_usdt=realized_pnl_usdt+$2,updated_at=now()',
          [accounting.effectiveQuoteAmount, pnl],
        );
      }
      await c.query('commit');
      return { applied: true };
    } catch (error) {
      await c.query('rollback');
      throw error;
    } finally {
      c.release();
    }
  }
  private async recordTradeFees(
    c: pg.PoolClient,
    tradeId: number,
    fills: Array<{ id: number; fill: ExecutionFill }>,
  ) {
    for (const { id, fill } of fills) {
      if (fill.commission === 0) continue;
      const asset = fill.commissionAsset.toUpperCase();
      await c.query(
        'insert into trade_fees(trade_id,fill_id,asset,amount,amount_usdt) values($1,$2,$3,$4,$5)',
        [tradeId, id, asset, fill.commission, asset === 'USDT' ? fill.commission : null],
      );
    }
  }
  async positions() {
    return (await this.client.query('select * from positions order by id desc')).rows;
  }
  async orders() {
    return (await this.client.query('select * from orders order by id desc')).rows;
  }
  async trades() {
    return (await this.client.query(
      `select t.*, coalesce(f.fees,'[]'::jsonb) as fees, coalesce(f.fees_by_asset,'{}'::jsonb) as fees_by_asset
       from trades t left join lateral (
         select jsonb_agg(jsonb_build_object('asset',asset,'amount',amount,'amountUsdt',amount_usdt) order by id) as fees,
                jsonb_object_agg(asset,amount) as fees_by_asset
         from trade_fees where trade_id=t.id
       ) f on true order by t.id desc`,
    )).rows;
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
  async dailyResultStatus(day = sessionDay()): Promise<'PENDING' | 'OK' | 'ERROR' | null> {
    if (await this.dailyResult(day)) return 'OK';
    const session = await this.sessionForDay(day);
    return session ? String(session.consolidation_status ?? 'PENDING') as 'PENDING' | 'OK' | 'ERROR' : null;
  }
  private async sessionForDay(day: string) {
    return (await this.client.query<Row>('select * from trading_sessions where session_day=$1', [day])).rows[0] ?? null;
  }
  async markDailyResultPending(at = new Date()) {
    await this.client.query(
      `update trading_sessions set consolidation_status='PENDING',consolidation_error=null,
       consolidation_attempts=consolidation_attempts+1,updated_at=$2 where session_day=$1`,
      [sessionDay(at), at],
    );
  }
  async markDailyResultFailed(error: string, at = new Date()) {
    await this.client.query(
      `update trading_sessions set consolidation_status='ERROR',consolidation_error=$2,
       consolidation_attempts=consolidation_attempts+1,updated_at=$3 where session_day=$1`,
      [sessionDay(at), error, at],
    );
  }
  async markDailyResultOk(at = new Date()) {
    await this.client.query(
      "update trading_sessions set consolidation_status='OK',consolidation_error=null,updated_at=$2 where session_day=$1",
      [sessionDay(at), at],
    );
  }
  async createDailyResult(price: number, at = new Date(), configuration?: TradingConfiguration) {
    configuration ??= await this.configuration();
    const day = sessionDay(at, configuration.timezone);
    const session = await this.sessionForDay(day);
    if (!session || String(session.phase) !== 'FINISHED')
      throw new Error('Daily result can only be consolidated after the session is FINISHED');
    if (await this.openPosition())
      throw new Error('Daily result cannot be consolidated while a conceptual position is open');
    const schedule = sessionSchedule(this.configurationForSession(session, configuration));
    const scheduledEnd = (await this.client.query<{ at: Date }>(
      "select (($1::date + $2::time) at time zone $3) as at",
      [day, schedule.end, schedule.timezone],
    )).rows[0].at;
    const sessionFinishedAt = session.finished_at ? new Date(String(session.finished_at)) : scheduledEnd;
    const finishedAt = new Date(Math.max(sessionFinishedAt.getTime(), at.getTime()));
    const startedAt = session.started_at ? new Date(String(session.started_at)) : finishedAt;
    const performance = await this.performance(price);
    const initialEquityUsdt = session?.initial_equity_usdt === null || session?.initial_equity_usdt === undefined
      ? performance.initialBankUsdt
      : num(session.initial_equity_usdt);
    const dailyFees = await this.feeSummaryForSession(startedAt, finishedAt);
    const { rows } = await this.client.query<Row>(
      `select
       count(*) filter (where t.side='BUY')::int as buy_count, count(*) filter (where t.side='SELL')::int as sell_count,
       count(*)::int as trade_count,
       (select count(*)::int from ai_decisions d where d.timestamp >= $1 and d.timestamp <= $2 and d.action_after_risk='HOLD') as hold_count,
       (select count(*)::int from ai_decisions d where d.timestamp >= $1 and d.timestamp <= $2 and d.action_requested <> d.action_after_risk) as rejected_count,
       (select count(*)::int from ai_usage u join ai_decisions d on d.id=u.decision_id where d.timestamp >= $1 and d.timestamp <= $2) as ai_calls,
       (select coalesce(sum(u.cost_usd),0) from ai_usage u join ai_decisions d on d.id=u.decision_id where d.timestamp >= $1 and d.timestamp <= $2) as ai_cost,
       (select coalesce(jsonb_agg(distinct u.model) filter (where u.model is not null),'[]'::jsonb) from ai_usage u join ai_decisions d on d.id=u.decision_id where d.timestamp >= $1 and d.timestamp <= $2) as models,
       (select count(*)::int from system_events e where e.created_at >= $1 and e.created_at <= $2 and e.event='ai_fallback') as fallback_count,
       (select count(*)::int from system_events e where e.created_at >= $1 and e.created_at <= $2 and e.level='ERROR') as error_count,
       (select exists(select 1 from system_events e where e.created_at >= $1 and e.created_at <= $2 and e.event='force_close_completed' and e.payload ? 'orderId')) as forced_close,
       coalesce(sum(t.gross_pnl_usdt) filter (where t.side='SELL'),0) as gross_pnl,
       coalesce(sum(t.net_pnl_usdt) filter (where t.side='SELL'),0) as net_pnl
       from trades t where t.executed_at >= $1 and t.executed_at <= $2`,
      [startedAt, finishedAt],
    );
    const metrics = rows[0];
    await this.client.query(
      `insert into daily_results(day,session_day,timezone,equity_usdt,initial_equity_usdt,final_equity_usdt,realized_pnl_usdt,unrealized_pnl_usdt,gross_pnl_usdt,fees_usdt_known,net_pnl_usdt,fees_by_asset,gross_return_pct,trade_count,buy_count,sell_count,hold_count,rejected_decision_count,ai_call_count,ai_cost_usd,models_used,fallback_count,error_count,forced_close_occurred,started_at,finished_at)
       values($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25)
       on conflict(session_day) where session_day is not null do update set final_equity_usdt=excluded.final_equity_usdt,equity_usdt=excluded.equity_usdt,realized_pnl_usdt=excluded.realized_pnl_usdt,unrealized_pnl_usdt=excluded.unrealized_pnl_usdt,gross_pnl_usdt=excluded.gross_pnl_usdt,fees_usdt_known=excluded.fees_usdt_known,net_pnl_usdt=excluded.net_pnl_usdt,fees_by_asset=excluded.fees_by_asset,gross_return_pct=excluded.gross_return_pct,trade_count=excluded.trade_count,buy_count=excluded.buy_count,sell_count=excluded.sell_count,hold_count=excluded.hold_count,rejected_decision_count=excluded.rejected_decision_count,ai_call_count=excluded.ai_call_count,ai_cost_usd=excluded.ai_cost_usd,models_used=excluded.models_used,fallback_count=excluded.fallback_count,error_count=excluded.error_count,forced_close_occurred=excluded.forced_close_occurred,finished_at=excluded.finished_at`,
      [at, day, schedule.timezone, performance.equityUsdt, initialEquityUsdt, performance.realizedPnlUsdt, performance.unrealizedPnlUsdt, num(metrics.gross_pnl), dailyFees.feesUsdtKnown, num(metrics.net_pnl), serializeJsonb(dailyFees.feesByAsset), ((performance.equityUsdt-initialEquityUsdt)/initialEquityUsdt)*100, metrics.trade_count, metrics.buy_count, metrics.sell_count, metrics.hold_count, metrics.rejected_count, metrics.ai_calls, metrics.ai_cost, serializeJsonb(metrics.models ?? []), metrics.fallback_count, metrics.error_count, metrics.forced_close, startedAt, finishedAt],
    );
    // Older sessions predate the explicit counter; the persisted decision
    // evidence is authoritative when recovering their daily result.
    await this.client.query(
      'update trading_sessions set decision_cycles=greatest(decision_cycles,$2),updated_at=$3 where session_day=$1',
      [day, num(metrics.ai_calls), at],
    );
    await this.markDailyResultOk(at);
    return this.dailyResult(day);
  }
  private async feeSummaryForSession(startedAt: Date, finishedAt: Date) {
    const daily = await this.client.query<Row>(
      `select tf.asset, coalesce(sum(tf.amount),0) as amount, coalesce(sum(tf.amount_usdt),0) as amount_usdt
       from trade_fees tf join trades t on t.id=tf.trade_id
       where t.executed_at >= $1 and t.executed_at <= $2 group by tf.asset`,
      [startedAt, finishedAt],
    );
    const feesByAsset: Record<string, number> = {};
    let feesUsdtKnown = 0;
    for (const row of daily.rows) { feesByAsset[String(row.asset)] = num(row.amount); feesUsdtKnown += num(row.amount_usdt); }
    return { feesByAsset, feesUsdtKnown };
  }
  private async feeSummary(day?: string, timezone = defaultTradingConfiguration.timezone) {
    const daily = day
      ? await this.client.query<Row>(
        `select tf.asset, coalesce(sum(tf.amount),0) as amount, coalesce(sum(tf.amount_usdt),0) as amount_usdt
         from trade_fees tf join trades t on t.id=tf.trade_id
         where to_char(t.executed_at at time zone $2,'YYYY-MM-DD')=$1 group by tf.asset`,
        [day, timezone],
      )
      : await this.client.query<Row>('select asset, coalesce(sum(amount),0) as amount, coalesce(sum(amount_usdt),0) as amount_usdt from trade_fees group by asset');
    const feesByAsset: Record<string, number> = {};
    let feesUsdtKnown = 0;
    for (const row of daily.rows) {
      const asset = String(row.asset);
      feesByAsset[asset] = num(row.amount);
      feesUsdtKnown += num(row.amount_usdt);
    }
    return { feesByAsset, feesUsdtKnown };
  }
  /**
   * Reads all report evidence from PostgreSQL.  No exchange call is made here:
   * a completed day is represented by its final daily_result ledger snapshot.
   */
  async dailyReport(day = sessionDay()): Promise<DailyReport> {
    if (!isSessionDay(day)) throw new Error('date must use the YYYY-MM-DD calendar format');
    const localDay = [day];
    const [sessionResult, dailyResult, accountResult, operationResult, aiResult, modelResult, eventResult, pendingResult, rejectedResult, positionResult] = await Promise.all([
      this.client.query<Row>('select * from trading_sessions where session_day=$1', [day]),
      this.client.query<Row>('select * from daily_results where session_day=$1', [day]),
      this.client.query<Row>('select * from trading_account order by id limit 1'),
      this.client.query<Row>(
        `select
           count(*) filter (where side='BUY')::int as buy_count,
           count(*) filter (where side='SELL')::int as sell_count,
           coalesce(sum(net_pnl_usdt) filter (where side='SELL'),0) as net_pnl,
           (select count(*)::int from ai_decisions d join trading_sessions s on s.session_day=$1::date where d.timestamp >= s.started_at and d.timestamp <= coalesce(s.finished_at,now()) and d.action_after_risk='HOLD') as hold_count,
           (select count(*)::int from ai_decisions d join trading_sessions s on s.session_day=$1::date where d.timestamp >= s.started_at and d.timestamp <= coalesce(s.finished_at,now()) and d.action_requested <> d.action_after_risk) as rejected_count,
           (select count(*)::int from ai_decisions d join trading_sessions s on s.session_day=$1::date where d.timestamp >= s.started_at and d.timestamp <= coalesce(s.finished_at,now())) as decision_count
         from trades t join trading_sessions s on s.session_day=$1::date
         where t.executed_at >= s.started_at and t.executed_at <= coalesce(s.finished_at,now())`,
        localDay,
      ),
      this.client.query<Row>(
        `select count(*)::int as calls, coalesce(sum(cost_usd),0) as cost_usd
         from ai_usage u join ai_decisions d on d.id=u.decision_id join trading_sessions s on s.session_day=$1::date
         where d.timestamp >= s.started_at and d.timestamp <= coalesce(s.finished_at,now())`,
        localDay,
      ),
      this.client.query<Row>(
        `select model, count(*)::int as calls from ai_usage
         join ai_decisions d on d.id=ai_usage.decision_id join trading_sessions s on s.session_day=$1::date
         where d.timestamp >= s.started_at and d.timestamp <= coalesce(s.finished_at,now())
         group by model order by model`,
        localDay,
      ),
      this.client.query<Row>(
        `select level,event,message,payload,created_at from system_events
         where created_at >= (select started_at from trading_sessions where session_day=$1::date)
           and created_at <= coalesce((select finished_at from trading_sessions where session_day=$1::date),now()) order by created_at`,
        localDay,
      ),
      this.client.query<Row>(
        `select count(*)::int as count from orders
         where status='PENDING' and created_at >= (select started_at from trading_sessions where session_day=$1::date)
           and created_at <= coalesce((select finished_at from trading_sessions where session_day=$1::date),now())`,
        localDay,
      ),
      this.client.query<Row>(
        `select count(*)::int as count from orders
         where status='REJECTED' and created_at >= (select started_at from trading_sessions where session_day=$1::date)
           and created_at <= coalesce((select finished_at from trading_sessions where session_day=$1::date),now())`,
        localDay,
      ),
      this.client.query<Row>(
        `select exists(
           select 1 from positions
           where opened_at <= (($1::date + coalesce((select end_time from trading_sessions where session_day=$1::date),$2::time)) at time zone coalesce((select timezone from trading_sessions where session_day=$1::date),$3))
             and (closed_at is null or closed_at > (($1::date + coalesce((select end_time from trading_sessions where session_day=$1::date),$2::time)) at time zone coalesce((select timezone from trading_sessions where session_day=$1::date),$3)))
         ) as open_after_end`,
        [day, defaultTradingConfiguration.end, defaultTradingConfiguration.timezone],
      ),
    ]);
    const sessionRow = sessionResult.rows[0];
    const currentConfiguration = await this.configuration();
    const schedule = sessionSchedule(this.configurationForSession(sessionRow, currentConfiguration));
    const dailyRow = dailyResult.rows[0];
    const accountRow = accountResult.rows[0];
    const operations = operationResult.rows[0];
    const usage = aiResult.rows[0];
    const events = eventResult.rows;
    const eventCount = (event: string) => events.filter((row) => String(row.event) === event).length;
    const payloadService = (row: Row) => {
      const payload = row.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
      const service = (payload as Record<string, unknown>).service;
      return typeof service === 'string' ? service.toLowerCase() : '';
    };
    const cycleTimes = events
      .filter((row) => String(row.event) === 'cycle_started')
      .map((row) => new Date(String(row.created_at)).getTime())
      .filter(Number.isFinite);
    let maxCycleGapSeconds: number | null = null;
    for (let index = 1; index < cycleTimes.length; index++) {
      const seconds = (cycleTimes[index] - cycleTimes[index - 1]) / 1000;
      maxCycleGapSeconds = Math.max(maxCycleGapSeconds ?? 0, seconds);
    }
    const models = Object.fromEntries(modelResult.rows.map((row) => [String(row.model), num(row.calls)]));
    const expectedCycles = calculateExpectedDecisionCycles({
      sessionDay: day,
      schedule,
      actualTradingStart: sessionRow?.started_at ? new Date(String(sessionRow.started_at)) : null,
      finishedAt: sessionRow?.finished_at ? new Date(String(sessionRow.finished_at)) : null,
    });
    const initialUsdt = dailyRow?.initial_equity_usdt === null || dailyRow?.initial_equity_usdt === undefined
      ? sessionRow?.initial_equity_usdt === null || sessionRow?.initial_equity_usdt === undefined
        ? accountRow ? num(accountRow.initial_bank_usdt) : null
        : num(sessionRow.initial_equity_usdt)
      : num(dailyRow.initial_equity_usdt);
    const finalUsdt = dailyRow?.final_equity_usdt === null || dailyRow?.final_equity_usdt === undefined
      ? null
      : num(dailyRow.final_equity_usdt);
    const netPnlUsdt = dailyRow?.net_pnl_usdt === null || dailyRow?.net_pnl_usdt === undefined
      ? operations ? num(operations.net_pnl) : null
      : num(dailyRow.net_pnl_usdt);
    const reportInput: DailyReportInput = {
      date: day,
      schedule,
      session: sessionRow ? {
        phase: String(sessionRow.phase),
        startedAt: sessionRow.started_at ? new Date(String(sessionRow.started_at)).toISOString() : null,
        finishedAt: sessionRow.finished_at ? new Date(String(sessionRow.finished_at)).toISOString() : null,
        cyclesExecuted: num(operations.decision_count ?? 0),
        decisionCycles: num(operations.decision_count ?? 0),
        operationalChecks: Math.max(num(sessionRow.operational_checks ?? 0), num(sessionRow.cycles_today ?? 0) - num(operations.decision_count ?? 0)),
        forceCloseAttempts: num(sessionRow.force_close_attempts ?? 0),
        reconciliationRuns: num(sessionRow.reconciliation_runs ?? 0),
      } : null,
      bank: { initialUsdt, finalUsdt, netPnlUsdt },
      operations: {
        buy: num(operations.buy_count), sell: num(operations.sell_count), hold: num(operations.hold_count),
        rejectedByRisk: num(operations.rejected_count), forceClose: events.some((row) => {
          if (String(row.event) !== 'force_close_completed') return false;
          const payload = row.payload;
          return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).orderId === 'string');
        }),
      },
      ai: { calls: num(usage.calls), costUsd: num(usage.cost_usd), fallbacks: eventCount('ai_fallback'), models },
      infrastructure: {
        cyclesExpected: expectedCycles.expectedDecisionCycles,
        cyclesExecuted: num(operations.decision_count ?? 0),
        effectiveStartAt: expectedCycles.effectiveStartAt?.toISOString() ?? null,
        operationalChecks: Math.max(num(sessionRow?.operational_checks ?? 0), num(sessionRow?.cycles_today ?? 0) - num(operations.decision_count ?? 0)),
        forceCloseAttempts: num(sessionRow?.force_close_attempts ?? 0),
        reconciliationRuns: num(sessionRow?.reconciliation_runs ?? 0),
        maxCycleGapSeconds,
        workerRestarts: Math.max(0, eventCount('worker_started') - 1),
        errors: events.filter((row) => String(row.level) === 'ERROR').length,
        binanceErrors: events.filter((row) => String(row.event) === 'external_service_error' && payloadService(row) === 'binance').length,
        openRouterErrors: events.filter((row) => String(row.event) === 'ai_error' || (String(row.event) === 'external_service_error' && payloadService(row) === 'openrouter')).length,
        inconsistencies: eventCount('state_inconsistency_detected'),
        reconciliationIssues: eventCount('reconciliation_failed'),
        pendingOrders: num(pendingResult.rows[0].count),
        rejectedOrders: num(rejectedResult.rows[0].count),
      },
      finalState: { openPosition: Boolean(positionResult.rows[0].open_after_end) },
      consolidationStatus: dailyRow ? 'OK' : sessionRow ? String(sessionRow.consolidation_status ?? 'PENDING') as 'PENDING' | 'OK' | 'ERROR' : null,
    };
    return buildDailyReport(reportInput);
  }
  /**
   * Dashboard read model.  It deliberately selects small, presentation-safe
   * fields instead of returning database rows or AI raw responses.
   */
  async dashboardData(day: string) {
    if (!isSessionDay(day)) throw new Error('date must use YYYY-MM-DD calendar format');
    // Preserve the query shape of the dashboard read model; the effective
    // schedule is resolved from the session snapshot after these reads.
    const localDay = [day, defaultTradingConfiguration.timezone];
    const [accountResult, sessionResult, dailyResult, snapshotsResult, tradesResult, decisionsResult, usageResult, eventsResult] = await Promise.all([
      this.client.query<Row>('select initial_bank_usdt,cash_usdt,realized_pnl_usdt,ai_cost_usd from trading_account order by id limit 1'),
      this.client.query<Row>('select * from trading_sessions where session_day=$1', [day]),
      this.client.query<Row>('select * from daily_results where session_day=$1', [day]),
      this.client.query<Row>(
        `select cash_usdt,equity_usdt,realized_pnl_usdt,unrealized_pnl_usdt,net_pnl_usdt,price,position_quantity,position_cost_usdt,created_at
         from account_snapshots where to_char(created_at at time zone $2,'YYYY-MM-DD')=$1 order by created_at`, localDay),
      this.client.query<Row>(
        `select t.side,t.quantity,t.quote_amount,t.net_quantity,t.net_quote_amount,t.gross_pnl_usdt,t.fees_usdt_known,t.net_pnl_usdt,t.executed_at,o.binance_order_id
         from trades t join orders o on o.id=t.order_id
         where to_char(t.executed_at at time zone $2,'YYYY-MM-DD')=$1 order by t.executed_at desc`, localDay),
      this.client.query<Row>(
        `select timestamp,model_returned,model_requested,action_requested,action_after_risk,amount_requested,amount_after_risk,confidence,reason,rejection_reason
         from ai_decisions where to_char(timestamp at time zone $2,'YYYY-MM-DD')=$1 order by timestamp desc limit 100`, localDay),
      this.client.query<Row>(
        `select coalesce(nullif(d.model_returned,''),u.model) as model,count(*)::int as calls,
                coalesce(sum(u.prompt_tokens),0)::int as prompt_tokens,coalesce(sum(u.completion_tokens),0)::int as completion_tokens,
                coalesce(sum(u.total_tokens),0)::int as total_tokens,coalesce(sum(u.cost_usd),0) as cost_usd
         from ai_usage u left join ai_decisions d on d.id=u.decision_id
         where to_char(u.created_at at time zone $2,'YYYY-MM-DD')=$1
         group by coalesce(nullif(d.model_returned,''),u.model) order by calls desc,model`, localDay),
      this.client.query<Row>(
        `select level,event,message,created_at from system_events
         where to_char(created_at at time zone $2,'YYYY-MM-DD')=$1 order by created_at desc limit 100`, localDay),
    ]);
    const account = accountResult.rows[0];
    const session = sessionResult.rows[0] ?? null;
    const currentConfiguration = await this.configuration();
    const schedule = sessionSchedule(this.configurationForSession(session, currentConfiguration));
    const daily = dailyResult.rows[0] ?? null;
    const snapshots = snapshotsResult.rows.map((row) => ({
      at: new Date(String(row.created_at)).toISOString(), cashUsdt: num(row.cash_usdt), equityUsdt: num(row.equity_usdt),
      realizedPnlUsdt: num(row.realized_pnl_usdt), unrealizedPnlUsdt: num(row.unrealized_pnl_usdt), netPnlUsdt: num(row.net_pnl_usdt),
      price: num(row.price), positionQuantity: row.position_quantity === null ? null : num(row.position_quantity),
      positionCostUsdt: row.position_cost_usdt === null ? null : num(row.position_cost_usdt),
    }));
    const latest = snapshots.at(-1) ?? null;
    const initialBankUsdt = daily?.initial_equity_usdt === null || daily?.initial_equity_usdt === undefined
      ? session?.initial_equity_usdt === null || session?.initial_equity_usdt === undefined
        ? account ? num(account.initial_bank_usdt) : null : num(session.initial_equity_usdt)
      : num(daily.initial_equity_usdt);
    const decisions = decisionsResult.rows.map((row) => ({
      at: new Date(String(row.timestamp)).toISOString(), model: row.model_returned ?? row.model_requested,
      actionRequested: row.action_requested, actionAfterRisk: row.action_after_risk,
      amountRequested: num(row.amount_requested), amountAfterRisk: num(row.amount_after_risk), confidence: num(row.confidence),
      reason: row.reason, rejectionReason: row.rejection_reason,
    }));
    const decisionCounts = { BUY: 0, SELL: 0, HOLD: 0, rejectedByRisk: 0 };
    for (const decision of decisions) {
      const action = String(decision.actionAfterRisk) as 'BUY' | 'SELL' | 'HOLD';
      if (action in decisionCounts) decisionCounts[action]++;
      if (decision.actionRequested !== decision.actionAfterRisk) decisionCounts.rejectedByRisk++;
    }
    const models = usageResult.rows.map((row) => ({ model: String(row.model), calls: num(row.calls), promptTokens: num(row.prompt_tokens), completionTokens: num(row.completion_tokens), totalTokens: num(row.total_tokens), costUsd: num(row.cost_usd) }));
    const fallbackCount = eventsResult.rows.filter((row) => String(row.event) === 'ai_fallback').length;
    const errorCount = eventsResult.rows.filter((row) => String(row.level) === 'ERROR').length;
    const liveToday = day === sessionDay();
    const finalEquity = liveToday && latest
      ? latest.equityUsdt
      : daily?.final_equity_usdt === null || daily?.final_equity_usdt === undefined
        ? latest?.equityUsdt ?? null
        : num(daily.final_equity_usdt);
    const dailyTradesRealizedPnl = tradesResult.rows
      .filter((row) => row.side === 'SELL')
      .reduce((sum, row) => sum + num(row.net_pnl_usdt), 0);
    const realizedPnlUsdt = daily?.realized_pnl_usdt !== null && daily?.realized_pnl_usdt !== undefined
      ? num(daily.realized_pnl_usdt)
      : dailyTradesRealizedPnl;
    const unrealizedPnlUsdt = latest && latest.positionQuantity && latest.positionCostUsdt
      ? latest.positionQuantity * latest.price - latest.positionCostUsdt
      : (daily?.unrealized_pnl_usdt !== null && daily?.unrealized_pnl_usdt !== undefined ? num(daily.unrealized_pnl_usdt) : 0);
    const netPnlUsdt = daily?.net_pnl_usdt !== null && daily?.net_pnl_usdt !== undefined
      ? num(daily.net_pnl_usdt)
      : (initialBankUsdt !== null && finalEquity !== null ? finalEquity - initialBankUsdt : realizedPnlUsdt + unrealizedPnlUsdt);
    return {
      schedule: { timezone: schedule.timezone, startTime: schedule.start, stopNewPositionsTime: schedule.stopNewPositions, forceCloseTime: schedule.forceClose, endTime: schedule.end, intervalSeconds: schedule.intervalSeconds },
      session: session && { day, phase: String(session.phase), timezone: String(session.timezone), startedAt: session.started_at ? new Date(String(session.started_at)).toISOString() : null, finishedAt: session.finished_at ? new Date(String(session.finished_at)).toISOString() : null, lastCycleAt: session.last_cycle_at ? new Date(String(session.last_cycle_at)).toISOString() : null, nextCycleAt: session.next_cycle_at ? new Date(String(session.next_cycle_at)).toISOString() : null, cyclesToday: num(session.cycles_today) },
      account: { initialBankUsdt, cashUsdt: latest?.cashUsdt ?? (day === sessionDay() && account ? num(account.cash_usdt) : null), equityUsdt: finalEquity, aiCostUsd: daily?.ai_cost_usd === null || daily?.ai_cost_usd === undefined ? models.reduce((total, model) => total + model.costUsd, 0) : num(daily.ai_cost_usd) },
      performance: { realizedPnlUsdt, unrealizedPnlUsdt, netPnlUsdt, returnPct: initialBankUsdt && finalEquity !== null ? ((finalEquity - initialBankUsdt) / initialBankUsdt) * 100 : null },
      position: latest?.positionQuantity ? { symbol: config.SYMBOL.replace('USDT', ''), quantity: latest.positionQuantity, costUsdt: latest.positionCostUsdt, price: latest.price } : null,
      decisions, decisionCounts, trades: tradesResult.rows.map((row) => ({ at: new Date(String(row.executed_at)).toISOString(), side: row.side, quantity: num(row.quantity), quoteAmount: num(row.quote_amount), netQuantity: row.net_quantity === null ? null : num(row.net_quantity), netQuoteAmount: row.net_quote_amount === null ? null : num(row.net_quote_amount), grossPnlUsdt: row.gross_pnl_usdt === null ? null : num(row.gross_pnl_usdt), feesUsdtKnown: num(row.fees_usdt_known), netPnlUsdt: row.net_pnl_usdt === null ? null : num(row.net_pnl_usdt), binanceOrderId: row.binance_order_id })),
      aiUsage: { models, fallbacks: fallbackCount, totalTokens: models.reduce((total, model) => total + model.totalTokens, 0), totalCostUsd: models.reduce((total, model) => total + model.costUsd, 0) },
      events: eventsResult.rows.map((row) => ({ level: row.level, event: row.event, message: row.message, at: new Date(String(row.created_at)).toISOString() })),
      equityHistory: snapshots.map(({ at, cashUsdt, equityUsdt }) => ({ at, cashUsdt, equityUsdt })),
      pnlHistory: snapshots.map(({ at, equityUsdt, realizedPnlUsdt: r, netPnlUsdt: t }) => {
        if (daily?.net_pnl_usdt !== null && daily?.net_pnl_usdt !== undefined) return { at, realizedPnlUsdt: r, totalPnlUsdt: t };
        const totalPnl = initialBankUsdt !== null ? equityUsdt - initialBankUsdt : t;
        return { at, realizedPnlUsdt: totalPnl, totalPnlUsdt: totalPnl };
      }),
      summary: daily && { final: daily.final_equity_usdt !== null && daily.final_equity_usdt !== undefined, tradeCount: num(daily.trade_count), buyCount: num(daily.buy_count), sellCount: num(daily.sell_count), holdCount: num(daily.hold_count), rejectedDecisionCount: num(daily.rejected_decision_count), feesUsdtKnown: num(daily.fees_usdt_known), fallbackCount: num(daily.fallback_count), errorCount: num(daily.error_count), forceCloseOccurred: Boolean(daily.forced_close_occurred), openPosition: false },
      eventCounts: { errors: errorCount },
    };
  }
  async performance(price: number) {
    const a = await this.account();
    const p = await this.openPosition();
    const unrealized = p ? p.quantity * price - p.costUsdt : 0;
    const [fees, realizedGross, openingUsdtFees] = await Promise.all([
      this.feeSummary(),
      this.client.query<Row>("select coalesce(sum(gross_pnl_usdt),0) as gross from trades where side='SELL'"),
      p ? this.client.query<Row>(
        "select coalesce(sum(tf.amount_usdt),0) as fees from trade_fees tf join trades t on t.id=tf.trade_id where t.position_id=$1 and t.side='BUY'",
        [p.id],
      ) : Promise.resolve({ rows: [{ fees: 0 }] }),
    ]);
    const grossUnrealized = p ? p.quantity * price - (p.costUsdt - num(openingUsdtFees.rows[0].fees)) : 0;
    const grossPnlUsdt = num(realizedGross.rows[0].gross) + grossUnrealized;
    return {
      initialBankUsdt: a.initialBankUsdt,
      cashUsdt: a.cashUsdt,
      equityUsdt: a.cashUsdt + (p ? p.quantity * price : 0),
      realizedPnlUsdt: a.realizedPnlUsdt,
      unrealizedPnlUsdt: unrealized,
      grossPnlUsdt,
      feesUsdtKnown: fees.feesUsdtKnown,
      netPnlUsdt: a.realizedPnlUsdt + unrealized,
      feesByAsset: fees.feesByAsset,
      aiCostUsd: a.aiCostUsd,
      tradeCount: Number((await this.client.query('select count(*) from trades')).rows[0].count),
    };
  }
}
