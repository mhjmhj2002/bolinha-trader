# Teste local de um dia — Operação Bolinha de Gude

O teste opera exclusivamente a Spot Testnet, com a banca conceitual registrada no PostgreSQL. Os horários são sempre `America/Sao_Paulo`, mesmo que o host ou container use outro fuso: 09:00–17:49 trading; 17:50 bloqueia BUY; 17:55 força o fechamento; 18:00 finaliza o relatório diário.

## Preparação (antes de 09:00)

1. Deixe o notebook na tomada e desative suspensão/hibernação.
2. Confirme que Docker está em execução: `docker compose ps`.
3. Confira `.env`: `BINANCE_ENV=testnet`, credenciais Testnet/OpenRouter válidas, `TRADING_LOOP_ENABLED=false` e `TRADING_INTERVAL_SECONDS=600`.
4. Suba ou atualize os serviços sem habilitar o loop: `docker compose up -d --build`.
5. Valide: `curl http://localhost:3000/health` e `curl http://localhost:3000/status`.

## Iniciar amanhã

Edite somente a linha abaixo no seu `.env`:

```dotenv
TRADING_LOOP_ENABLED=true
```

Em seguida aplique a configuração e confirme o worker:

```bash
docker compose up -d --build --force-recreate worker api
curl http://localhost:3000/health
curl http://localhost:3000/status
pnpm trading:day-test:check
```

`cycleStale` deve ser `false` durante `TRADING` depois do primeiro ciclo. O worker continua vivo fora da janela para health e heartbeat; não é necessário intervir. Em `FORCE_CLOSE`, ele tenta fechar somente a posição conceitual persistida e repete a verificação a cada 30 segundos até 18:00.

## Conferência no fim do dia

```bash
pnpm trading:status
pnpm trading:day-test:check
curl http://localhost:3000/performance
curl http://localhost:3000/performance/daily
curl http://localhost:3000/trades
curl http://localhost:3000/decisions
curl http://localhost:3000/system/events
docker compose ps
```

Para parar a operação contínua em um dia posterior, volte `TRADING_LOOP_ENABLED=false` no `.env` e execute `docker compose up -d --force-recreate worker`.
