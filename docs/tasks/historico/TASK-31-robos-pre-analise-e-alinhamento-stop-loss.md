# TASK-31: Arquitetura de Robôs Pré-Analistas Determinísticos e Alinhamento do Stop Loss

## Contexto e Motivação

Durante os testes operacionais na B3:
1. **Insegurança com a IA analisando o todo:** Análises puramente de linguagem natural ou subjetivas da IA geram inconsistências, decisões vacilantes ou saídas intempestivas. No mercado profissional e apps modernos de algotrading, sistemas utilizam **robôs analistas determinísticos** (baseados em setups clássicos, tendências, momentum, suportes/resistências e volatilidade) que avaliam o mercado primeiro e emitem votos e opções concretas de ação pré-qualificadas.
2. **Novo Papel da IA (Decisor Final Seletivo):** A IA não deve mais "olhar o todo do zero" nem alucinar estratégias soltas. Os robôs clássicos realizam a pré-análise e fornecem um menu estruturado de decisões elegíveis com score e justificativa técnica. A IA atua como orquestrador / comitê executivo de decisão, escolhendo entre as opções pré-validadas ou vetando caso observe risco de contexto.
3. **Dessincronia de Stop Loss entre Prompt e Risk Engine:** O prompt calculava o Stop Loss Inicial em `STOP_LOSS_PCT` (1.2%), fazendo a IA achar que o stop foi violado e emitir SELL, enquanto o motor de risco avaliava `MAX_STOP_LOSS_PCT` (1.8%) e bloqueava como saída de pânico discricionária. Ambos devem estar em perfeita harmonia.

## Escopo da Implementação

1. **Alinhamento do Stop Loss:**
   - Sincronizar a leitura de `stopLossPct` no motor de risco (`applyB3Risk`) para que respeite o stop loss configurado no modo `STATIC` (ou seja, `stopLossPct` configurado, e `maxStopLossPct` atuando como clamp/teto máximo de proteção).
   - Ajustar para que a IA e o motor de risco tenham exatamente a mesma régua de preço para o Stop Loss.

2. **Robôs Especialistas de Pré-Análise (`packages/market-data`):**
   - Criar motor de robôs analistas clássicos com estratégias comprovadas:
     - **Robô Trend Following (Tendência / Médias):** Avalia alinhamento de EMA9 / EMA21 em múltiplos timeframes (1m, 5m, 15m) e cruzamento de médias.
     - **Robô Momentum / Reversão (RSI / Osciladores):** Avalia sobrecompra/sobrevenda e exaustão de movimento.
     - **Robô Institucional (VWAP / Volume):** Avalia posição do preço relativo à VWAP e liquidez/volume relativo (Volume State).
     - **Robô de Volatilidade e Risco (ATR / Suporte):** Avalia amplitude de ATR e distância segura para stop/alvo.
     - **Robô de Posição / Trailing (Exit Manager):** Se houver posição aberta, analisa matematicamente o momento da posição (Lucro travado no Breakeven, Parcial, Full TP, ou Proximidade de Stop).
   - Agregar as recomendações dos robôs em um `PreAnalysisReport`:
     - Votos consolidados (`BUY`, `SELL`, `HOLD`) com scores de convicção (0..100%).
     - Lista de **Ações Pré-Qualificadas** sugeridas com seus respectivos pesos e justificativas técnicas quantitativas.

3. **Novo Formato do Prompt e Tomada de Decisão da IA (`packages/ai`):**
   - Inserir o relatório consolidado dos robôs pré-analistas no prompt:
     - "Os robôs de análise técnica quantitativa pré-analisaram o mercado e recomendaram as seguintes opções prioritárias: [Lista de Opções dos Robôs]".
   - A IA é orientada a decidir exclusivamente **a partir da pré-análise dos robôs**, escolhendo a melhor ação recomendada com base nas condições operacionais, gerenciamento da banca e metas.

4. **Integração no Worker (`apps/worker`):**
   - Executar os robôs analistas dentro do ciclo do `TradingService`, gerar o `preAnalysis` e repassar para `buildB3Prompt` e para os eventos de observabilidade.

5. **Testes e Validação:**
   - Testes unitários para os robôs pré-analistas em `packages/market-data`.
   - Testes em `packages/ai` para validar a inclusão da pré-análise no prompt.
   - Testes em `packages/risk-engine` garantindo harmonia entre os stops.
   - Executar `pnpm test` e `pnpm typecheck`.
