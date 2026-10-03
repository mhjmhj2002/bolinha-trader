# Operação Bolinha de Gude

Agente experimental de trading **exclusivamente Binance Spot Testnet**. Mantém uma banca conceitual no PostgreSQL (20 USDT por padrão), analisa candles públicos, consulta o OpenRouter, aplica regras determinísticas de risco e registra o livro-razão completo.

> `TRADING_LOOP_ENABLED=false` é o padrão. Nenhuma ordem é periódica até uma revisão humana habilitar o loop.

## Arquitetura

- `apps/api`: Fastify, status e disparo de um ciclo de desenvolvimento.
- `apps/worker`: heartbeat, análise, IA, risco e execução Testnet.
- `packages/*`: domínio, indicadores, OpenRouter, Binance, risco e persistência Drizzle/PostgreSQL.

Dados são públicos em `api.binance.com`; execução assinada só pode apontar para `testnet.binance.vision`. O programa aborta se `BINANCE_ENV` não for `testnet`.

## Requisitos e início rápido

Node 24, pnpm e Docker Compose.

```bash
cp .env.example .env
# preencha BINANCE_API_KEY, BINANCE_API_SECRET e OPENROUTER_API_KEY
pnpm install
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

Alternativamente, com PostgreSQL local: `pnpm db:migrate`, depois `pnpm dev`.

Variáveis necessárias: `BINANCE_API_KEY`, `BINANCE_API_SECRET` (credenciais da Spot Testnet) e `OPENROUTER_API_KEY`. As demais possuem defaults seguros em `.env.example`. Não use nem forneça chaves Binance de produção.

## Operação

```bash
pnpm trading:once                 # um ciclo no container worker e encerra
pnpm trading:smoke:testnet        # compra e fecha uma posição real na Spot Testnet
curl -X POST http://127.0.0.1:3000/trading/run-once
pnpm trading:force-close          # vende apenas a posição conceitual
pnpm trading:status               # estado persistido da sessão atual
pnpm trading:day-test:check       # resumo amigável para o teste diário
pnpm trading:report:today         # relatório operacional diário persistido
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

Endpoints: `GET /health`, `/status`, `/positions`, `/trades`, `/decisions`, `/performance`, `/system/events`, `/reports/today` e `/reports/daily/:date`; e `POST /trading/run-once`. Não existe endpoint para enviar BUY/SELL arbitrário.

O comando acima exige `docker compose up -d`; ele não expõe PostgreSQL no host. Para execução puramente local, com PostgreSQL local acessível, use `pnpm trading:once:local`.

### Smoke test real da Testnet

`pnpm trading:smoke:testnet` é uma prova técnica intencionalmente pequena e **somente Testnet**. Com credenciais Testnet válidas, ele exige não haver posição conceitual aberta, compra no máximo 6,50 USDT de BTCUSDT usando os adapters e a persistência normais, valida a posição no PostgreSQL e chama o mesmo `forceClosePosition()` para fechar exclusivamente essa posição conceitual. Ordens, trades, P/L e os eventos `smoke_test_started`/`smoke_test_completed` ficam preservados como evidência. O loop permanece desligado.

Para habilitar o loop depois de revisar o sistema, defina conscientemente `TRADING_LOOP_ENABLED=true`; então recrie os containers: `docker compose up -d --force-recreate worker`. Horários, fuso, intervalo, banca inicial e limite de posição são lidos da configuração operacional persistida no PostgreSQL (`GET /configuration`); o bootstrap cria 09:00, 17:50, 17:55, 18:00 e intervalo de 600 s. A tela [Configuração](/dashboard/configuration) só permite salvar fora da sessão, sem posição ou ordem pendente e após reconciliação `OK`; a única configuração ativa é versionada em `trading_configuration_versions`, sem apagar a evidência histórica. Para desligar: `docker compose down`. Para resetar o ambiente de teste (remove o ledger local): `docker compose down -v`.

Consultar o banco: `docker compose exec postgres psql -U bolinha -d bolinha`. O saldo da Testnet não é fonte da banca; somente o PostgreSQL é.

Veja [arquitetura](docs/ARCHITECTURE.md), [ciclo](docs/TRADING_LIFECYCLE.md), [risco](docs/RISK_ENGINE.md), [observabilidade](docs/OBSERVABILITY.md) e o [teste diário](docs/LOCAL_DAY_TEST.md).

### Troubleshooting

- `DOWN` no banco: `docker compose logs postgres`, depois `pnpm db:migrate`.
- OpenRouter indisponível/429: o worker tenta a lista configurada e termina em HOLD.
- Ordem ambígua: ela não é reenviada; o client consulta o ID do cliente antes de falhar.
- Testnet sem credenciais: saúde ainda expõe dados públicos; um ciclo não enviará ordem e registra o erro.
