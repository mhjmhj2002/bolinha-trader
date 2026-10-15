# BUG-05: Normalização do Gerador Sintético de Candles e Correção de Saturação do RSI em 100

## Contexto e Sintoma Observado
Durante a auditoria das decisões da IA e dos snapshots de mercado registrados no banco de dados (`market_snapshots` e `ai_decisions`):
1. **Saturação Contínua do RSI em 100.00**:
   - Em mais de 80% dos ciclos operacionais, os indicadores `rsi14` nos tempos gráficos de 1m, 5m e 15m estavam travados em `100.00`.
   - Isso induziu a IA a emitir decisões repetitivas com a justificativa: *"PETR4 está em estado de sobrecompra (RSI 100 em todos os intervalos)..."*, forçando ordens de saída precipitadas mesmo quando o movimento não justificava.
2. **Causa Raiz Identificada**:
   - Em `packages/market-data/src/index.ts`, a função `rsi()` retorna `100` diretamente se `losses === 0` (`if (losses === 0) return 100`).
   - O gerador sintético em `B3MarketDataService.candles()` utiliza uma função determinística baseada em `Math.sin(i / 5)` que gerou sequências monotônicas de subida em janelas de 14 candles, gerando zero candles de baixa (`diff < 0`), travando o RSI no teto.
   - O gerador sintético precisa de um modelo estocástico mais realista (ex: Random Walk com volatilidade equilibrada entre ganhos e perdas) para evitar comportamentos artificiais degenerados.

## Critérios de Aceite
1. **Geração Realista de Candles Estocásticos**:
   - Ajustar a simulação sintética de candles para que haja distribuição natural de altas e baixas representativa do comportamento intradiário de ações da B3.
   - Garantir coerência temporal: os preços de abertura, fechamento, máxima e mínima devem manter continuidade com a vela anterior.
2. **Robustez no Cálculo do RSI**:
   - Tratar com suavização os períodos de baixíssima volatilidade ou sem perdas para evitar que o RSI trave de forma permanente em 100 sem alternância dinâmica.
3. **Validação Automatizada**:
   - Teste unitário validando a distribuição do RSI gerado para 1m, 5m e 15m, comprovando que ele oscila dinamicamente pelas faixas normais (abaixo de 70, neutro e acima de 30) em vez de permanecer fixado em 100.
   - `pnpm test` e `pnpm typecheck` 100% verde.
