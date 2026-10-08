# Observabilidade

## Objetivo

Indicar onde observar saúde e como agir. Para procedimentos, consulte o [runbook](20_RUNBOOK_OPERACIONAL.md).

Pino produz logs JSON e redige chaves Binance/OpenRouter. `system_events` preserva eventos estruturados; `worker_heartbeats` registra vida do worker; `/health` calcula worker `UP`/`STALE`/`DOWN`, ciclo stale e estado de reconciliação. Dashboard e relatório agregam snapshots, decisões, IA, ordens, trades e eventos.

| Evento/sinal | Severidade usual | Ação |
| --- | --- | --- |
| `ai_fallback` / `ai_error` | WARN/ERROR | verificar OpenRouter; decisão final é HOLD seguro |
| `external_service_error` | ERROR | verificar Binance ou rede |
| `pending_order_reconciled` | INFO | revisar se havia ambiguidade |
| `reconciliation_failed` | ERROR | não negociar; investigar e reconciliar |
| `force_close_failed` | ERROR | acompanhar posição e novas tentativas |
| `cycle_skipped` | INFO/WARN | verificar fase, lock ou reconciliação |

```bash
docker compose logs -f worker
docker compose logs -f api
curl http://localhost:3000/health
curl http://localhost:3000/system/events
pnpm trading:report:today
```

Não trate heartbeat como decision cycle. Um ciclo stale só é relevante durante `TRADING` com loop habilitado.
