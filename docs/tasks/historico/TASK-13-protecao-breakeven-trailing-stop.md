# TASK-13: Implementação de Proteção por Breakeven e Trailing Stop Dinâmico

## Status: to-do
**Data de Criação:** 2026-10-16  
**Prioridade:** Média  
**Origem:** Auditoria Operacional de Gaps de Mercado e Execução B3 (16/10/2026)  
**Pacotes Afetados:** `@bolinha/ai`, `@bolinha/risk-engine`, `@bolinha/worker`

---

## 1. Contexto e Problema Observado

Atualmente, o nível de Stop Loss é calculado de forma estática com base estrita no preço de entrada inicial da posição.
Se uma posição em aberto subir favoravelmente e atingir um PnL não realizado positivo de +0,8% a +1,5% (porém sem ainda bater o Take Profit total), o Stop Loss permanece no nível negativo original.

### Risco:
Caso o mercado sofra uma reversão intradiária abrupta, uma posição que esteve com lucro substancial pode devolver 100% dos ganhos e ainda ser encerrada com prejuízo financeiro.

---

## 2. Requisitos de Implementação

1. **Regra de Breakeven Automático:**
   - Quando o preço atual ultrapassar um limiar positivo (ex: +0,8% em relação à entrada), o Stop Loss de proteção deve ser automaticamente elevado para o **preço de entrada (preço médio + taxas)**, eliminando o risco de perda financeira no trade.
2. **Contextualização no Prompt B3:**
   - O prompt deve indicar para a IA:
     - Preço de Entrada original
     - Preço Máximo atingido pelo trade (High Watermark)
     - Novo Stop Loss ajustado (Breakeven ou Trailing)
     - Instrução explícita de que a posição já está em lucro protegido e não deve ser deixada reverter para perda.
3. **Trava no Motor de Risco:**
   - O motor de risco `@bolinha/risk-engine` deve monitorar o Breakeven quando ativo, impedindo que o preço caia abaixo do custo total uma vez atingido o gatilho de proteção.

---

## 3. Critérios de Aceite

- [ ] Posições com lucro >= gatilho de breakeven têm seu stop de proteção ajustado para pelo menos o preço de entrada.
- [ ] O prompt B3 informa o estado de Breakeven/Trailing Stop quando ativo.
- [ ] Testes unitários validando a progressão do stop com a valorização do preço.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
