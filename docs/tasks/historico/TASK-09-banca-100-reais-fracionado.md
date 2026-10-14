# TASK-09: Banca de R$ 100 com Compras Fracionadas (1 ação até o caixa total)

## Status: done
**Data:** 2026-10-14
**Prioridade:** Crítica

## Objetivo
Permitir day trade com banca a partir de R$ 100, comprando de 1 ação (mín. R$ 1) até todo o caixa, sem lote de 100. Permitir múltiplas compras (aumentar posição) e vendas parciais, para gerar muitas operações heterogêneas.

## Escopo
- `getB3SymbolRules`: `minQty=1`, `stepSize=1` (sem lote padrão de 100).
- `applyB3Risk`: BUY permitido com posição aberta (aumento) e SELL parcial/total conforme `requestedBrl`.
- `B3PaperBroker`: preço médio ponderado ao aumentar posição; banca inicial padrão R$ 100.
- Ledger (`recordExecution`): BUY soma na posição aberta; SELL parcial reduz quantidade/custo proporcional e só fecha ao zerar.
- Prompt B3: instruir variação de tamanho (R$ 1 até o caixa), entradas escalonadas e saídas parciais.
- Defaults: `initialBankUsdt` 100, `INITIAL_BANK_BRL=100` no `.env`/`.env.example`.

## Critérios de Aceite
- [x] Com R$ 100, compra de 1 ação e de N ações até o caixa é aceita.
- [x] Aumento de posição e venda parcial funcionam no ledger e no broker.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` verdes.
