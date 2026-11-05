# TASK 30: Take Profit Total Mecânico e Trava de Lucro Mínimo (Profit Lock-in / Multi-tier Protection)

## Objetivo
Implementar saída mecânica total por Take Profit (`FULL_TAKE_PROFIT_PCT`), trava de lucro garantido no Breakeven (`BREAKEVEN_PROFIT_LOCK_PCT`) e calibração de alvos intradiários objetivos segundo as práticas globais de gestão de risco em day trade, impedindo que operações que atinjam ganhos relevantes devolvam o lucro ou fechem com prejuízo.

---

## 1. Contexto e Problema
- Na operação real intradiária de PETR4, a posição comprada a R$ 30,38 atingiu pico de R$ 30,65 (+0,89% de valorização, +R$ 0,81 de P/L).
- Como o sistema dependia exclusivamente do `PARTIAL_TAKE_PROFIT_TRIGGER_PCT` (que vende apenas 50% quando há múltiplas ações) ou da discricionariedade da IA para emitir `SELL`, a IA manteve `HOLD` e o preço caiu até -0,29% (R$ 30,29), gerando prejuízo e frustração.
- No trading algorítmico global, **um ganho alvo objetivo encerra 100% da posição de forma mecânica no motor de risco**, sem depender de decisão da IA.
- Além disso, quando o breakeven é ativado, ele deve garantir um **piso de lucro real líquido** (ex: +0,20%), e não apenas os custos de corretagem (+0,06%), garantindo que o trader saia no positivo caso o ativo sofra um pullback.

---

## 2. Requisitos de Engenharia

### A. Configuração Centralizada (`packages/core`)
- Adicionar no schema Zod (`packages/core/src/index.ts`) e `.env.example`:
  - `FULL_TAKE_PROFIT_PCT`: Percentual de ganho para encerramento mecânico total da posição (padrão `0.008` = +0,80%).
  - `BREAKEVEN_PROFIT_LOCK_PCT`: Percentual mínimo de lucro real travado ao acionar o Breakeven (padrão `0.002` = +0,20%).
  - Calibração de `PARTIAL_TAKE_PROFIT_TRIGGER_PCT`: ajustar o padrão para `0.006` (+0,60%) para permitir saídas parciais mais ágeis em micro-ciclos.

### B. Motor de Risco (`packages/risk-engine`)
- Em `applyB3Risk`:
  1. **Full Take Profit Mecânico**:
     - Se `position` estiver aberta e `(price - position.entryPrice) / position.entryPrice >= fullTakeProfitPct`:
       - Disparar `SELL` imediato de 100% da quantidade da posição (`position.quantity`).
       - `rejectionReason: "Automatic full take profit triggered at +X.XX%"`.
  2. **Breakeven com Lucro Garantido (Lock-in)**:
     - Ao atingir `breakevenTriggerPct` (+0,5%), o piso de proteção `protectedFloorPrice` passa a ser calculado com `breakevenProfitLockPct`:
       `entryPrice * (1 + breakevenProfitLockPct)` (garantindo no mínimo os +0,20% de lucro líquido).
  3. **Compatibilidade e Prioridade**:
     - O Full Take Profit tem precedência sobre saídas parciais e sobre a discricionariedade da IA.

### C. Worker e Comunicação com IA (`apps/worker` e `packages/ai`)
- Passar os parâmetros `fullTakeProfitPct` e `breakevenProfitLockPct` para o `applyB3Risk`.
- Refletir no prompt de contexto da B3 a existência do alvo total em +0,80% e breakeven com trava de lucro.

### D. Testes e Qualidade
- Testes unitários no `@bolinha/risk-engine` cobrindo:
  - Disparo de Full Take Profit a +0,80% (encerrando 100% da posição).
  - Trava de breakeven protegendo +0,20% de ganho líquido.
  - Saída parcial a +0,60% e Full TP posterior.
- Validação completa com `pnpm test` e `pnpm typecheck`.
