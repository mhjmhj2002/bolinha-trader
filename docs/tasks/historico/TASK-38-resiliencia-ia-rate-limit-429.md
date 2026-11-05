# TASK-38: Resiliência da IA a Rate Limit (HTTP 429) com Backoff e Confiança no Fallback

## Status: `doing`

---

## 1. Contexto e Motivação
Houve 3 fallbacks por HTTP 429 do OpenRouter para `deepseek/deepseek-chat`. As 2 compras decididas pelo fallback tiveram confiança menor (0,54) que as do Gemini (0,83).

---

## 2. Requisitos Técnicos
1. Retry com backoff exponencial e jitter (respeitando `Retry-After`) no modelo principal antes do fallback.
2. Confiança mínima mais alta (`AI_FALLBACK_MIN_CONFIDENCE`) para executar BUY quando o fallback for usado; caso contrário, HOLD.
3. Registrar métricas de 429/fallback em `daily_results` e eventos.
4. Verificar o preenchimento de `daily_results` no fechamento da sessão (a tabela estava vazia durante o teste).
5. Testes em `@bolinha/ai` e no worker.

---

## 3. Critérios de Aceite
- Fail-closed: qualquer incerteza resulta em HOLD seguro.
- Novas variáveis em Zod (`packages/core/src/index.ts`), `.env.example` e `.env`, com defaults seguros.
- `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% verdes.
