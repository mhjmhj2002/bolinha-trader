# TASK-08: Remoção Completa de Binance / Bitcoin / USDT

## Status: done
**Data:** 2026-10-13  
**Prioridade:** Crítica

## Objetivo
Eliminar do repositório todo código, configuração, testes e documentação ativa relacionados a Binance, Bitcoin (BTC) e USDT. O sistema opera exclusivamente na B3 (BRL).

## Escopo
- `@bolinha/exchange`: remover `BinanceTestnetClient`; `createBrokerGateway` passa a devolver somente o broker B3.
- `@bolinha/core`: remover variáveis `BINANCE_*` e `MARKET_TARGET`.
- `@bolinha/ai`: remover `buildPrompt` (cripto); manter somente o prompt B3.
- `@bolinha/risk-engine`: remover `applyRisk` (cripto); manter `applyB3Risk`.
- `@bolinha/worker` / `@bolinha/api`: remover ramos de cripto e campos Binance; dashboard sem referências a Binance.
- Testes que cobrem somente Binance são removidos; os demais migram para B3.
- `.env`, `.env.example`, README e docs ativas atualizados.

## Critérios de Aceite
- [ ] `grep -riE "binance|btc"` fora de `docs/tasks/historico` e logs de deploy não retorna código ativo.
- [ ] `pnpm typecheck`, `pnpm lint` e `pnpm test` passam.

## Fora de escopo (registrado)
- Renomear colunas `*_usdt` no banco (exige migração de dados).
- Feed real de candles da B3 e reset da conta para BRL.
