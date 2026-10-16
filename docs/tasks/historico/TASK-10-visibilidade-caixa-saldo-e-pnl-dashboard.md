# TASK-10: Visibilidade de Saldo em Caixa Livre e Detalhamento de Banca e PnL no Dashboard

## Status: done
**Data de Criação:** 2026-10-16  
**Prioridade:** Alta  
**Origem:** Auditoria operacional do teste em andamento na sessão B3 (16/10/2026)  
**Pacotes Afetados:** `@bolinha/database`, `@bolinha/api` (Frontend Dashboard e Endpoints)

---

## 1. Contexto e Problema Observado

Durante o teste em andamento com a banca fracionada de R$ 100,00, foram feitas 2 compras de 1 ação de PETR4 cada (totalizando R$ 62,28).
O usuário observou que o card de métricas do topo do dashboard exibia o valor de **"BANCA ATUAL: R$ 98,19"** e relatou a impressão de que a banca "não caiu após as compras", além de questionar a ausência de um campo indicando o saldo/caixa remanescente.

### Diagnóstico Técnico:
1. **Omissão de Caixa Livre nos Cards do Topo:**
   - O card "BANCA ATUAL" exibe `account.equityUsdt` (Patrimônio Líquido Total = Caixa + Posição a Mercado).
   - O campo `account.cashUsdt` (Caixa Disponível / Saldo Livre) existe no PostgreSQL e na resposta da API (`/dashboard/data`), mas **não é apresentado em nenhum dos cards de métricas do topo**.
2. **Ambiguidade no Card "RESULTADO DO DIA":**
   - O card exibe o P/L Total (marcação a mercado quando há posição aberta), sem distinguir visualmente entre **P/L Realizado** (lucro/prejuízo de vendas já fechadas no dia) e **P/L Não Realizado / Flutuante** (variação das ações ainda em custódia).
   - Quando o operador vê saldo negativo sem ter havido nenhuma venda, gera a falsa impressão de perda definitiva ou falha de contabilidade.

---

## 2. Escopo da Solução

1. **Ajuste na API Read Model (`dashboardData` em `@bolinha/database`):**
   - Garantir que `account` retorne explicitamente:
     - `cashUsdt` (Caixa livre / saldo disponível)
     - `equityUsdt` (Patrimônio total líquido)
     - `initialBankUsdt` (Banca inicial de referência)
     - `positionCostUsdt` (Capital alocado em custódia ativa)
     - `positionMarketValueUsdt` (Valor atualizado a mercado da custódia)
   - Em `performance`, garantir que ambos `realizedPnlUsdt` e `unrealizedPnlUsdt` estejam sempre disponíveis no payload para exibição discriminada.

2. **Aprimoramento da Interface do Dashboard (`apps/api/public/dashboard/`):**
   - **Card 1 - BANCA / PATRIMÔNIO:**
     - Exibir o Patrimônio Total (`equityUsdt`) em destaque.
     - No subtítulo, exibir o detalhamento:
       `Caixa: R$ XX,XX · Em Ações: R$ YY,YY` (ou saldo inicial vs caixa disponível).
   - **Card 2 - RESULTADO DO DIA (P/L):**
     - Exibir o P/L Total em destaque.
     - No subtítulo ou badge, exibir discriminado:
       `Realizado: R$ X,XX · Flutuante (MTM): R$ Y,YY`.
   - Adicionar ou adequar card com destaque para **Saldo Disponível (Caixa)** para que o operador saiba exatamente quanto dinheiro tem livre para novas ordens de compra a qualquer momento.

---

## 3. Critérios de Aceite

- [ ] O dashboard exibe claramente o valor do Caixa Livre / Saldo Disponível após as compras em tempo real.
- [ ] O card de Banca mostra a distinção entre Patrimônio Total e Dinheiro em Caixa.
- [ ] O card de Resultado do Dia discrimina visualmente o PnL Realizado (vendas encerradas) do PnL Flutuante (marcação a mercado de posições abertas).
- [ ] Testes unitários de contrato do read model `dashboardData` atualizados e passando.
- [ ] `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% verdes.
