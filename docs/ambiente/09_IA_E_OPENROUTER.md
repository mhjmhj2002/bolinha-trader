# IA e OpenRouter

## Objetivo

Explicar o papel limitado da IA e a falha segura. Consulte [risco](08_MOTOR_DE_RISCO.md) e [relatórios](14_RELATORIOS.md).

Por ciclo, o worker envia banca/caixa conceituais, posição e indicadores dos candles 1m, 5m e 15m: preço, EMA, RSI, retornos, volume, máximas/mínimas e classificações. A resposta deve ser JSON com `acao`, `valor_usdt`, `confianca` (0–1) e `motivo`.

Ações são normalizadas para `BUY`, `SELL` ou `HOLD`; JSON/schema/ação inválidos viram HOLD. Cada modelo em `OPENROUTER_MODELS` é tentado na ordem, com timeout de 20 s. Timeout, 429, erro HTTP ou resposta ruim levam ao próximo modelo; se todos falham, o resultado é HOLD seguro e erro auditável.

`modelRequested` é enviado ao provedor; `modelReturned` é o que ele devolve e pode diferir. Tokens, custo quando informado, latência, erro e fallback ficam em `ai_usage`. A chave existe apenas em `OPENROUTER_API_KEY`; não há custo fixo garantido.
