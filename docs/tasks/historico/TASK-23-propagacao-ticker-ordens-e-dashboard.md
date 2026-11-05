# TASK 23: Propagação de Ticker do Ativo em Ordens, Posições e Visibilidade Multi-Ativos no Dashboard

## Objetivo
Garantir que o ticker do ativo negociado pelo scanner multi-ativos (ex: `VALE3`, `BBDC4`, `ITUB4`, etc.) seja preservado e propagado em todas as etapas de execução da ordem (`ExchangeOrder`, `persistExecution`, `positions`, `trades`) e exibido com fidelidade no Dashboard Operacional, em vez de recorrer ao fallback estático para `config.SYMBOL` (`PETR4`).

---

## 1. Contexto e Problema
- O scanner multi-ativos (TASK-22) seleciona dinamicamente a melhor oportunidade na cesta (`PETR4,VALE3,ITUB4,BBDC4,BBAS3`).
- No entanto, `ExchangeOrder` e `B3PaperBroker.placeMarketOrder` não incluíam o campo `ticker` no retorno da ordem preenchida.
- Como consequência, `persistExecution` em `apps/worker/src/service.ts:124` fazia fallback para `config.SYMBOL` (`PETR4`):
  ```typescript
  symbol: (order as { ticker?: string }).ticker ?? config.SYMBOL
  ```
- No banco de dados, `positions` era gravada com `PETR4`, e o ciclo seguinte de venda lia a posição aberta achando que era `PETR4`.
- No Dashboard (`@bolinha/database`), `dashboardData` fixava `{ symbol: config.SYMBOL }`, e a tabela de trades não exibia qual papel foi negociado.

---

## 2. Requisitos de Engenharia

### A. Tipagem e Brokers (`packages/exchange`)
- Adicionar `ticker: string` à interface `ExchangeOrder`.
- Em `B3PaperBroker.placeMarketOrder`, preencher `ticker: this.ticker` no objeto retornado.
- Em `B3MetaTraderBridge`, mapear `symbol`/`ticker` no `mapOrder` e retornar `ticker`.

### B. Worker (`apps/worker`)
- Garantir que `submitAndPersistOrder` e `persistExecution` recebam e salvem o `ticker` correto da execução.
- Garantir que o log de eventos (`order_submitted`, `order_executed`, `position_opened`, `position_closed`) registre explicitamente o `symbol: activeSymbol`.

### C. Database e Dashboard Read Model (`packages/database` & `apps/api`)
- Em `packages/database/src/index.ts`:
  - `trades()` deve incluir `t.symbol` ou recuperar o `symbol` da tabela `positions` / `trades`.
  - `dashboardData()` deve retornar o `symbol` real da posição aberta (`livePosition.symbol`) em vez de fixar `config.SYMBOL`.
  - A lista de `trades` do dashboard deve incluir `symbol`.
- Em `apps/api/public/dashboard`:
  - Atualizar a tabela de trades (`trades-table`) para exibir a coluna do Ativo/Ticker negociado.

### D. Testes e Qualidade
- Atualizar e expandir testes unitários cobrindo a correta propagação do ticker.
- Validar suíte completa (`pnpm test`, `pnpm typecheck`, `pnpm lint`).
