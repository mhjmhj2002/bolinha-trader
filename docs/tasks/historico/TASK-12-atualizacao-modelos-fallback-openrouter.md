# TASK-12: Atualização e Saneamento da Rotação de Modelos Fallback OpenRouter

## Status: to-do
**Data de Criação:** 2026-10-16  
**Prioridade:** Média-Alta  
**Origem:** Auditoria Operacional de Gaps de Mercado e Execução B3 (16/10/2026)  
**Pacotes Afetados:** `@bolinha/core`, `@bolinha/ai`, `@bolinha/worker`

---

## 1. Contexto e Problema Observado

Durante o teste em tempo real, foram registrados eventos no banco (`system_events` IDs 1226, 1233 e 1246):
`OpenRouter fallback model was used`.

Devido a latências elevadas ou instabilidades momentâneas no modelo primário (`google/gemini-2.5-flash`), o cliente OpenRouter recorreu à lista de fallback configurada.
Dentre os modelos ativados esteve o `liquid/lfm-2.5-2.6b:free`, um modelo ultracompacto (2.6 bilhões de parâmetros).
Modelos deste porte frequentemente apresentam baixa consistência em raciocínio causal financeiro, alucinações de formato JSON ou decisões reativas sem análise técnica aprofundada das médias móveis e do book.

---

## 2. Requisitos de Implementação

1. **Saneamento da Lista Padrão de Modelos em `@bolinha/core` e `.env.example`:**
   - Remover modelos minúsculos (< 7B) da lista de rotação de fallback para operações financeiras.
   - Definir uma lista padrão de alta qualidade analítica e comprovada estabilidade:
     - `google/gemini-2.5-flash` (primário)
     - `google/gemini-2.0-flash-001` ou `google/gemini-flash-1.5`
     - `deepseek/deepseek-chat`
     - `meta-llama/llama-3.3-70b-instruct`
     - `mistralai/mistral-small-24b-instruct-2501`
2. **Registro Detalhado de Fallback:**
   - Assegurar que ao utilizar modelo fallback, o log e a tabela `ai_usage` registrem a razão do acionamento (ex: timeout do modelo anterior, erro HTTP ou JSON inválido), facilitando a observabilidade operacional.

---

## 3. Critérios de Aceite

- [ ] A lista padrão de modelos em `@bolinha/core`, `.env` e `.env.example` é composta apenas por modelos com capacidade analítica robusta (>= 20B parâmetros ou linhas Flash/Pro comprovadas).
- [ ] O worker continua executando failover suave sem estourar falha no ciclo quando um modelo demora.
- [ ] Testes unitários de rotação em `@bolinha/ai` cobrindo o fluxo com a nova lista.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
