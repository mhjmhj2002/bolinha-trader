import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, defaultTradingConfiguration, isSessionDay, logger, sessionDay, sessionPhase, validateTradingConfiguration } from '@bolinha/core';
import { ConfigurationBlockedError, TradingRepository } from '@bolinha/database';
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
const configurationResponse = (configuration: Awaited<ReturnType<TradingRepository['configuration']>>) => ({
  id: 1,
  timezone: configuration.timezone, startTime: configuration.start, stopNewPositionsTime: configuration.stopNewPositions,
  forceCloseTime: configuration.forceClose, endTime: configuration.end, intervalSeconds: configuration.intervalSeconds,
  initialBankUsdt: configuration.initialBankUsdt, maxPositionPercent: configuration.maxPositionPercent,
  updatedAt: configuration.updatedAt?.toISOString() ?? null,
});
const configurationInput = (body: unknown) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('configuration body is required');
  const value = body as Record<string, unknown>;
  const candidate = {
    timezone: String(value.timezone ?? ''), start: String(value.startTime ?? ''), stopNewPositions: String(value.stopNewPositionsTime ?? ''),
    forceClose: String(value.forceCloseTime ?? ''), end: String(value.endTime ?? ''), intervalSeconds: Number(value.intervalSeconds),
    initialBankUsdt: Number(value.initialBankUsdt), maxPositionPercent: Number(value.maxPositionPercent),
  };
  // Keep validation at the HTTP boundary, before the repository repeats it in
  // the transaction that commits the change.
  return validateTradingConfiguration(candidate);
};
const configurationIdIsSingleton = (id: string | undefined) => id === undefined || id === '1';
app.get('/health', async () => {
  let database = 'UP'; let binanceStatus = 'UP'; let openRouter = 'UP';
  try { await repo.health(); } catch { database = 'DOWN'; }
  if (!(await binance.pingPublic())) binanceStatus = 'DOWN';
  if (!config.OPENROUTER_API_KEY) openRouter = 'DOWN';
  const operational = database === 'UP' ? await repo.configuration() : defaultTradingConfiguration;
  const at = new Date(); const phase = sessionPhase(at, operational);
  const hb = database === 'UP' ? await repo.lastHeartbeat() : null;
  const heartbeatDate = hb?.created_at ? new Date(String(hb.created_at)) : null;
  const worker = !heartbeatDate ? 'DOWN' : Date.now() - heartbeatDate.getTime() > operational.intervalSeconds * 2500 ? 'STALE' : 'UP';
  const state = database === 'UP' ? await repo.session(at, operational.timezone) : null;
  const reconciliation = database === 'UP' ? await repo.reconciliationState() : null;
  const dailyResultStatus = database === 'UP' ? await repo.dailyResultStatus(sessionDay(at, operational.timezone)) : null;
  const pendingOrders = database === 'UP' ? await repo.pendingOrderCount() : 0;
  const lastCycleAt = state?.last_cycle_at ? new Date(String(state.last_cycle_at)) : null;
  const cycleStale = Boolean(config.TRADING_LOOP_ENABLED && phase === 'TRADING' && (!lastCycleAt || at.getTime() - lastCycleAt.getTime() > operational.intervalSeconds * 3000));
  const degraded = database !== 'UP' || worker !== 'UP' || binanceStatus !== 'UP' || openRouter !== 'UP' || reconciliation?.status !== 'OK' || cycleStale;
  const status = database !== 'UP' || worker === 'DOWN' ? 'ERROR' : degraded ? 'DEGRADED' : phase === 'BEFORE_START' ? 'WAITING' : phase === 'FORCE_CLOSE' || phase === 'FORCE_CLOSE_PENDING' ? 'FORCE CLOSE' : phase === 'FINISHED' ? 'FINISHED' : 'RUNNING';
  return { status, database, worker, lastWorkerHeartbeat: heartbeatDate?.toISOString() ?? null, lastCycleAt: lastCycleAt?.toISOString() ?? null, cycleStale, sessionPhase: state?.phase ?? phase, dailyResultStatus, binance: binanceStatus, openRouter, loopEnabled: config.TRADING_LOOP_ENABLED, openPosition: database === 'UP' ? Boolean(await repo.openPosition()) : false, reconciliationStatus: reconciliation?.status ?? 'ERROR', pendingOrders, stateConsistent: reconciliation?.stateConsistent ?? false, timestamp: at.toISOString() };
});
app.get('/dashboard', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'index.html'), 'utf8')));
app.get('/dashboard/configuration', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'configuration.html'), 'utf8')));
app.get('/dashboard/dashboard.css', async (_request, reply) => reply.type('text/css; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'dashboard.css'), 'utf8')));
app.get('/dashboard/dashboard.js', async (_request, reply) => reply.type('application/javascript; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'dashboard.js'), 'utf8')));
app.get('/dashboard/configuration.js', async (_request, reply) => reply.type('application/javascript; charset=utf-8').send(await readFile(resolve(dashboardDirectory, 'configuration.js'), 'utf8')));
app.get('/dashboard/data', async (request, reply) => {
  const query = request.query as { date?: string };
  if (query.date && !isSessionDay(query.date)) return reply.code(400).send({ error: 'date must use YYYY-MM-DD' });
  const operational = await repo.configuration();
  const date = query.date ?? sessionDay(new Date(), operational.timezone);
  const historical = date !== sessionDay(new Date(), operational.timezone);
  const data = await repo.dashboardData(date);
  if (historical) return {
    date, historical, timezone: data.schedule.timezone,
    health: { status: data.summary?.final ? 'FINISHED' : 'HISTORICAL', database: 'HISTORICAL', worker: 'HISTORICAL', binance: 'HISTORICAL', openRouter: 'HISTORICAL', reconciliationStatus: 'HISTORICAL', loopEnabled: false, lastWorkerHeartbeat: null, lastCycleAt: data.session?.lastCycleAt ?? null, cycleStale: false, pendingOrders: 0, stateConsistent: true, timestamp: new Date().toISOString(), sessionPhase: data.session?.phase ?? 'UNKNOWN', openPosition: Boolean(data.position) },
    ...data,
  };
  // Only the current dashboard probes live health; a historical view reads PostgreSQL only.
  const response = await app.inject({ method: 'GET', url: '/health' });
  return { date, historical, timezone: data.schedule.timezone, health: response.json(), ...data };
});
const configurationStateResponse = async () => {
  const configuration = await repo.configuration();
  const state = await repo.configurationEditability(new Date(), configuration);
  await repo.event('INFO', 'configuration_viewed', 'Operational configuration viewed', {
    editable: state.editable, blockedReason: state.blockedReason, sessionPhase: state.sessionPhase,
  });
  return { ...configurationResponse(configuration), currentConfiguration: configurationResponse(configuration), ...state, loopEnabled: config.TRADING_LOOP_ENABLED };
};
app.get('/configuration', configurationStateResponse);
app.get('/configuration/:id', async (request, reply) => {
  if (!configurationIdIsSingleton((request.params as { id?: string }).id)) return reply.code(404).send({ error: 'configuration not found' });
  return configurationStateResponse();
});
const saveConfiguration = async (body: unknown, eventName: 'configuration_updated' | 'configuration_created') => {
  const next = configurationInput(body);
  const configuration = await repo.updateConfiguration(next, new Date(), eventName);
  return { ...configurationResponse(configuration), editable: true, blockedReason: null };
};
const sendConfigurationMutationError = (error: unknown, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => {
  if (error instanceof ConfigurationBlockedError)
    return reply.code(409).send({ error: error.message, blockedReason: error.state.blockedReason, sessionPhase: error.state.sessionPhase });
  if (error instanceof Error) return reply.code(400).send({ error: error.message });
  return reply.code(400).send({ error: 'invalid configuration' });
};
app.post('/configuration', async (request, reply) => {
  try { return reply.code(201).send(await saveConfiguration(request.body, 'configuration_created')); }
  catch (error) { return sendConfigurationMutationError(error, reply); }
});
app.put('/configuration/:id', async (request, reply) => {
  if (!configurationIdIsSingleton((request.params as { id?: string }).id)) return reply.code(404).send({ error: 'configuration not found' });
  try { return await saveConfiguration(request.body, 'configuration_updated'); }
  catch (error) { return sendConfigurationMutationError(error, reply); }
});
app.put('/configuration', async (request, reply) => {
  try { return await saveConfiguration(request.body, 'configuration_updated'); }
  catch (error) { return sendConfigurationMutationError(error, reply); }
});
app.delete('/configuration/:id', async (request, reply) => {
  if (!configurationIdIsSingleton((request.params as { id?: string }).id)) return reply.code(404).send({ error: 'configuration not found' });
  // There must always be one active configuration for the worker. Versioning
  // preserves old values, so deleting the sole live row is intentionally not a
  // supported operation.
  return reply.code(409).send({ error: 'A configuração operacional única não pode ser desativada.' });
});
app.get('/status', async () => {
  const operational = await repo.configuration();
  await repo.ensureAccount(operational.initialBankUsdt);
  const at = new Date(); const price = await binance.price();
  const [state, performance, daily, reconciliation, pendingOrderCount, dailyResultStatus] = await Promise.all([repo.session(at, operational.timezone), repo.performance(price), repo.dailyResult(sessionDay(at, operational.timezone)), repo.reconciliationState(), repo.pendingOrderCount(), repo.dailyResultStatus(sessionDay(at, operational.timezone))]);
  const tradingBlockedReason = reconciliation.status !== 'OK' || !reconciliation.stateConsistent || pendingOrderCount > 0
    ? reconciliation.lastError ?? (pendingOrderCount > 0 ? `${pendingOrderCount} pending order(s) require reconciliation` : `Reconciliation is ${reconciliation.status}`)
    : null;
  const decisionCyclesToday = Number(daily?.ai_call_count ?? state?.decision_cycles ?? 0);
  const operationalChecksToday = Math.max(Number(state?.operational_checks ?? 0), Number(state?.cycles_today ?? 0) - decisionCyclesToday);
  const effective = repo.configurationForSession(state, operational);
  const configuration = { timezone: effective.timezone, startTime: effective.start, stopNewPositionsTime: effective.stopNewPositions, forceCloseTime: effective.forceClose, endTime: effective.end, intervalSeconds: effective.intervalSeconds };
  return { ...performance, loopEnabled: config.TRADING_LOOP_ENABLED, tradingIntervalSeconds: effective.intervalSeconds, timezone: effective.timezone, sessionPhase: state?.phase ?? sessionPhase(at, effective), sessionStartedAt: state?.started_at ?? null, sessionFinishedAt: state?.finished_at ?? null, decisionCyclesToday, operationalChecksToday, forceCloseAttemptsToday: Number(state?.force_close_attempts ?? 0), dailyResultStatus, tradingStartTime: effective.start, stopNewPositionsTime: effective.stopNewPositions, forceCloseTime: effective.forceClose, tradingEndTime: effective.end, configuration, configurationUpdatedAt: operational.updatedAt?.toISOString() ?? null, nextCycleAt: state?.next_cycle_at ?? null, lastCycleAt: state?.last_cycle_at ?? null, cyclesToday: decisionCyclesToday, currentBank: performance.cashUsdt, openPosition: await repo.openPosition(), pnlToday: performance.realizedPnlUsdt + performance.unrealizedPnlUsdt, aiCostToday: daily?.ai_cost_usd ?? 0, tradesToday: daily?.trade_count ?? 0, errorsToday: daily?.error_count ?? 0, lastDecision: await repo.lastDecision(), lastWorkerHeartbeat: await repo.lastHeartbeat(), modelList: config.OPENROUTER_MODELS.split(','), pendingOrderCount, reconciliationStatus: reconciliation.status, lastReconciliationAt: reconciliation.lastReconciliationAt?.toISOString() ?? null, lastReconciliationError: reconciliation.lastError, tradingBlockedReason };
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
