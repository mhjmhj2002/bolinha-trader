# TASK-32: Desacoplamento Inteligente de IA e Economia de Recursos por Robôs Pré-Analistas

## Contexto e Motivação

Durante os testes na B3 e auditorias operacionais:
1. **Consumo excessivo de IA a cada ciclo:** O ciclo de trading executa a cada 3 minutos durante o pregão (~135 ciclos por dia). Chamar a API de IA em cada ciclo de 3 minutos mesmo quando o mercado está em consolidação evidente, sem confluência ou com posição aberta flutuando normalmente gera gastos desnecessários de tokens e latência, além de aumentar o risco de rate limits (HTTP 429).
2. **Premissa de Arquitetura dos Robôs:** Os robôs matemáticos determinísticos foram desenvolvidos justamente para filtrar e analisar o mercado **antes**. A IA não deve ser chamada a cada interação indiscriminadamente. A IA só deve ser acionada quando houver **necessidade real de decisão discricionária / seletiva**:
   - Quando os robôs identificarem uma oportunidade real de BUY (confluência e setup aprovados);
   - Quando houver uma proposta de saída qualificada (take profit / scale-out discricionário ou reversão de tendência);
   - Quando houver divergência técnica relevante entre os robôs determinísticos exigindo arbitragem do Comitê de IA.
3. **Casos em que a IA NÃO precisa ser chamada (Economia de 100% de Tokens):**
   - **Caso 1 (HOLD determinístico sem setup):** Sem posição aberta e robôs sem confluência para compra (mercado lateral, sem sinal ou preço abaixo de VWAP). O robô pré-analista emite `HOLD` imediatamente com custo R$ 0 de IA.
   - **Caso 2 (HOLD determinístico em posição aberta):** Com posição aberta, flutuando normalmente entre o preço de entrada e o Stop Loss, sem sinal de reversão nem alvos atingidos. O Robô Gestor de Posição emite `HOLD` para não mexer no trade. Custo R$ 0 de IA.
   - **Caso 3 (Saída Mecânica Obrigatória):** Se o preço atingir o Stop Loss Efetivo ou o Full Take Profit mecânico, a ação é executada mecanicamente pelo motor de risco sem depender de IA (zero latência e máxima proteção financeira).

## Escopo da Implementação

1. **Classificação de Necessidade de IA no `PreAnalysisReport` (`packages/market-data`):**
   - Adicionar campos `requiresAiDecision: boolean` e `bypassReason?: string` no `PreAnalysisReport`.
   - `requiresAiDecision = false` quando:
     - Não há posição aberta e o consenso dos robôs é `HOLD` (sem oportunidade real de entrada); OU
     - Há posição aberta e o consenso dos robôs é `HOLD` sem sinal de reversão e dentro da oscilação permitida (evita queimar tokens em ciclos normais de espera); OU
     - Stop Loss já foi atingido de forma compulsória e a saída é mecânica.
   - `requiresAiDecision = true` quando:
     - Há oportunidade qualificada de `BUY` com suporte de robôs; OU
     - Há oportunidade de realização parcial / discricionária de lucro (`SELL`); OU
     - Há divergência técnica relevante entre os robôs (ex: sinais conflitantes entre tendência e osciladores).

2. **Bypass Inteligente no Worker (`apps/worker`):**
   - No `service.ts`, após executar `runRobotsPreAnalysis`:
     - Se `requiresAiDecision === false`:
       - Gera decisão determinística com `modelRequested: 'deterministic_robots'` e custo USD $0,00.
       - Emite evento `INFO: ai_cycle_bypassed` informando que a chamada à IA foi economizada graças aos robôs.
       - Persiste a decisão no banco e segue para o motor de risco com `HOLD` ou a ação mecânica devida.
     - Se `requiresAiDecision === true`:
       - Envia o prompt para a IA (OpenRouter) com os dados pré-analisados.

3. **Observabilidade e Indicadores no Dashboard:**
   - O dashboard e as métricas operacionais registram com clareza as decisões tomadas pelos robôs com economia de IA.

4. **Testes Unitários:**
   - Testar em `market-data.test.ts` a geração correta de `requiresAiDecision = false` em cenários de consolidação/HOLD.
   - Testar em `trading-service.test.ts` o bypass de chamada à IA quando os robôs determinam HOLD determinístico, validando que a chamada à API externa não ocorre e o custo gerado é 0.
   - Executar `pnpm test`, `pnpm typecheck` e `pnpm lint`.
