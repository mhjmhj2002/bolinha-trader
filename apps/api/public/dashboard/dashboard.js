/* global Chart, document, window */
(() => {
  const charts = {};
  let data = null;
  const $ = (id) => document.getElementById(id);
  const timezone = () => data?.schedule?.timezone || data?.timezone || 'UTC';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: timezone() }).format(new Date());
  const number = (value, digits = 2) => value === null || value === undefined ? '—' : Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const money = (value, currency = 'USDT') => value === null || value === undefined ? '—' : `${Number(value) >= 0 ? '' : '-'}${currency === 'US$' ? 'US$ ' : ''}${number(Math.abs(value))}${currency === 'USDT' ? ' USDT' : ''}`;
  const signedMoney = (value) => value === null || value === undefined ? '—' : `${Number(value) >= 0 ? '+' : '-'}${number(Math.abs(value))} USDT`;
  const time = (iso) => iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone(), hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) : '—';
  const dateTime = (iso) => iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone(), dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';
  const escape = (value) => String(value ?? '—').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const badge = (value) => {
    const status = String(value || '—');
    const style = /^(UP|OK|RUNNING|BUY)$/i.test(status) ? 'success' : /^(WARN|WAITING|HOLD|DEGRADED|STALE|FORCE CLOSE)$/i.test(status) ? 'warning' : /^(DOWN|ERROR|SELL)$/i.test(status) ? 'danger' : 'secondary';
    return `<span class="badge text-bg-${style}">${escape(status)}</span>`;
  };
  const empty = (columns, message) => `<tr><td colspan="${columns}" class="empty-cell py-3">${escape(message)}</td></tr>`;
  const healthTone = (value) => /^(UP|OK|RUNNING)$/i.test(value) ? 'success' : /^(DOWN|ERROR)$/i.test(value) ? 'danger' : /^(STALE|DEGRADED|WAITING|FORCE CLOSE)$/i.test(value) ? 'warning' : 'secondary';

  function chart(id, type, labels, datasets, options = {}) {
    if (!window.Chart) return;
    charts[id]?.destroy();
    charts[id] = new Chart($(id), { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, ...options } });
  }
  function renderHealth(payload) {
    const health = payload.health;
    const rows = [
      ['Horário', time(health.timestamp)], ['Loop', health.loopEnabled ? 'ON' : 'OFF'], ['Fase', health.sessionPhase], ['Worker', health.worker],
      ['Binance', health.binance], ['OpenRouter', health.openRouter], ['PostgreSQL', health.database], ['Reconciliação', health.reconciliationStatus],
      ['Último ciclo', time(health.lastCycleAt)], ['Próximo ciclo', time(payload.session?.nextCycleAt)], ['Pendentes', health.pendingOrders], ['Heartbeat', time(health.lastWorkerHeartbeat)],
    ];
    $('health-grid').innerHTML = rows.map(([name, value]) => `<div class="col-6 col-md-3 col-xl-2"><div class="status-item ${healthTone(value)}"><span class="status-name">${name}</span><span class="status-value">${escape(value)}</span></div></div>`).join('');
  }
  function renderMetrics(payload) {
    const { account, performance, position, trades, aiUsage, eventCounts } = payload;
    $('metric-bank').textContent = money(account.equityUsdt);
    $('metric-initial').textContent = `Inicial: ${money(account.initialBankUsdt)}`;
    $('metric-pnl').textContent = signedMoney(performance.netPnlUsdt);
    $('metric-pnl').className = `metric-value ${Number(performance.netPnlUsdt) < 0 ? 'text-danger' : Number(performance.netPnlUsdt) > 0 ? 'text-success' : ''}`;
    $('metric-return').textContent = performance.returnPct === null ? '—' : `${Number(performance.returnPct) >= 0 ? '+' : ''}${number(performance.returnPct)}%`;
    $('metric-position').textContent = position ? `${position.symbol} ${number(position.quantity, 8)}` : 'SEM POSIÇÃO';
    $('metric-position-detail').textContent = position ? `Custo: ${money(position.costUsdt)}` : '—';
    $('metric-trades').textContent = String(trades.length);
    $('metric-ai-cost').textContent = money(account.aiCostUsd, 'US$');
    $('metric-tokens').textContent = `${number(aiUsage.totalTokens, 0)} tokens`;
    $('metric-errors').textContent = String(eventCounts.errors);
    $('metric-errors').className = `metric-value ${eventCounts.errors ? 'text-danger' : 'text-success'}`;
    $('metric-fallbacks').textContent = `${aiUsage.fallbacks} fallback(s)`;
  }
  function renderCharts(payload) {
    const labels = payload.equityHistory.map((point) => time(point.at));
    chart('equity-chart', 'line', labels, [
      { label: 'Patrimônio', data: payload.equityHistory.map((point) => point.equityUsdt), borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,.12)', fill: true, tension: .25 },
      { label: 'Caixa', data: payload.equityHistory.map((point) => point.cashUsdt), borderColor: '#6c757d', borderDash: [5, 5], tension: .25 },
    ], { scales: { y: { title: { display: true, text: 'USDT' } } } });
    const counts = payload.decisionCounts;
    chart('decisions-chart', 'doughnut', ['BUY', 'SELL', 'HOLD'], [{ data: [counts.BUY, counts.SELL, counts.HOLD], backgroundColor: ['#198754', '#dc3545', '#6c757d'] }]);
    $('rejected-decisions').textContent = `${counts.rejectedByRisk} decisão(ões) rejeitada(s) pelo risco`;
    chart('pnl-chart', 'line', payload.pnlHistory.map((point) => time(point.at)), [
      { label: 'P/L total', data: payload.pnlHistory.map((point) => point.totalPnlUsdt), borderColor: '#198754', tension: .25 },
      { label: 'P/L realizado', data: payload.pnlHistory.map((point) => point.realizedPnlUsdt), borderColor: '#6f42c1', tension: .25 },
    ], { scales: { y: { title: { display: true, text: 'USDT' } } } });
    chart('models-chart', 'bar', payload.aiUsage.models.map((model) => model.model), [{ label: 'Chamadas', data: payload.aiUsage.models.map((model) => model.calls), backgroundColor: '#0d6efd' }], { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } });
  }
  function renderTables(payload) {
    $('trades-table').innerHTML = payload.trades.length ? payload.trades.map((trade) => `<tr><td>${time(trade.at)}</td><td>${badge(trade.side)}</td><td>${number(trade.netQuantity ?? trade.quantity, 8)}</td><td>${trade.quantity ? money(trade.quoteAmount / trade.quantity).replace(' USDT', '') : '—'}</td><td>${money(trade.netQuoteAmount ?? trade.quoteAmount)}</td><td>${money(trade.feesUsdtKnown)}</td><td class="${Number(trade.netPnlUsdt) < 0 ? 'text-danger' : Number(trade.netPnlUsdt) > 0 ? 'text-success' : ''}">${trade.netPnlUsdt === null ? '—' : signedMoney(trade.netPnlUsdt)}</td><td class="font-monospace small">${escape(trade.binanceOrderId)}</td></tr>`).join('') : empty(8, 'Nenhum trade no dia.');
    $('decisions-table').innerHTML = payload.decisions.length ? payload.decisions.map((decision) => `<tr class="${decision.actionRequested !== decision.actionAfterRisk ? 'table-warning' : ''}"><td>${time(decision.at)}</td><td class="small">${escape(decision.model)}</td><td>${badge(decision.actionRequested)}</td><td>${badge(decision.actionAfterRisk)}</td><td>${money(decision.amountAfterRisk)}</td><td>${number(decision.confidence * 100, 0)}%</td><td class="reason">${escape(decision.reason)}</td><td class="reason">${escape(decision.rejectionReason)}</td></tr>`).join('') : empty(8, 'Nenhuma decisão no dia.');
    renderEvents();
  }
  function renderEvents() {
    if (!data) return;
    const includeInfo = $('show-info').checked;
    const events = data.events.filter((event) => includeInfo || event.level !== 'INFO');
    $('events-table').innerHTML = events.length ? events.map((event) => `<tr><td>${time(event.at)}</td><td>${badge(event.level)}</td><td>${escape(event.event)}</td><td>${escape(event.message)}</td></tr>`).join('') : empty(4, includeInfo ? 'Nenhum evento no dia.' : 'Nenhum WARN ou ERROR no dia.');
  }
  function renderSession(payload) {
    const schedule = [['START', payload.schedule.startTime], ['STOP BUY', payload.schedule.stopNewPositionsTime], ['FORCE CLOSE', payload.schedule.forceCloseTime], ['END', payload.schedule.endTime]];
    const phases = { START: 'TRADING', 'STOP BUY': 'NO_NEW_POSITIONS', 'FORCE CLOSE': 'FORCE_CLOSE', END: 'FINISHED' };
    $('session-timeline').innerHTML = schedule.map(([name, defaultAt]) => `<li class="${payload.session?.phase === phases[name] ? 'active' : ''}"><strong>${defaultAt}</strong><span class="ms-2">${name}</span></li>`).join('');
    const summary = payload.summary;
    $('final-summary').innerHTML = summary?.final ? `<strong>RESULTADO FINAL</strong><dl class="row mb-0 mt-2"><dt class="col-7">Resultado líquido</dt><dd class="col-5 text-end">${signedMoney(payload.performance.netPnlUsdt)}</dd><dt class="col-7">Taxas conhecidas</dt><dd class="col-5 text-end">${money(summary.feesUsdtKnown)}</dd><dt class="col-7">Force close</dt><dd class="col-5 text-end">${summary.forceCloseOccurred ? 'Sim' : 'Não'}</dd><dt class="col-7">Resultado operacional</dt><dd class="col-5 text-end">${summary.errorCount ? 'ERRO' : 'OK'}</dd></dl>` : '<span class="text-secondary">Sessão em andamento ou ainda sem resultado consolidado.</span>';
  }
  function render(payload) {
    data = payload;
    $('date-filter').value = payload.date;
    $('session-date').textContent = `${payload.date} · ${payload.timezone}${payload.historical ? ' · Histórico' : ''} · Configuração: ${payload.schedule.startTime} → ${payload.schedule.endTime} · Intervalo: ${Number(payload.schedule.intervalSeconds) / 60} min`;
    $('overall-status').textContent = payload.health.status;
    $('overall-status').className = `badge px-3 py-2 ${badge(payload.health.status).match(/text-bg-[^"]+/)?.[0] || 'text-bg-secondary'}`;
    $('connection').textContent = `Última atualização: ${time(payload.health.timestamp)}`;
    $('connection').className = 'small text-secondary';
    renderHealth(payload); renderMetrics(payload); renderCharts(payload); renderTables(payload); renderSession(payload);
  }
  async function load() {
    const selected = $('date-filter').value || today();
    try {
      const response = await fetch(`/dashboard/data?date=${encodeURIComponent(selected)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('API indisponível');
      render(await response.json());
    } catch {
      $('connection').textContent = 'CONEXÃO PERDIDA — dados não estão atualizados';
      $('connection').className = 'small text-danger fw-bold';
      $('overall-status').textContent = 'CONEXÃO PERDIDA';
      $('overall-status').className = 'badge text-bg-danger px-3 py-2';
    }
  }
  $('date-filter').value = today();
  $('date-filter').addEventListener('change', load);
  $('today-button').addEventListener('click', () => { $('date-filter').value = today(); load(); });
  $('show-info').addEventListener('change', renderEvents);
  load();
  setInterval(() => { if ($('date-filter').value === today()) load(); }, 30_000);
})();
