# TASK 25: Indicador e Filtro Institucional de VWAP Intradiária para Ações B3

## Objetivo
Implementar o cálculo da **VWAP** (*Volume Weighted Average Price*) intradiária no pacote `@bolinha/market-data` e integrá-la como filtro de confluência técnica e motor de risco para compras (`BUY`), impedindo entradas em ativos cuja cotação esteja abaixo do preço médio institucional ponderado por volume.

---

## 1. Contexto e Problema
- A **VWAP** é o indicador de referência mais crítico do mercado de ações na B3. Os grandes players institucionais (tesourarias de bancos e fundos de investimento) utilizam a VWAP como balizador de execução de suas ordens.
- Quando uma ação está sendo negociada **abaixo da VWAP**, a pressão vendedora institucional é predominante. Tentar comprar nesse cenário muitas vezes é uma tentativa perigosa de "segurar faca caindo".
- O Bolinha Trader atualmente valida EMA9 vs EMA21 e RSI14, mas ainda não avalia a relação do preço atual com a VWAP da sessão.

---

## 2. Requisitos de Engenharia

### A. Cálculo da VWAP (`packages/market-data`)
- Implementar a função `calculateVWAP(candles: Candle[]): number` a partir dos candles da sessão diária:
  $$\text{VWAP} = \frac{\sum (\text{Preço Típico} \times \text{Volume})}{\sum \text{Volume}}$$
  Onde $\text{Preço Típico} = \frac{\text{Máxima} + \text{Mínima} + \text{Fechamento}}{3}$.
- Adicionar o valor da VWAP nos snapshots de mercado gerados por `makeSnapshot`.

### B. Filtro de Entrada e Motor de Risco (`packages/risk-engine` e `@bolinha/core`)
- Adicionar flag configurável `ENTRY_REQUIRE_VWAP_ABOVE` (padrão `true`).
- No `evaluateCandlesEntryConfluence` e no `applyB3Risk`:
  - Para emitir ou autorizar `BUY`, o preço de mercado atual deve estar maior ou igual à VWAP intradiária (`currentPrice >= vwap`).
  - Se `currentPrice < vwap`, o `BUY` é rebaixado para `HOLD` com motivo: `BUY rejected: Price R$ X.XX is below daily VWAP R$ Y.YY`.

### C. Alinhamento de Prompt da IA (`packages/ai`)
- Expor o valor da VWAP e o percentual de distância do preço para a VWAP no prompt para a IA.
- Explicar no prompt que a VWAP atua como suporte institucional e filtro obrigatório de compra.

### D. Testes e Qualidade
- Testes unitários do cálculo matemático da VWAP com volumes ponderados.
- Testes de confluência e rejeição no motor de risco quando abaixo da VWAP.
- Validar `pnpm test` e `pnpm typecheck`.
