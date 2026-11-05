# TASK-18: Centralização e Efetividade das Variáveis Financeiras no Schema Zod

## Status: done
**Data de Criação:** 2026-10-22  
**Prioridade:** Alta  
**Origem:** Auditoria de configuração — variáveis financeiras documentadas em `.env` mas ignoradas em runtime  
**Pacotes Afetados:** `@bolinha/core`, `@bolinha/exchange`, `.env` / `.env.example`

---

## 1. Contexto e Problema Observado

O schema Zod de configuração (`packages/core/src/index.ts:19-49`) **não possui entrada** para `INITIAL_BANK_BRL`, `INITIAL_BANK_USDT` e `MAX_POSITION_PERCENT`, embora essas variáveis estejam definidas em `.env` e `.env.example`.

Como o `z.object()` do Zod não é estrito, as chaves desconhecidas são **silenciosamente removidas** do objeto `config`. Consequência direta: qualquer alteração do operador nessas variáveis não produz efeito algum em runtime, sem erro, sem aviso e sem log.

Agrava o cenário o fato de `packages/exchange/src/index.ts:35-39` criar o broker com capital inicial **hardcoded**:

```ts
return new B3PaperBroker(ticker, 100.0, marketData);
```

Ou seja, mesmo que `INITIAL_BANK_BRL` fosse lida pela configuração, o literal `100.0` no gateway do broker continuaria determinando a banca inicial.

Por fim, `OPENROUTER_API_KEY` tem default `''` (`packages/core/src/index.ts:23`) sem nenhuma validação de startup. Com a chave vazia, o cliente OpenRouter falha em todas as chamadas e o worker cai em `HOLD` indefinidamente, sem mensagem explícita da causa raiz.

---

## 2. Requisitos de Implementação

1. **Schema Zod Completo e Tipado (AGENTS.md §2.2):**
   - Adicionar `INITIAL_BANK_BRL`, `INITIAL_BANK_USDT` e `MAX_POSITION_PERCENT` ao `configSchema` em `packages/core/src/index.ts`, com validação numérica, limites sãos e **defaults seguros**.
   - Refletir as variáveis em `.env.example` **e** `.env`, mantendo os valores já existentes do operador.
2. **Capital Inicial do Broker Derivado da Configuração:**
   - Remover o literal `100.0` de `packages/exchange/src/index.ts` e derivar o capital inicial de `@bolinha/core` (ex: `config.INITIAL_BANK_BRL`).
3. **Validação Explícita de Startup para a Chave de IA:**
   - Gerar falha ou aviso claro e visível de startup quando `OPENROUTER_API_KEY` estiver vazia, em vez de degradar silenciosamente para `HOLD` eterno.
4. **Higiene de Segredos:**
   - `.env` **não** deve ser versionado com segredos (já coberto por `.gitignore`). Não alterar o valor existente da chave; apenas documentar a obrigatoriedade da variável em `.env.example`.

---

## 3. Critérios de Aceite

- [ ] `INITIAL_BANK_BRL`, `INITIAL_BANK_USDT` e `MAX_POSITION_PERCENT` presentes no `configSchema` com defaults seguros e documentados.
- [ ] As três variáveis refletidas em `.env.example` e `.env`, sem sobrescrever valores existentes do operador nem expor segredos.
- [ ] `packages/exchange/src/index.ts` não contém mais o literal `100.0`; o capital inicial do broker vem da configuração.
- [ ] Alterar `INITIAL_BANK_BRL` no `.env` passa a alterar efetivamente a banca inicial do broker em runtime.
- [ ] `OPENROUTER_API_KEY` vazia produz falha ou aviso claro de startup (não mais `HOLD` silencioso permanente).
- [ ] Testes unitários em `@bolinha/core` cobrindo o parsing do schema e os valores default das três variáveis.
- [ ] Documentado que `.env` não é commitado com segredos (apenas `.env.example` é versionado).
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
