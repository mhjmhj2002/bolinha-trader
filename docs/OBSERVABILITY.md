# Observabilidade

Logs são JSON via Pino, com chaves de API redigidas. `system_events` guarda eventos UTC com severity, tipo, mensagem e metadata segura: ciclo, decisão, fallback/erro de IA, submissão/execução, posição, zeragem forçada e falhas externas/inesperadas. `worker_heartbeats` continua a fonte específica para heartbeat e não gera eventos repetitivos. `ai_decisions`, `ai_usage`, snapshots, orders, trades e posições preservam o rastro de auditoria. Use `docker compose logs -f worker` e `/system/events` durante investigação.

## Sessão e consolidação

O relatório diário é delimitado por `trading_sessions.started_at` e
`finished_at`; eventos, decisões, usos de IA, trades e ordens de fora dessa
janela não fazem parte da sessão. `decision_cycles` representa somente o fluxo
mercado → IA → risco → decisão. Heartbeats, reconciliações, checks de fase e
tentativas de force-close são contados separadamente.

Uma sessão `FINISHED` ainda pode ter consolidação `PENDING` ou `ERROR`.
Somente `daily_result_status=OK` torna o relatório concluído. A falha não
reativa trading: o worker mantém heartbeat e tenta consolidar novamente de
forma idempotente. `pnpm trading:finalize:today` executa apenas essa
consolidação, recusando sessão não finalizada ou posição aberta, e nunca chama
IA nem envia ordem.

Fallback de IA é `WARN`. Um erro de OpenRouter que resultou em HOLD seguro é
registrado para auditoria, mas é crítico apenas quando há evidência de estado
inseguro (posição aberta após o fim, ordem pendente, inconsistência,
reconciliação persistente falha ou consolidação impossível). `forcedCloseOccurred`
só é verdadeiro com `force_close_completed` contendo uma ordem executada;
`force_close_noop` é emitido uma vez por sessão/fase e não é fechamento real.
