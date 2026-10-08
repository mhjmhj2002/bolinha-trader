# TASK 03: Ajuste de Clareza Financeira e Diretrizes Operacionais no Prompt da IA

## Objetivo
Corrigir a ambiguidade na apresentação do saldo de caixa no prompt (que levou a IA a acreditar erroneamente que o saldo estava esgotado devido a dízimas decimais mínimas) e calibrar as instruções para tornar a IA mais assertiva e ativa na identificação de oportunidades de entrada e saída, sem desrespeitar os limites do Risk Engine.

## Contexto Atual
1. **Problema dos Decimais de Caixa**:
   - O prompt enviava `caixa 19.9999979 USDT; banca inicial 20 USDT`.
   - Um LLM interpretou que o saldo disponível eram apenas `0.000002 USDT` restantes e forçou HOLD por falta de liquidez.
2. **Inibição Excessiva por Viés Conservador**:
   - A instrução `"Prefira HOLD sem sinal claro"` em um mercado volátil faz com que qualquer divergência entre timeframes (ex: 1m positivo, 15m neutro) gere paralisia analítica permanente.
   - O sistema de risco (`@bolinha/risk-engine`) já valida de forma determinística valores mínimos (`minNotional`), lote mínimo e posições duplicadas. A IA deve ter liberdade para propor compras quando os timeframes menores (1m e 5m) apresentarem confluência favorável.

## Requisitos de Implementação
1. **Refatoração da Função `buildPrompt` em `packages/ai/src/index.ts`**:
   - Formatar o valor de caixa com duas casas decimais visíveis e indicar explicitamente o montante disponível para nova operação:
     ```ts
     const availableCashUsdt = Number(account.cashUsdt).toFixed(2);
     ```
   - No texto do prompt:
     `Contexto financeiro: banca inicial ${account.initialBankUsdt.toFixed(2)} USDT; caixa disponível para operar ${availableCashUsdt} USDT; posição atual: ...`
   - Adicionar esclarecimento:
     `"Você possui ${availableCashUsdt} USDT disponíveis integralmente para abrir nova posição caso decida por BUY."`
2. **Ajuste das Diretrizes Operacionais de Entrada e Saída**:
   - Substituir a orientação genérica `"Prefira HOLD sem sinal claro"` por diretrizes técnicas explícitas de confluência:
     - **BUY**: Quando houver alinhamento positivo entre 1m e 5m (ex: EMA9 acima de EMA21 com RSI saudável entre 40 e 65, sem sobrecompra extrema).
     - **SELL**: Quando houver posição aberta e os indicadores indicarem perda de momentum (ex: EMA9 cruzando abaixo da EMA21 no 1m/5m, ou RSI > 75).
     - **HOLD**: Quando houver forte divergência ou condições estritamente laterais.
3. **Testes Unitários**:
   - Atualizar os testes de montagem de prompt em `packages/ai/src/index.test.ts` para verificar o formato do caixa e as novas orientações textuais.

## Critérios de Aceite
- [ ] O prompt renderiza o saldo de forma legível e sem induzir o modelo a erro de caixa zero.
- [ ] As diretrizes incentivam a tomada de decisão ativa com base em confluência técnica.
- [ ] Testes unitários do pacote `@bolinha/ai` aprovados (`pnpm --filter @bolinha/ai test`).
- [ ] Arquivo da task movido para `documentacao/tasks/historico/` ao concluir.
