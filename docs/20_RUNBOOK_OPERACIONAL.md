# Runbook operacional

## Objetivo

Fornecer procedimentos copiáveis para o operador. A explicação dos estados fica em [lifecycle](07_TRADING_LIFECYCLE.md).

### Iniciar e verificar

```bash
docker compose up -d --build
curl http://localhost:3000/health
curl http://localhost:3000/status
open http://localhost:3000/dashboard
```

Antes da janela, confirme `.env` com `BINANCE_ENV=testnet`, chaves e `TRADING_LOOP_ENABLED=false`. Para iniciar o loop conscientemente, altere-o para `true` e recrie worker/API: `docker compose up -d --build --force-recreate worker api`. Confira `pnpm trading:day-test:check`.

### Parar, fechar e recuperar

Para parar novos ciclos, defina `TRADING_LOOP_ENABLED=false` e recrie o worker. Para fechar posição conceitual: `pnpm trading:force-close`; acompanhe `/status` e eventos. Para investigar crash/pendência, reinicie worker (`docker compose restart worker`), aguarde reconciliação e **não** reenvie ordem manualmente. Confirme ausência de posição em `curl http://localhost:3000/status` e `curl http://localhost:3000/positions`.

### Finalizar e investigar

```bash
pnpm trading:status
pnpm trading:report:today
pnpm trading:finalize:today
docker compose logs -f worker
curl http://localhost:3000/system/events
```

`finalize:today` só consolida sessão acabada sem posição. Atualize configuração em `/dashboard/configuration` fora da janela; não edite banco manualmente. Para reiniciar toda a stack use `docker compose restart`; só use `docker compose down -v` se quiser apagar irreversivelmente o ledger local de teste.
