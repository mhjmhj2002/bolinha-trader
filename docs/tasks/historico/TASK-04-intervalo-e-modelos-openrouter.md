# TASK 04: Redução do Intervalo Operacional e Atualização de Modelos Gratuitos

## Objetivo
Reduzir a cadência dos ciclos de decisão (permitindo capturar movimentos de scalping e tendências curtas) e otimizar a lista padrão de modelos gratuitos do OpenRouter para modelos com maior estabilidade e menor latência.

## Contexto Atual
1. **Intervalo Operacional Atual**:
   - O intervalo padrão é de 600 segundos (10 minutos). Para o par BTC/USDT em day-trade, 10 minutos deixam muitas janelas de oportunidade passarem sem análise.
   - Reduzir para 180 segundos (3 minutos) ou 300 segundos (5 minutos) permite maior dinamismo e reatividade.
2. **Modelos OpenRouter Atuais**:
   - Modelos como `poolside/laguna-s-2.1:free` apresentaram alta taxa de instabilidade e timeouts.
   - O ecossistema OpenRouter disponibiliza modelos rápidos e consistentes com suporte a chamadas estruturadas/JSON:
     - `google/gemini-2.0-flash-exp:free`
     - `meta-llama/llama-3.3-70b-instruct:free`
     - `mistralai/mistral-small-24b-instruct-2501:free`
     - `qwen/qwen3.8-27b:free`
     - `openrouter/free`

## Requisitos de Implementação
1. **Configuração Padrão do Intervalo em `packages/core/src/index.ts`**:
   - Alterar o `defaultTradingConfiguration.intervalSeconds` para `180` (3 minutos) ou permitir ajuste via variável de ambiente `INTERVAL_SECONDS` com default de `180`.
   - Atualizar a validação em `packages/core`.
2. **Atualização da Lista de Modelos Padrão**:
   - Em `packages/core/src/index.ts` (schema `OPENROUTER_MODELS`), atualizar a lista default:
     ```env
     google/gemini-2.0-flash-exp:free,meta-llama/llama-3.3-70b-instruct:free,mistralai/mistral-small-24b-instruct-2501:free,qwen/qwen3.8-27b:free,openrouter/free
     ```
   - Atualizar `.env` e `.env.example`.
3. **Persistência da Configuração Operacional**:
   - Se o banco de dados já possuir uma linha na tabela `trading_configuration` com o valor antigo de 600s, criar script ou migração/ajuste para atualizar o `interval_seconds` da configuração ativa para 180s.
4. **Testes Unitários e de Integração**:
   - Rodar a suíte de testes (`pnpm test`) garantindo que as contas de ciclos esperados (`calculateExpectedDecisionCycles`) continuem consistentes com o novo intervalo.

## Critérios de Aceite
- [ ] Modelos OpenRouter atualizados para modelos com alta disponibilidade.
- [ ] Intervalo operacional parametrizado/atualizado para 180s (3 min).
- [ ] Tabela `trading_configuration` sincronizada.
- [ ] Testes automatizados passando (`pnpm test`).
- [ ] Arquivo da task movido para `documentacao/tasks/historico/` ao concluir.
