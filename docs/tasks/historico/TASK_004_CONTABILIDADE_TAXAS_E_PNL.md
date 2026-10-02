# TASK_004 — Contabilidade correta de taxas, custos e P/L

## Objetivo

Tornar o ledger da Operação Bolinha de Gude contabilmente correto para taxas da Binance.

Hoje o adapter agrega `commission`, mas não preserva adequadamente `commissionAsset`.

Isso pode gerar P/L incorreto quando a taxa for cobrada em:
- BTC;
- USDT;
- BNB;
- outro ativo.

Continuamos SOMENTE na Binance Spot Testnet.

Não habilitar produção.

## 1. Preservar fills reais

Alterar o modelo de ordem executada para persistir os fills relevantes retornados pela Binance.

Cada fill deve preservar pelo menos:

- price;
- qty;
- commission;
- commissionAsset;
- tradeId quando disponível.

Não reduzir toda a comissão a apenas um número sem unidade.

## 2. BUY com taxa em BTC

Exemplo:

executedQty = 0.00007000 BTC
commission = 0.00000007 BTC

A posição conceitual real deve ser:

0.00006993 BTC

O custo em USDT continua baseado no quote gasto.

Não registrar como posição uma quantidade de BTC que foi consumida em taxa.

## 3. BUY com taxa em USDT

Se comissão for cobrada em USDT:

custo total da posição =
quote gasto + comissão USDT

Caixa conceitual deve refletir isso.

## 4. SELL com taxa em USDT

Receita líquida:

quote recebido - comissão USDT

P/L realizado deve usar receita líquida.

## 5. SELL com taxa em BTC

Se a Binance descontar comissão do ativo-base:

tratar corretamente a quantidade efetivamente consumida.

Nunca criar divergência entre:
- quantidade conceitual;
- quantidade vendida;
- taxa.

## 6. Comissão em terceiro ativo

Exemplo: BNB.

Não descontar incorretamente do caixa USDT ou da posição BTC.

Persistir a taxa separadamente.

Criar estrutura que permita futuramente converter seu valor para USDT para relatórios.

Para esta versão:
- preservar quantidade;
- preservar ativo;
- não inventar conversão histórica se não houver dado confiável.

## 7. Banco

Adicionar estrutura adequada, preferencialmente tabela:

trade_fees

Campos sugeridos:

- id
- trade_id
- asset
- amount
- amount_usdt nullable
- created_at

Ou outra solução equivalente normalizada.

Não perder os dados crus dos fills.

## 8. P/L

Revisar cálculo:

P/L realizado =
receita líquida da venda
- custo efetivo da posição

Garantir que taxas em USDT sejam consideradas corretamente.

Unrealized P/L deve usar:
- quantidade BTC líquida realmente pertencente à posição;
- custo efetivo persistido.

## 9. API

Adicionar taxas relevantes em:

GET /trades
GET /performance
GET /performance/daily

Exemplo:

{
  "grossPnlUsdt": 0.12,
  "feesUsdt": 0.01,
  "netPnlUsdt": 0.11
}

Quando taxa não puder ser convertida para USDT:
- informar separadamente por ativo;
- não fingir precisão.

## 10. Daily result

Persistir:

- grossPnlUsdt;
- feesUsdtKnown;
- netPnlUsdt;
- feesByAsset.

## 11. Testes

Cobrir:

- BUY com taxa em BTC;
- BUY com taxa em USDT;
- SELL com taxa em USDT;
- SELL com taxa em BTC;
- comissão em BNB;
- P/L bruto;
- P/L líquido;
- posição líquida após taxa em BTC;
- idempotência da taxa durante reconciliação.

## 12. Smoke Testnet

Atualizar smoke test para mostrar:

BUY
gross BTC:
fees:
net BTC position:

SELL
gross received:
fees:
net received:
gross P/L:
net P/L:

## 13. Não fazer

Não:
- habilitar produção;
- inventar taxa fixa;
- assumir sempre USDT;
- converter BNB usando preço atual como se fosse histórico;
- habilitar loop automaticamente.

## 14. Validação

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm trading:smoke:testnet

Manter:

TRADING_LOOP_ENABLED=false

## 15. Entrega

Informar:

- modelo adotado para fills/taxas;
- migrations;
- cálculo final de P/L;
- testes;
- resultado do smoke;
- confirmação de loop OFF.