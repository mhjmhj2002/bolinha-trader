# Deploy e infraestrutura

## Objetivo

Separar o que está implementado do que é apenas direção futura.

### Implementado hoje

`docker-compose.yml` define PostgreSQL 17, API e worker. API e worker são construídos pelo mesmo Dockerfile, leem `.env`, executam migrations no startup e dependem do healthcheck do banco. A API fica vinculada a `127.0.0.1:3000`; volume `postgres_data` preserva o banco entre recriações. Há healthchecks de API e worker.

### Planejado, não implementado

Uma VPS (a referência histórica cita Akamai/Linode em São Paulo), Node, PostgreSQL, API, worker, Caddy/reverse proxy e monitoramento externo é arquitetura alvo, não automação disponível. Não há manifests Kubernetes, CI/CD de deploy, Caddy configurado, secret manager, backups gerenciados ou alerta externo neste repositório.

Não exponha API sem acrescentar autenticação, TLS/reverse proxy, política de rede, backup, supervisão e monitoramento adequados.
