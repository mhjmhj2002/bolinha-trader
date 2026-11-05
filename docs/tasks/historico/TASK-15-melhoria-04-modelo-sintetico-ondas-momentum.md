# TASK-15: Modelo Sintético de Ondas de Momentum Intradiárias para Candles B3 (MELHORIA-04)

## Status: done
**Data de Criação:** 2026-10-22  
**Data de Conclusão:** 2026-10-27  
**Prioridade:** Média / Arquitetural  
**Origem:** Auditoria Operacional (MELHORIA-04) — rastreada em [`docs/tasks/bug/RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md)  
**Pacotes Afetados:** `@bolinha/exchange`, `@bolinha/core`

---

## 1. Contexto e Problema Observado
- O gerador de candles sintéticos inicial do `B3MarketDataService` gerava uma série de random walk puramente baseada em reversão à média com pequenas variações aleatórias sem persistência direcional.
- Esse comportamento estocástico simples causava duas distorções nos testes do simulador:
  1. Ações ficavam sem tendências intradiárias sustentadas (ondas de momentum de 15 a 30 candles), impedindo a EMA9 de cruzar e se sustentar acima da EMA21.
  2. Dificultava a formação de confluência multi-timeframe (1m, 5m, 15m), gerando longos períodos de estagnação de decisões de compra.

---

## 2. Implementação Realizada
1. **Modelo de Ondas de Momentum por Segmento (`SyntheticRegimeState`):**
   - Implementado em `packages/exchange/src/b3/market-data.ts`:
     - Estado de regime intradiário (`SyntheticRegimeState`) com `momentum`, `targetMomentum`, `direction` (-1 | 0 | 1) e `candlesLeftInSegment`.
     - Drift persistente por segmento de candles que simula micro-tendências e pullbacks realistas da B3.
     - Suporte a sementes determinísticas (`SYNTHETIC_SEED`) via gerador PRNG `mulberry32` combinando o ticker com hash estável (`seedForSymbol`).
2. **Parametrização Centralizada em `@bolinha/core`:**
   - Adicionadas variáveis validadas no schema Zod com defaults calibrados:
     - `SYNTHETIC_VOLATILITY`: 0.001
     - `SYNTHETIC_MOMENTUM_DRIFT`: 0.00075
     - `SYNTHETIC_TREND_SEGMENT_CANDLES`: 26
     - `SYNTHETIC_REGIME_FLIP_PROBABILITY`: 0.6
     - `SYNTHETIC_CONSOLIDATION_PROBABILITY`: 0.15
     - `SYNTHETIC_PULLBACK_PROBABILITY`: 0.3
     - `SYNTHETIC_MAX_TREND_RUN`: 12
     - `SYNTHETIC_MEAN_REVERSION`: 0.014
     - `SYNTHETIC_PRICE_BOUND_PCT`: 0.08
     - `SYNTHETIC_SEED`: 0
3. **Reflexão no `.env.example` e `.env`:**
   - As variáveis estão registradas e documentadas em todos os ambientes.

---

## 3. Validação e Testes
- Suíte completa de testes automatizados (`tests/market-data.test.ts`, `tests/b3-market-data.test.ts`, etc.) 100% verde (24 arquivos de teste, 235 testes passando).
- TypeScript tipado e verificado sem erros (`pnpm typecheck`).
- Linter sem advertências (`pnpm lint`).
