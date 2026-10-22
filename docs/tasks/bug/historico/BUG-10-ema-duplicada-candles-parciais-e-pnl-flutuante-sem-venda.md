# BUG-10: EMA com seed duplicada, candles agregados parciais (sem compras) e lucro "sem venda" confuso e caixa não refletindo a venda

## Status: done
**Data de Criação:** 2026-10-21  
**Prioridade:** Alta  
**Origem:** Execução contínua B3 (paper) sem nenhuma compra por horas + dúvida do operador sobre lucro com 1 BUY e 0 SELL  
**Pacotes Afetados:** `@bolinha/market-data`, `@bolinha/exchange` (b3), `@bolinha/database`, `apps/worker` (lifecycle/service), `apps/api` (dashboard), `packages/core` (default Zod de `OPENROUTER_MODELS`), `.env` / `.env.example`
**Data de Conclusão:** 2026-10-21

---

## 1. Parte A — Nenhuma compra em horas de execução

### Sintomas
- Dezenas de decisões consecutivas `HOLD` ("EMA9 abaixo da EMA21 em todos os timeframes").
- Snapshots com `ema9`/`ema21` ≈ 60 para preço ≈ 29,93 (o dobro do preço).
- Volume de 5m idêntico ao de 1m e `volumeState=LOW` recorrente.

