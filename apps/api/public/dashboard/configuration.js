/* global document, window */
(() => {
  const form = document.getElementById('configuration-form');
  const alert = document.getElementById('configuration-alert');
  const save = document.getElementById('save-button');
  const message = document.getElementById('form-message');
  const fields = [...form.elements].filter((element) => element.tagName === 'INPUT');
  let editable = false;
  const formatDate = (value, timezone) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  const setEditable = (value) => { editable = value; fields.forEach((field) => { field.disabled = !value; }); save.disabled = !value; };
  const showAlert = (state) => {
    alert.className = `alert ${state.editable ? 'alert-info' : 'alert-danger'}`;
    alert.textContent = state.editable
      ? 'Configuração editável. As alterações afetarão as próximas sessões de trading.'
      : (state.message || 'A configuração está bloqueada por uma operação em andamento.');
  };
  const load = async () => {
    const response = await fetch('/configuration');
    if (!response.ok) throw new Error('Não foi possível carregar a configuração.');
    const state = await response.json();
    for (const name of ['timezone', 'startTime', 'stopNewPositionsTime', 'forceCloseTime', 'endTime', 'intervalSeconds', 'initialBankUsdt', 'maxPositionPercent']) form.elements[name].value = state[name] ?? '';
    document.getElementById('updated-at').textContent = formatDate(state.updatedAt, state.timezone);
    document.getElementById('session-phase').textContent = state.sessionPhase ?? '—';
    document.getElementById('loop-status').textContent = state.loopEnabled ? 'ON' : 'OFF';
    setEditable(Boolean(state.editable)); showAlert(state);
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editable || !window.confirm('Esta alteração afetará as próximas sessões de trading.')) return;
    const payload = Object.fromEntries(new window.FormData(form).entries());
    for (const name of ['intervalSeconds', 'initialBankUsdt', 'maxPositionPercent']) payload[name] = Number(payload[name]);
    save.disabled = true; message.textContent = 'Salvando…';
    try {
      const response = await fetch('/configuration', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a configuração.');
      message.className = 'small text-success'; message.textContent = 'Configuração salva.'; await load();
    } catch (error) {
      message.className = 'small text-danger'; message.textContent = error instanceof Error ? error.message : 'Não foi possível salvar a configuração.'; await load();
    }
  });
  load().catch((error) => { alert.className = 'alert alert-danger'; alert.textContent = error.message; setEditable(false); });
})();
