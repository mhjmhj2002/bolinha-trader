# Segurança

## Objetivo

Registrar controles e limitações atuais.

- código só aceita `BINANCE_ENV=testnet`; produção não é suportada;
- chaves ficam em `.env`, que não deve ser versionado; logs Pino redigem campos sensíveis;
- API Compose é publicada em `127.0.0.1:3000`, sem autenticação; não a exponha diretamente;
- `TRADING_LOOP_ENABLED=false` é kill switch padrão;
- Risk Engine impõe posição única, sem short/leverage, filtros e SELL integral;
- não existem endpoints HTTP de BUY/SELL arbitrários;
- ordens usam client ID, estado PENDING, idempotência e reconciliação;
- edição de configuração é bloqueada em estados operacionais e a sessão preserva snapshot;
- force close tenta encerrar somente posição conceitual.

Limitações: não há autenticação/autorização de API, secret manager, rate limiting, backup/DR automatizado, monitoramento externo nem deploy de produção. Testnet reduz impacto financeiro, mas ainda exige proteção de credenciais e supervisão humana.
