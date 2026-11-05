# BUG-11: Venda Precoce da IA por Pânico, Alucinação de Violação de Stop Loss e Calibração de Alvos Intradiários

## Contexto e Diagnóstico

Durante a execução da sessão de trading do dia 28/10/2026 (das 09h00 em diante):
1. **Alucinação na Checagem de Stop Loss pela IA:** A IA emitiu ordens de `SELL` justificando textualmente que o preço violou o stop loss quando, matematicamente, o preço estava acima do stop (ex: R$ 29.97 alegado como violando R$ 29.87; R$ 29.86 alegado como violando R$ 29.76).
2. **Venda Prematura/Pânico sem Stop nem Reversão Confirmada:** No trade de BBDC4, a IA pediu `SELL` com PnL de -0.72% com a justificativa de "estar próximo do stop", violando a diretriz explícita de só vender antes do stop se houvesse reversão tripla confirmada (EMA9 < EMA21 em 1m, 5m e 15m). O motor de risco acatou porque o PnL estava fora da banda de ruído de 0.4%, liquidando a posição no fundo.
3. **Alvos Intradiários Longos Demais para Micro-Ciclos de 3 Minutos:** Breakeven e Trailing Stop fixados em +0.80% e Take Profit Parcial em +1.00% deixaram operações que valorizaram até +0.30%/+0.50% devolverem todo o lucro sem proteção.

## Escopo da Correção

1. **Blindagem no Motor de Risco (`packages/risk-engine`):**
   - Se a IA solicitar `SELL` em posição com prejuízo (`pnl < 0`), rejeitar a venda discricionária e forçar `HOLD`, a menos que:
     - O preço tenha realmente atingido ou violado o Stop Loss Efetivo (que é tratado de forma mecânica e autoritativa pelo motor de risco); OU
     - Seja janela de fechamento compulsório de pregão (`isDayTradeCloseOnly`); OU
     - Exista reversão de baixa confirmada em timeframes maiores fornecida via snapshot/confluência.
2. **Calibração de Alvos Mais Sensíveis (`apps/worker`, `packages/ai`, `packages/core`):**
   - Calibrar gatilho de Breakeven padrão para +0.5% (0.005) e Trailing Stop para 0.4% (0.004) ou parametrizável.
   - Ajustar Take Profit Parcial padrão de +1.0% para +0.8% (+0.008) ou permitir captura mais ágil.
3. **Reforço de Prompt da IA (`packages/ai`):**
   - Inserir trava explícita proibindo a IA de emitir `SELL` por "proximidade" ou medo do Stop Loss: se o preço atual for estritamente maior que o Stop Loss Efetivo, é terminantemente proibido afirmar que violou ou vender preventivamente sem reversão tripla.
4. **Testes Unitários:**
   - Adicionar cobertura de teste em `risk-engine.test.ts` e `b3-connector.test.ts` validando a rejeição de SELL precoce em prejuízo fora do stop.
