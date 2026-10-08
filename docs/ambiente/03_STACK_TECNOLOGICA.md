# Stack tecnológica

## Objetivo

Registrar a stack e sua função. A separação de componentes está em [arquitetura](02_ARQUITETURA.md).

| Tecnologia | Uso |
| --- | --- |
| Node.js >= 24, TypeScript, pnpm | runtime, tipagem e monorepo |
| Fastify | API HTTP e arquivos do dashboard |
| PostgreSQL 17, `pg`, Drizzle | ledger, schema e migrations |
| Docker Compose | banco, API e worker locais |
| Zod | ambiente e validação da resposta IA |
| Pino | logs JSON com segredos redigidos |
| Vitest | testes unitários e de integração |
| Bootstrap e Chart.js | interface e gráficos via CDN |
| Binance/OpenRouter | mercado/Testnet e inferência |

Não há Redis, Kafka, Kubernetes, framework frontend pesado ou Binance de produção. Veja os motivos em [decisões](22_DECISOES_ARQUITETURAIS.md).
