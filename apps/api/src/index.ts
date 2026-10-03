import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, isSessionDay, logger, sessionDay, sessionPhase, sessionSchedule } from '@bolinha/core';
import { TradingRepository } from '@bolinha/database';
import { BinanceTestnetClient } from '@bolinha/exchange';
import { TradingService } from '@bolinha/worker/service';
const app=Fastify({loggerInstance:logger});const repo=new TradingRepository();const binance=new BinanceTestnetClient(config.BINANCE_API_KEY,config.BINANCE_API_SECRET,config.SYMBOL);const service=new TradingService(repo,binance);
const dashboardDirectory = resolve(import.meta.dirname, '../public/dashboard');
const numberOrNull = (value: unknown) => value === null || value === undefined ? null : Number(value);
const tradeResponse = (trade: Record<string, unknown>) => ({
  ...trade,
  netQuantity: numberOrNull(trade.net_quantity), netQuoteAmount: numberOrNull(trade.net_quote_amount),
  grossPnlUsdt: numberOrNull(trade.gross_pnl_usdt), feesUsdtKnown: numberOrNull(trade.fees_usdt_known),
  netPnlUsdt: numberOrNull(trade.net_pnl_usdt), feesByAsset: trade.fees_by_asset,
});
const dailyPerformanceResponse = (result: Record<string, unknown> | null) => result && ({
  ...result,
  grossPnlUsdt: numberOrNull(result.gross_pnl_usdt), feesUsdtKnown: numberOrNull(result.fees_usdt_known),
  netPnlUsdt: numberOrNull(result.net_pnl_usdt), feesByAsset: result.fees_by_asset ?? {},
});
app.get('/health', async () => {
  let database = 'UP'; let binanceStatus = 'UP'; let openRouter = 'UP';
  try { await repo.health(); } catch { database = 'DOWN'; }
  if (!(await binance.pingPublic())) binanceStatus = 'DOWN';
  if (!config.OPENROUTER_API_KEY) openRouter = 'DOWN';
  const at = new Date(); const phase = sessionPhase(at);
  const hb = database === 'UP' ? await repo.lastHeartbeat() : null;
  const heartbeatDate = hb?.created_at ? new Date(String(hb.created_at)) : null;
  const worker = !heartbeatDate ? 'DOWN' : Date.now() - heartbeatDate.getTime() > config.TRADING_INTERVAL_SECONDS * 2500 ? 'STALE' : 'UP';
  const state = database === 'UP' ? await repo.session(at) : null;
  const reconciliation = database === 'UP' ? await repo.reconciliationState() : null;
  const dailyResultStatus = database === 'UP' ? await repo.dailyResultStatus(sessionDay(at)) : null;
  const pendingOrders = database === 'UP' ? await repo.pendingOrderCount() : 0;
  const lastCycleAt = state?.last_cycle_at ? new Date(String(state.last_cycle_at)) : null;
  const cycleStale = Boolean(config.TRADING_LOOP_ENABLED && phase === 'TRADING' && (!lastCycleAt || at.getTime() - lastCycleAt.getTime() > config.TRADING_INTERVAL_SECONDS * 3000));
  const degraded = database !== 'UP' || worker !== 'UP' || binanceStatus !== 'UP' || openRouter !== 'UP' || reconciliation?.status !== 'OK' || cycleStale;
  const status = database !== 'UP' || worker === 'DOWN' ? 'ERROR' : degraded ? 'DEGRADED' : phase === 'BEFORE_START' ? 'WAITING' : phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING' ? 'FORCE CLOSE' : phase === 'FINISHED' ? 'FINISHED' : 'RUNNING';
  return { status, database, worker, lastWorkerHeartbeat: heartbeatDate?.toISOString() ?? null, lastCycleAt: lastCycleAt?.toISOString() ?? null, cycleStale, sessionPhase: state?.phase ?? phase, dailyResultStatus, binance: binanceStatus, openRouter, loopEnabled: config.TRADING_LOOP_ENABLED, openPosition: database === 'UP' ? Boolean(await repo.openPosition()) : false, reconciliationStatus: reconciliation?.status ?? 'ERROR', pendingOrders, stateConsistent: reconciliation?.stateConsistent ?? false, timestamp: at.toISOString() };
});
app.get('/dashboard', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'index.html'), 'utf8')));
app.get('/dashboard/dashboard.css', async (_request, reply) => reply.type('text/css; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'dashboard.css'), 'utf8')));
app.get('/dashboard/dashboard.js', async (_request, reply) => reply.type('application/javascript; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'dashboard.js'), 'utf8')));
app.get('/dashboard/data', async (request, reply) => {
  const { date = sessionDay() } = request.query as { date?: string };
  if (!isSessionDay(date)) return reply.code(400).send({ error: 'date must use YYYY-MM-DD' });
  const historical = date !== sessionDay();
  const data = await repo.dashboardData(date);
  if (historical) return {
    date, historical, timezone: config.TRADING_TIMEZONE,
    health: { status: data.summary?.final ? 'FINISHED' : 'HISTORICAL', database: 'HISTORICAL', worker: 'HISTORICAL', binance: 'HISTORICAL', openRouter: 'HISTORICAL', reconciliationStatus: 'HISTORICAL', loopEnabled: false, lastWorkerHeartbeat: null, lastCycleAt: data.session?.lastCycleAt ?? null, cycleStale: false, pendingOrders: 0, stateConsistent: true, timestamp: new Date().toISOString(), sessionPhase: data.session?.phase ?? 'UNKNOWN', openPosition: Boolean(data.position) },
    ...data,
  };
  // Only the current dashboard probes live health; a historical view reads PostgreSQL only.
  const response = await app.inject({ method: 'GET', url: '/health' });
  return { date, historical, timezone: config.TRADING_TIMEZONE, health: response.json(), ...data };
});
app.get('/status', async () => {
  await repo.ensureAccount(config.INITIAL_BANK_USDT);
  const at = new Date(); const price = await binance.price();
  const [state, performance, daily, reconciliation, pendingOrderCount, dailyResultStatus] = await Promise.all([repo.session(at), repo.performance(price), repo.dailyResult(sessionDay(at)), repo.reconciliationState(), repo.pendingOrderCount(), repo.dailyResultStatus(sessionDay(at))]);
  const schedule = sessionSchedule();
  const tradingBlockedReason = reconciliation.status !== 'OK' || !reconciliation.stateConsistent || pendingOrderCount > 0
    ? reconciliation.lastError ?? (pendingOrderCount > 0 ? `${pendingOrderCount} pending order(s) require reconciliation` : `Reconciliation is ${reconciliation.status}`)
    : null;
  const decisionCyclesToday = Number(daily?.ai_call_count ?? state?.decision_cycles ?? 0);
  const operationalChecksToday = Math.max(Number(state?.operational_checks ?? 0), Number(state?.cycles_today ?? 0) - decisionCyclesToday);
  return { ...performance, loopEnabled: config.TRADING_LOOP_ENABLED, tradingIntervalSeconds: config.TRADING_INTERVAL_SECONDS, timezone: schedule.timezone, sessionPhase: state?.phase ?? sessionPhase(at), sessionStartedAt: state?.started_at ?? null, sessionFinishedAt: state?.finished_at ?? null, decisionCyclesToday, operationalChecksToday, forceCloseAttemptsToday: Number(state?.force_close_attempts ?? 0), dailyResultStatus, tradingStartTime: schedule.start, stopNewPositionsTime: schedule.stopNewPositions, forceCloseTime: schedule.forceClose, tradingEndTime: schedule.end, nextCycleAt: state?.next_cycle_at ?? null, lastCycleAt: state?.last_cycle_at ?? null, cyclesToday: decisionCyclesToday, currentBank: performance.cashUsdt, openPosition: await repo.openPosition(), pnlToday: performance.realizedPnlUsdt + performance.unrealizedPnlUsdt, aiCostToday: daily?.ai_cost_usd ?? 0, tradesToday: daily?.trade_count ?? 0, errorsToday: daily?.error_count ?? 0, lastDecision: await repo.lastDecision(), lastWorkerHeartbeat: await repo.lastHeartbeat(), modelList: config.OPENROUTER_MODELS.split(','), pendingOrderCount, reconciliationStatus: reconciliation.status, lastReconciliationAt: reconciliation.lastReconciliationAt?.toISOString() ?? null, lastReconciliationError: reconciliation.lastError, tradingBlockedReason };
});
app.get('/positions',()=>repo.positions());app.get('/trades',async()=> (await repo.trades()).map(tradeResponse));app.get('/decisions',()=>repo.decisions());app.get('/system/events',()=>repo.events());app.get('/performance',async()=>repo.performance(await binance.price()));app.get('/performance/daily',async()=>dailyPerformanceResponse(await repo.dailyResult()));
app.get('/reports/daily/:date', async (request, reply) => {
  const { date } = request.params as { date: string };
  if (!isSessionDay(date)) return reply.code(400).send({ error: 'date must use YYYY-MM-DD' });
  return repo.dailyReport(date);
});
app.get('/reports/today', async () => repo.dailyReport(sessionDay()));
app.post('/trading/run-once',async(_request,reply)=>{try{return await service.runOnce();}catch(error){return reply.code(503).send({error:error instanceof Error?error.message:'Cycle failed'});}});
export const dashboardApp: Pick<FastifyInstance, 'inject' | 'close'> = app;
if (process.env.NODE_ENV !== 'test') await app.listen({host:config.API_HOST,port:config.API_PORT});
