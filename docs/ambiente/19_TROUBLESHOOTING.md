# Troubleshooting

## Objetivo

Diagnosticar falhas recorrentes a partir de sintomas e evidências.

| Sintoma | Diagnóstico e correção |
| --- | --- |
| PostgreSQL `ECONNREFUSED` | `docker compose ps` e `docker compose logs postgres`; suba serviços e aplique `pnpm db:migrate` no ambiente correto |
| Worker UP sem ciclo | confirme `TRADING_LOOP_ENABLED=true`, fase `TRADING`, horário/configuração e `/health` sem `cycleStale` |
| Loop OFF ou `FINISHED` | é comportamento seguro; habilite/reinicie somente para sessão futura, não force BUY |
| OpenRouter 429/timeout | veja eventos/logs; fallback termina em HOLD. Revise chave, quota e lista de modelos |
| Binance NOTIONAL/minQty/step | confira filtros atuais e valor; o motor arredonda para baixo e pode produzir HOLD |
| Ordem PENDING/reconciliation ERROR | não reenvie manualmente; consulte eventos, reinicie worker para Query Order e mantenha loop bloqueado |
| Dashboard sem dados | teste `/dashboard/data`, `/health` e banco; histórico sem sessão pode estar vazio |
| `daily_result` PENDING/null | sessão precisa `FINISHED` e sem posição; execute `pnpm trading:finalize:today` só então |
| Configuração bloqueada | leia `GET /configuration`; aguarde fora da sessão, sem posição/pendência e com reconciliação OK |
| Migrations falham | confira `DATABASE_URL`, disponibilidade do banco e logs dos containers |

Colete sempre `/health`, `/status`, `/system/events` e `docker compose logs worker` antes de qualquer ação destrutiva.
