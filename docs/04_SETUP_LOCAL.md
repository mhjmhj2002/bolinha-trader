# Setup local

## Objetivo

Preparar uma máquina para observar ou operar em Testnet. Antes de habilitar o loop, leia [configuração](06_CONFIGURACAO_OPERACIONAL.md).

### Requisitos

- Node.js 24+ e pnpm 12.3.4;
- Docker Engine com Docker Compose;
- chaves **Binance Spot Testnet** e uma chave OpenRouter.

```bash
git clone <URL_DO_REPOSITORIO>
cd bolinha-trader
cp .env.example .env
pnpm install
docker compose up -d --build
curl http://localhost:3000/health
curl http://localhost:3000/status
```

Em `.env`, mantenha `BINANCE_ENV=testnet`, informe `BINANCE_API_KEY`, `BINANCE_API_SECRET` e `OPENROUTER_API_KEY`. Nunca versione `.env`. `DATABASE_URL` serve a execução local; Compose injeta a URL interna. `SYMBOL` é fixado em `BTCUSDT`. O loop começa desligado: mantenha `TRADING_LOOP_ENABLED=false` até revisão humana.

API e worker aplicam migrations na inicialização. Confirme `database`, `worker` e `binance` em `/health`; sem chave OpenRouter, esse campo fica `DOWN`. Dashboard: <http://localhost:3000/dashboard>. Sem containers, use PostgreSQL acessível, `pnpm db:migrate` e `pnpm dev`.
