# TASK 33: Alvos de Lucro (Take Profit) Líquidos Conscientes de Taxas e Imposto de Renda (IR 20%)

## Objetivo
Implementar modelo de cálculo de lucro líquido real para saídas por Take Profit (parcial, total e breakeven/trava de lucro), garantindo que os percentuais de ganho configurados considerem os custos operacionais (emolumentos B3, taxa de liquidação, slippage) e a retenção de Imposto de Renda de Day Trade (alíquota de 20% sobre o lucro líquido), evitando que operações atinjam a meta bruta mas resultem em lucro irrisório ou abaixo do planejado após custos.

---

## 1. Contexto e Problema
- Atualmente, as metas de saída por lucro (`PARTIAL_TAKE_PROFIT_TRIGGER_PCT`, `FULL_TAKE_PROFIT_PCT` e `BREAKEVEN_PROFIT_LOCK_PCT`) avaliam apenas a variação bruta de preço:
  `gainPct = (price - entryPrice) / entryPrice`.
- Nas operações de Day Trade na B3:
  1. Há custos de **slippage** (~0,05% compra e ~0,05% venda = ~0,10% total) e **taxas B3 / emolumentos** (~0,03% compra e ~0,03% venda = ~0,06% total).
  2. O ganho de capital em Day Trade é tributado em **20% de Imposto de Renda sobre o lucro líquido**.
- Quando o robô aciona um Take Profit com ganho bruto de +0,60% ou +0,80%, os custos fixos operacionais mais o IR consomem parcela substancial do resultado (de 35% a mais de 50% do lucro bruto esperado), resultando em lucro líquido muito inferior ao planejado pelo operador.

---

## 2. Requisitos de Engenharia

### A. Modelagem Financeira Centralizada (`@bolinha/core`)
- Adicionar em `packages/core/src/b3-costs.ts`:
  - Constante de alíquota de IR para Day Trade B3: `B3_DAY_TRADE_TAX_RATE = 0.20` (20%).
  - Funções utilitárias:
    - `b3NetProfit(entryPrice, exitPrice, quantity, costModel, taxRate)`: calcula o lucro financeiro líquido e a rentabilidade líquida percentual real.
    - `b3RequiredPriceForNetTarget(entryPrice, targetNetGainPct, costModel, taxRate)`: calcula o preço de mercado mínimo necessário na venda para entregar o retorno percentual líquido alvo (após abater taxas e IR).
- Adicionar no schema Zod (`packages/core/src/index.ts` e `.env.example`):
  - `DAY_TRADE_TAX_RATE`: z.coerce.number().min(0).max(0.50).default(0.20)
  - `PROFIT_TARGET_CALCULATION_MODE`: z.enum(['NET', 'GROSS']).default('NET')

### B. Motor de Risco (`@bolinha/risk-engine`)
- Ajustar `applyB3Risk`:
  - Receber `dayTradeTaxRate` e `profitTargetMode` nos inputs do motor de risco.
  - Ao avaliar gatilhos de `partialTakeProfitTriggerPct`, `fullTakeProfitPct` e `breakevenProfitLockPct`:
    - No modo `'NET'` (padrão): verificar se o preço atual atinge ou supera o preço mínimo líquido calculado (`b3RequiredPriceForNetTarget`) ou se `netGainPct >= targetPct`.
    - No modo `'GROSS'`: manter compatibilidade retroativa com cálculo bruto simples.
  - Atualizar mensagens de justificativa de execução (`rejectionReason`) evidenciando ganho bruto e ganho líquido estimado.

### C. Robô Gestor de Saída (`@bolinha/market-data`)
- Alinhar o robô analista gestor de posição em `packages/market-data/src/index.ts`:
  - Calcular o `netPnlPct` estimado considerando os custos de corretagem/emolumentos e alíquota de IR para emissão de sinal de Take Profit consistente com o motor de risco.

### D. Observabilidade e Visibilidade (`@bolinha/ai` e `@bolinha/exchange`)
- No prompt da IA (`packages/ai/src/index.ts`), informar o PnL não realizado bruto e o PnL líquido estimado pós-custos e IR (20%), garantindo que a IA tenha ciência do resultado real.
- No `B3PaperBroker` (`packages/exchange/src/b3/paper-broker.ts`), registrar o lucro contábil já separando a provisão estimada de IR quando houver ganho.

### E. Testes e Validação
- Testes unitários cobrindo:
  - Cálculo de `b3RequiredPriceForNetTarget` com emolumentos, slippage e IR.
  - Disparo de Take Profit respeitando o alvo líquido.
  - Cobertura da suíte automatizada (`pnpm test`) e tipos TypeScript (`pnpm typecheck`).
