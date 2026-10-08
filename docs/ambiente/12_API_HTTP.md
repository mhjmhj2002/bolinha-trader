# API HTTP

## Objetivo

Documentar a API Fastify atual. Não há autenticação nem endpoints de BUY/SELL arbitrários; exponha apenas localmente conforme o Compose.

| Método e path | Objetivo / resposta |
| --- | --- |
| `GET /health` | saúde de banco, worker, Binance pública, OpenRouter, loop, reconciliação e ciclo stale |
| `GET /status` | banca, fase, sessão, posição, P/L, decisão, ciclos e bloqueios |
| `GET /positions`, `/trades`, `/decisions`, `/system/events` | histórico persistido |
| `GET /performance`, `/performance/daily` | desempenho atual e daily result |
| `GET /reports/today`, `/reports/daily/:date` | relatório operacional; data inválida retorna 400 |
| `GET /dashboard/data?date=YYYY-MM-DD` | agregado para dashboard; data inválida retorna 400 |
| `GET /configuration`, `/configuration/1` | configuração, editabilidade e motivo de bloqueio |
| `POST /configuration`; `PUT /configuration` ou `/configuration/1` | cria/atualiza singleton; 400 inválido, 409 bloqueado |
| `DELETE /configuration/1` | sempre 409: a configuração ativa não pode sumir |
| `POST /trading/run-once` | ciclo sujeito a risco e fase; 503 se falhar |
| `GET /dashboard`, `/dashboard/configuration` | páginas HTML; CSS/JS também são servidos sob `/dashboard/*` |

`/health` informa `UP`, `DOWN` ou `STALE`; `/status` contém detalhes operacionais. Para exemplos de uso, veja [runbook](20_RUNBOOK_OPERACIONAL.md).
