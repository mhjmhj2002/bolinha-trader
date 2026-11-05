# TASK 28: Saídas Parciais Mecânicas Automáticas com Múltiplos Alvos (Scale-out)

## Objetivo
Implementar execução automática e mecânica de realizações parciais de lucro (Scale-out) pelo motor de risco ao atingir alvos objetivos pré-estabelecidos (Take Profit 1 / Alvo Parcial), reduzindo a exposição da posição e protegendo lucros no caixa sem depender da discricionariedade da IA.

---

## 1. Contexto e Problema
- Quando o robô acumula mais de 1 ação em carteira (ex: 2 a 4 ações), manter 100% da posição até o final expõe os ganhos a reversões bruscas.
- O prompt da IA hoje apenas "sugere" que o modelo realize parcial em +1,0%, mas muitas vezes a IA decide dar `HOLD` esperando mais ganhos, devolvendo o lucro acumulado caso o preço reverta.
- No trading profissional, saídas parciais são tratadas como **regras mecânicas rígidas de risco**:
  - Bateu Alvo 1 (+1,0%): Vende 50% da posição imediatamente a mercado, coloca o dinheiro no bolso e eleva o stop do restante para o breakeven (+0,06%).
  - Os outros 50% continuam abertos surfando a tendência até o Alvo 2 (+2,0% ou +2,5%) ou o Trailing Stop.

---

## 2. Requisitos de Engenharia

### A. Configuração Centralizada (`packages/core`)
- Adicionar configurações no Zod:
  - `PARTIAL_TAKE_PROFIT_TRIGGER_PCT`: Percentual de lucro para ativar parcial (padrão `0.010` = +1,0%).
  - `PARTIAL_TAKE_PROFIT_RATIO`: Proporção da posição a liquidar (padrão `0.5` = 50%).

### B. Motor de Risco (`packages/risk-engine`)
- Em `applyB3Risk`:
  - Se `position.quantity > 1` e `(price - position.entryPrice) / position.entryPrice >= partialTakeProfitTriggerPct`:
    - Verificar se a parcial ainda não foi realizada no trade.
    - Se a IA emitiu `HOLD` ou `BUY`, o motor de risco força a intervenção com `SELL` de quantidade calculada:
      `quantityToSell = Math.max(1, Math.floor(position.quantity * partialRatio))`
    - Motivo explícito: `Automatic partial take profit triggered at +X.XX%`.

### C. Ledger e Posições (`packages/database` e `apps/worker`)
- Garantir que a venda parcial atualize a quantidade da posição em aberto mantendo o preço médio de entrada e debitando as taxas proporcionais.

### D. Testes e Qualidade
- Testes unitários no `@bolinha/risk-engine` e `@bolinha/database` cobrindo venda parcial e continuação da posição com saldo restante.
- Validar `pnpm test` e `pnpm typecheck`.