### Causas raiz (corrigidas, testadas e validadas nesta rodada de fechamento)
1. **`ema()` somava o seed SMA duas vezes** ([`packages/market-data/src/index.ts`](file:///home/mhj/git/bolinha-trader/packages/market-data/src/index.ts)): `SMA + EMA(seed=SMA)` resultava em ≈ 2× o preço, distorcendo a relação EMA9/EMA21 e o gate determinístico de confluência. Correção: `EMA(seed=SMA)`. Teste: `tests/ema.test.ts`.
2. **`aggregateCandles` agrupava a partir do início da série** ([`packages/exchange/src/b3/market-data.ts`](file:///home/mhj/git/bolinha-trader/packages/exchange/src/b3/market-data.ts)): o último candle 5m/15m era parcial (volume artificialmente baixo → `LOW`; retorno igual ao de 1m) e os buckets "andavam" quando a janela deslizava.

   **Correção registrada (a descrição original de `start = n % factor` foi SUPERADA e não é o que está no código).** A primeira tentativa (`start = n % factor`, janelas rolantes ancoradas no último candle de 1m) foi refutada na implementação: como `n` cresce a cada novo candle de 1m, o resto `n % factor` muda a cada ciclo e re-faseia TODOS os buckets, inclusive os já fechados — o deslocamento apenas ficava mais difícil de enxergar. O que está efetivamente implementado:
   - **Âncora por relógio / chave de grade:** cada candle de 1m pertence ao bucket `Math.floor(openTime / intervalMs) * intervalMs`. A chave deriva do `openTime` do próprio candle, portanto é imutável: o mesmo candle de 1m cai no mesmo bucket hoje e depois de a janela crescer. Histórico fechado nunca se move.
   - **Fail-closed:** só é emitido um bucket que contenha **exatamente `factor`** candles de 1m. Buckets incompletos (início da série, buracos na fita) são **descartados** em vez de gerar candle agregado com volume artificialmente baixo (o falso `volumeState=LOW`) ou preço inventado. Nenhum OHLCV é sintetizado na agregação.
   - **Candle rolante no topo:** quando o candle de 1m mais novo ainda não fecha o bucket do relógio, o último bucket completo é **substituído** por um candle rolante formado pelos últimos `factor` candles de 1m. Isso preserva o contrato do BUG-07 (o `close` mais novo de 5m/15m permanece idêntico ao `close` do candle de 1m mais novo) sem nunca emitir candle parcial e sem sobreposição de volume.
   - **Alinhamento:** todo bucket fechado começa em múltiplo de `intervalMs` e tem `closeTime === openTime + intervalMs - 1`.
3. **Modelo `google/gemini-2.0-flash-001` retornava HTTP 404** no OpenRouter, gerando `ai_fallback` recorrente. Removido de `OPENROUTER_MODELS` em `.env` e `.env.example` **e também do default do schema Zod em `packages/core/src/index.ts`** ([`packages/core/src/index.ts`](file:///home/mhj/git/bolinha-trader/packages/core/src/index.ts)) — o default do schema era o risco residual real: mesmo com o `.env` limpo, qualquer execução sem a variável (container, CI, `pnpm trading:once`) voltaria a carregar o modelo 404.

   **Guardas de regressão da seed duplicada da EMA (end-to-end):** `tests/ema.test.ts` compara a `ema()` de produção com uma implementação de referência (seed SMA + recursão `k = 2/(period+1)`), provando que uma série plana de 30,0 produz EMA 30,0 — com a seed duplicada voltaria ~60,0. E `tests/market-data.test.ts` passou a assertar que `ema9`/`ema21` de `calculateIndicators` ficam **dentro da banda de preço** dos candles de entrada, o que pega o bug na fronteira pública usada pelo worker, não só na função isolada.

### Observação (não é bug)
Com os dados corretos, o simulador pode ficar em regime de baixa por dezenas de candles (RSI 5m ≈ 21–29, EMA9<EMA21 em 1m/5m/15m) e o gate `ENTRY_MIN_CONFLUENT_TIMEFRAMES=3` corretamente barra a compra.

### Pendências
- [x] Teste de regressão para `aggregateCandles` (último candle completo, alinhamento ao fim, sem deslocamento ao deslizar a janela). — **FEITO**: 4 testes novos em `tests/b3-connector.test.ts` (describe "BUG-10 chunk B"): (i) 13 candles de 1m ⇒ `floor(13/5) = 2` buckets, nenhum bucket curto, volumes exatos 15 e 55; (ii) OHLCV exato de uma janela explícita de 5 candles; (iii) estabilidade dos buckets ao longo de 4 ciclos de janela deslizante com relógio fixado (`Date.now` pinado), com testemunha de um bucket do meio sobrevivendo byte a byte; (iv) alinhamento à grade para 5m e 15m (`openTime % intervalMs === 0`, `closeTime === openTime + intervalMs - 1`).
- [ ] Validar em execução que ocorrem BUYs quando há 3/3 timeframes alinhados. — **EM ABERTO (operacional)**: exige sessão ao vivo; não é verificável por suíte automatizada.
- [ ] Avaliar (decisão do operador) `ENTRY_MIN_CONFLUENT_TIMEFRAMES=2` e parâmetros `SYNTHETIC_*` para testes mais ativos. — **EM ABERTO (decisão do operador)**: requer decisão humana sobre tolerância de risco/atividade; os parâmetros já estão centralizados e tipados.

---

## 2. Parte B — "Uma compra, zero vendas e há lucro"

### Observação
Painel mostrou: 1 trade (BUY 3 × R$ 29,91, taxa R$ 0,03), posição aberta com custo R$ 89,76 (médio R$ 29,92), **Resultado do dia +R$ 0,06**, `Real: +0,00 · Flut: +0,06`.

### Diagnóstico
Não há erro de cálculo. O lucro é **não realizado (flutuante)**: valor de mercado 3 × R$ 29,94 ≈ R$ 89,82 menos custo R$ 89,76 = +R$ 0,06. Nada foi vendido, portanto o realizado é R$ 0,00 e a coluna P/L do trade BUY é `—`.

O problema é de **comunicação do painel**: o card "Resultado do dia" exibe o total como se fosse lucro consolidado, e o card de caixa mostra "até 0 ação(ões)" sem contexto.

### Requisitos
1. Card "Resultado do dia": renomear/rotular como **"Resultado (inclui não realizado)"** e destacar na linha de detalhe **"Realizado: R$ X · Em aberto: R$ Y"**; exibir selo "posição aberta — lucro não realizado" quando `position != null` e realizado = 0.
2. Card "Posição": exibir P/L em aberto (R$ e %) ao lado do custo e preço atual.
3. Tabela de trades: para BUY, exibir `—` com tooltip "P/L só é apurado na venda".
4. "Caixa livre": quando `canBuy = 0`, exibir "Caixa insuficiente para nova compra (mín. 1 ação = R$ X)".
5. Garantir invariantes testadas em `tests/dashboard-data.test.ts`: `netPnl = realizado + em aberto`; sem SELL ⇒ `realizado = 0`.

---

## 3. Parte C — Caixa livre e posição não refletem a venda (force close) após o fim da sessão

### Sintomas (2026-10-21, sessão FINISHED às 18:15)
- Painel: **Caixa livre R$ 10,24**, **Posição PETR4 3,0**, `Real +0,97 · Flut +0,69`, Patrimônio R$ 100,69, 2 trades.
- Banco de dados (fonte da verdade):
  - `trading_account.cash_usdt = 100,9659` e `realized_pnl_usdt = 0,9659`.
  - `positions`: id 1 `CLOSED` às 17:55:00; `trades`: SELL 3 × R$ 90,75 às 17:55:00 (`net_pnl_usdt = 0,9659`).
  - Eventos: `force_close_completed` 17:55:00, `position_closed`, `trading_session_finished` 18:00.
- Ou seja: a venda ocorreu e o caixa real voltou; **só o painel está desatualizado e inconsistente** (realizado já com a venda, caixa/posição/flutuante sem a venda).

### Causa raiz
[`dashboardData`](file:///home/mhj/git/bolinha-trader/packages/database/src/index.ts) deriva `account.cashUsdt`, `position`, `positionMarketValueUsdt`, `unrealizedPnlUsdt` e `equityUsdt` do **último registro de `account_snapshots`** (`latest`). O último snapshot foi gravado às **17:48:00**, antes do force close (17:55). O force close/venda não grava novo snapshot, e depois do `STOP BUY` (17:50) não há mais ciclos de decisão que o façam. Resultado: `latest` fica com `cash=10,24` e `position_quantity=3` mesmo com a posição fechada. Já o `realized` vem do `daily_results`/trades, que contêm a venda — daí a mistura incoerente (Real +0,97 com Flut +0,69 de uma posição que já não existe; patrimônio R$ 100,69 vs. real R$ 100,97).

Agravante: o resultado diário ficou como `daily_result_pending` ("Daily result consolidation pending") na finalização.

### Requisitos
1. **Gravar um `account_snapshot` imediatamente após toda execução de ordem** (BUY, SELL, force close e reconciliação), com caixa, posição e preço atuais — nunca depender apenas do ciclo de decisão.
2. **Fallback no dashboard:** caixa e posição aberta devem vir do estado transacional atual (`trading_account` e `positions` com `status='OPEN'`) quando o dia consultado for o dia vigente; o último snapshot só alimenta os gráficos históricos. Para dias históricos/finalizados, usar o `daily_results` (caixa/patrimônio finais).
3. Após `FINISHED` com posição fechada: `position = null`, `unrealizedPnlUsdt = 0`, `equityUsdt = cash` e `netPnl = realizado`.
4. Garantir invariantes: `equity = caixa + valor de mercado da posição aberta`; sem posição aberta ⇒ `flutuante = 0` e caixa = `trading_account.cash_usdt`.
5. Investigar por que a consolidação do resultado diário ficou `pending` e garantir reprocessamento.

### Critérios de aceite (Parte C)
- [x] Teste: BUY → ciclos → SELL/force close sem novo ciclo ⇒ `dashboardData` retorna caixa pós-venda, `position = null`, flutuante 0. — **FEITO**: `tests/dashboard-data.test.ts` ("reflects the post-sale ledger on the current day after a force close with no new cycle"): caixa 100,9659, `position === null`, `unrealizedPnlUsdt === 0`, `equity === cash`, `netPnl === realizado`.
- [x] Teste: snapshot gravado após cada ordem executada (incluindo force close). — **FEITO**: `tests/trading-service.test.ts` cobre snapshot após SELL executado, snapshot após force close sem ciclo seguinte, e um teste fail-safe provando que uma falha de escrita do snapshot NÃO perde a execução (o trade é preservado e o evento `account_snapshot_failed` é emitido).
- [x] Em sessão FINISHED, "Caixa livre" = caixa real do banco (ex.: R$ 100,97 no caso acima). — **FEITO**: `tests/dashboard-data.test.ts` asserta caixa ≈ 100,97 e explicitamente `not.toBeCloseTo(10.24)`.
- [x] Consolidação diária não permanece `pending` após o fim da sessão. — **FEITO**: `tests/lifecycle.test.ts` prova que não sobra marcador `PENDING` após sucesso; e um `daily_result` nulo agora falha fechado (em vez de reportar sucesso silencioso), de modo que o retry de 30s da sessão `FINISHED` converge em vez de ficar órfão.

---

## 4. Critérios de Aceite
- [x] Teste de regressão de `aggregateCandles` aprovado. — **FEITO**: 4 testes em `tests/b3-connector.test.ts` ("BUG-10 chunk B"), ver detalhamento na Parte A.
- [x] Painel com 1 BUY e 0 SELL deixa explícito que o lucro é flutuante. — **FEITO**: card renomeado para "Resultado (inclui não realizado)", linha "Realizado: X · Em aberto: Y", selo "posição aberta — lucro não realizado", P/L do BUY exibido como "—" com tooltip "P/L só é apurado na venda", e "Caixa insuficiente para nova compra (mín. 1 ação = R$ X)" quando `canBuy = 0`. Coberto por `tests/dashboard-data.test.ts` (rótulos, selo, breakdown e tooltip).
- [x] Invariantes de PnL cobertas por teste. — **FEITO**: `netPnl = realizado + em aberto` e, sem SELL, `realizado = 0` — ambos assertados em `tests/dashboard-data.test.ts`.
- [x] Caixa livre e posição corretos após venda/force close (Parte C). — **FEITO**: ver critérios da Parte C (`tests/dashboard-data.test.ts`, `tests/trading-service.test.ts`).
- [x] `pnpm test`, `pnpm typecheck` e `pnpm lint` aprovados. — **FEITO**: validados nesta rodada de fechamento: `pnpm test` exit 0 (19 arquivos / 151 testes), `pnpm typecheck` exit 0, `pnpm lint` exit 0. Também revalidados após build limpo (`rm -rf dist` + remoção de `*.tsbuildinfo` + `pnpm build` exit 0), sem regressão de project references.

### Itens operacionais que permanecem abertos (não verificáveis aqui)
- Validar em execução que ocorrem BUYs quando há 3/3 timeframes alinhados — exige sessão ao vivo.
- Avaliar `ENTRY_MIN_CONFLUENT_TIMEFRAMES=2` e parâmetros `SYNTHETIC_*` para testes mais ativos — decisão do operador.
