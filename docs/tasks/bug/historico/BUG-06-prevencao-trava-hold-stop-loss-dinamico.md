# BUG-06: Prevenção de Trava de Posição sem Saída (Stop Loss e Take Profit Intradiários Dinâmicos)

## Status: done
**Data de Criação:** 2026-10-16  
**Prioridade:** Alta  
**Origem:** Auditoria operacional do teste em andamento na sessão B3 (16/10/2026)  
**Pacotes Afetados:** `@bolinha/ai`, `@bolinha/risk-engine`, `@bolinha/worker`

---

## 1. Contexto e Problema Observado

No teste operacional com B3 (`PETR4`), foram registradas 2 compras nos primeiros ciclos, montando posição de 2 ações a um preço médio de R$ 31,14.
Em seguida, por **mais de 30 ciclos consecutivos (1,5 hora de pregão)**, a IA emitiu ininterruptamente decisões de **HOLD**, sem realizar vendas parciais, sem realizar lucro em repiques nem estopar quando a tese enfraqueceu.

### Análise das Decisões de IA (`ai_decisions`):
Nos motivos registrados pela IA (`reason`):
> *"O preço atual está abaixo do preço de entrada, resultando em um PnL não realizado negativo... A posição atual já está com PnL negativo, e adicionar mais ações agora poderia aumentar o risco... Portanto, a melhor ação é HOLD e aguardar por um sinal de compra mais forte ou uma recuperação da posição atual."*

### Causa Raiz:
1. **Viés Assimétrico de Não-Realização de Prejuízo (Loss Aversion da IA):**
   - O prompt instrui regras gerais de trading, mas não força a IA a reavaliar objetivamente a perda máxima permitida por trade intradiário (Stop Loss rígido).
   - Quando o preço cai abaixo da entrada, a IA tende a ficar travada em HOLD indefinido na esperança de recuperação ("torcida"), até que o horário de `FORCE_CLOSE` (17:55) descarte a posição de forma abrupta a mercado no final do dia.
2. **Ausência de Alvos Objetivos no Motor de Risco / Prompt:**
   - O prompt não expõe explicitamente para a IA os gatilhos matemáticos de:
     - Preço de Stop Loss do trade (ex: -0,8% a -1,5% do preço médio de entrada).
     - Preço de Take Profit parcial (ex: +0,8% do preço médio) e total (ex: +1,8%).
   - Caso a IA hesite, o motor de risco deve ter mecanismos ou o prompt deve receber instruções inequívocas com ordens compulsórias de encerramento quando os limites do plano de trade forem violados.

---

## 2. Escopo da Solução

1. **Aprimoramento do Prompt B3 (`buildB3Prompt` em `@bolinha/ai`):**
   - Incluir explicitamente na contextualização da posição:
     - Preço Médio de Entrada
     - Preço Limite de Stop Loss calculado (ex: -1,0% da entrada)
     - Preço Limite de Take Profit Parcial e Total (+1,0% e +2,0%)
   - Instruir a IA de que se o preço atual estiver abaixo do Stop Loss do trade ou perder o suporte intradiário, a ação mandatória é **SELL** (stop de proteção), sendo proibido manter HOLD passivo em deterioração contínua.
2. **Camada de Proteção no Motor de Risco / Worker (`@bolinha/risk-engine` ou `@bolinha/worker`):**
   - Avaliar inclusão de gatilho de segurança opcional ou recomendação ativa no ciclo quando a posição atinge stop máximo intradiário, evitando carregar posições perdedoras até o force close das 17:55.

---

## 3. Critérios de Aceite

- [ ] O prompt B3 calcula e expõe para a IA os níveis explícitos de Stop Loss e Take Profit da posição aberta.
- [ ] As diretrizes do prompt exigem que a IA liquide (SELL) posições que violem o stop loss definido, eliminando o comportamento de HOLD passivo indefinido em trades perdedores.
- [ ] Testes unitários do prompt e do fluxo de decisão cobrindo cenários de Stop Loss atingido e Take Profit atingido.
- [ ] `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% aprovados.
