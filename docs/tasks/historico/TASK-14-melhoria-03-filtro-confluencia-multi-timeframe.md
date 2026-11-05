# TASK-14: Filtro de Confluência Multi-Timeframe para Entrada (BUY) — Melhoria #3 da Auditoria Operacional

## Status: done
**Data de Criação:** 2026-10-22  
**Data de Conclusão:** 2026-10-27  
**Prioridade:** Alta  
**Origem:** Auditoria Operacional (MELHORIA-03) — rastreada em [`docs/tasks/bug/RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md)  
**Pacotes Afetados:** `@bolinha/market-data`, `@bolinha/risk-engine`, `@bolinha/core`, `apps/worker`

---

## 1. Contexto e Problema Observado

O gate determinístico de confluência multi-timeframe exigia, **para cada timeframe de entrada
configurado**, que `EMA9 > EMA21` **E** `RSI14 < 70` fossem verdadeiros **simultaneamente**, em
**todos os 3 timeframes** (`1m`, `5m`, `15m`), com `ENTRY_MIN_CONFLUENT_TIMEFRAMES=3`.

- Implementação do gate: `evaluateEntryConfluence` / `evaluateCandlesEntryConfluence` em
  `packages/market-data/src/index.ts` (`emaAligned = ema9 > ema21`, `rsiAcceptable = rsi14 < rsiOverboughtThreshold`).
- `requiredCount = min(timeframes.length, max(1, trunc(ENTRY_MIN_CONFLUENT_TIMEFRAMES)))`
- Descrição do prompt derivada do mesmo shape (`describeEntryConfluenceRule` em `packages/ai/src/index.ts`, TASK-17),
  mantendo prompt e engine alinhados.

O problema constatado foi a **taxa de aprovação excessivamente restritiva**: com 3/3 exigido, a
operação ficou permanentemente sem compras durante as sessões de teste (0 compras executadas).

---

## 2. Evidências Medidas (dados verificados)

### 2.1 Taxa de aprovação do gate

Medição sobre **92 snapshots de mercado persistidos** (`market_snapshots`):

| Métrica | Valor |
|---|---|
| Snapshots avaliados | 92 |
| Snapshots com **3/3** timeframes confluentes | **1** |
| Taxa de aprovação | **1,1%** |

Distribuição de timeframes confluentes por snapshot:

| Timeframes confluentes | Snapshots |
|---|---|
| 0 | 11 |
| 1 | 53 |
| 2 | 27 |
| 3 | 1 |

### 2.2 Diagnóstico do Gargalo

- A perna restritiva foi o **alinhamento de EMA no 5m** (~**39%** das leituras aprovam essa perna).
- O **RSI não é o gargalo**: `RSI14 < 70` é verdadeiro em **87–95%** das amostras por timeframe.
- Com `ENTRY_MIN_CONFLUENT_TIMEFRAMES=2`, a taxa de aprovação sobe para **~30% (28/92)**, viabilizando compras intradiárias com confirmação estatística adequada.

---

## 3. Implementação Realizada

1. **Ajuste de Configuração Centralizada:**
   - Alterado `ENTRY_MIN_CONFLUENT_TIMEFRAMES` de `3` para `2` no schema Zod (`packages/core/src/index.ts`), em `.env` e em `.env.example`.
2. **Alinhamento do Prompt da IA:**
   - `describeEntryConfluenceRule` atualizado para declarar confluência de pelo menos 2 timeframes configurados.
3. **Observabilidade de Stop:**
   - Em `stop-all.sh` e `common.sh`, captura de logs de runtime ajustada para cobrir 24 horas (`--since "24 hours ago"`), garantindo a retenção da sessão completa em disco.
4. **Testes Unitários:**
   - Adicionado caso de teste cobrindo `minConfluentTimeframes=2` em `tests/entry-confluence.test.ts`.

---

## 4. Critérios de Aceite

- [x] Decisão de estratégia/risco sobre `ENTRY_MIN_CONFLUENT_TIMEFRAMES` explicitamente aprovada e registrada pelo operador.
- [x] Medição de aprovação do gate (92 snapshots; 3/3 = 1,1%; distribuição 11/53/27/1) documentada e rastreável.
- [x] Gargalo identificado (EMA 5m, ~39%) e não-gargalo confirmado (RSI14 < 70 em 87–95%).
- [x] Evidência de que o gate bloqueou compras por excesso de rigidez registrada na análise de logs e banco.
- [x] Alteração refletida em `.env`, `.env.example` e schema Zod, com testes em `@bolinha/market-data`, `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% aprovados.
