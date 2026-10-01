# Observabilidade

Logs são JSON via Pino, com chaves de API redigidas. `system_events` guarda eventos UTC com severity, tipo, mensagem e metadata segura: ciclo, decisão, fallback/erro de IA, submissão/execução, posição, zeragem forçada e falhas externas/inesperadas. `worker_heartbeats` continua a fonte específica para heartbeat e não gera eventos repetitivos. `ai_decisions`, `ai_usage`, snapshots, orders, trades e posições preservam o rastro de auditoria. Use `docker compose logs -f worker` e `/system/events` durante investigação.
