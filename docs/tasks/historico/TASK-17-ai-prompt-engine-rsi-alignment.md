# TASK-17: Alinhamento do Prompt com o Gate Determinístico e Robustez no Parsing de Respostas da IA

## Status: done
**Data de Criação:** 2026-10-22  
**Prioridade:** Alta  
**Origem:** Auditoria de IA e Motor de Risco — divergência prompt↔engine e parsing frágil das respostas do OpenRouter  
**Pacotes Afetados:** `@bolinha/ai`, `@bolinha/market-data`

---

## 1. Contexto e Problema Observado

Existem três defeitos independentes que degradam a taxa de decisões úteis da IA e o diagnóstico operacional.

### 1.1 Divergência entre o prompt e o gate determinístico
- `packages/ai/src/index.ts:88` instrui o modelo de que a condição de RSI se aplica **somente ao timeframe de 5m**: *"RSI de 5m não sobrecomprado"*.
- `packages/market-data/src/index.ts:113-114` aplica `rsi14 < rsiOverboughtThreshold` a **TODOS os timeframes de entrada** (`1m`, `5m`, `15m`).
- O mesmo trecho do prompt exige *"volume não baixo"*, regra que o motor determinístico **nunca verifica**.

Consequência: a IA é instruída com um conjunto de regras diferente do que efetivamente a aprova ou rebaixa para `HOLD`. O modelo pode emitir `BUY` acreditando cumprir o critério e ter a decisão rebaixada silenciosamente, gerando ciclos inteiros de `HOLD` sem diagnóstico claro.

### 1.2 Schema de wire rejeita respostas válidas
- `packages/ai/src/index.ts:5` define `confianca: z.coerce.number().min(0).max(1)`. Uma resposta `confianca: 85` (percentual em vez de fração) é rejeitada e convertida em `HOLD` silencioso.
- O mesmo schema não tolera **aliases comuns de chaves** (nomes em inglês), também caindo em `HOLD` por schema inválido.

### 1.3 Classificação de erro por prefixo de string
- `packages/ai/src/index.ts:129-131` trata como falha de parsing qualquer `motivo` que meramente **comece** com a palavra `"Invalid"` (`decision.reason.startsWith('Invalid')`).
- Como `motivo` é texto livre gerado pelo modelo, um motivo legítimo como *"Invalid volume confirmation, staying HOLD"* dispara rotação de fallback indevida.

---

## 2. Requisitos de Implementação

1. **Prompt espelhando o gate determinístico:**
   - Reescrever o texto de `buildB3Prompt` para declarar exatamente a regra aplicada em `packages/market-data`: condição de RSI avaliada em **todos** os timeframes de entrada (`1m`, `5m` e `15m`).
   - Remover regras fantasma do prompt (a exigência de *"volume não baixo"*) ou implementá-las no gate determinístico. Nenhuma regra deve existir apenas em um dos lados.
2. **Schema de wire tolerante, mas fail-closed:**
   - Normalizar confiança em estilo percentual (`85` → `0,85`) e aceitar aliases comuns de chaves, mantendo `HOLD` seguro para payloads genuinamente inválidos.
3. **Classificação de falha de parsing por flag de máquina:**
   - Substituir a checagem de prefixo de string por um indicador estruturado (ex: campo `parseError: boolean` / discriminante no `AiDecision`), de forma que `motivo` volte a ser texto livre sem efeito colateral.

---

## 3. Critérios de Aceite

- [ ] O texto do prompt corresponde exatamente ao gate determinístico de `packages/market-data`, sem regras fantasma (RSI em 1m/5m/15m; sem exigência de volume não verificada).
- [ ] O schema de wire aceita confiança percentual (normalizando `85` → `0,85`) e aliases comuns de chaves.
- [ ] Payloads realmente inválidos continuam falhando fechado (`HOLD`), sem execução de ordem.
- [ ] A classificação de falha de parsing usa flag de máquina; um `motivo` iniciado por "Invalid" vindo do modelo **não** é mais tratado como erro de parsing.
- [ ] Testes unitários em `@bolinha/ai` cobrindo: confiança percentual, aliases de chaves, payload inválido (fail-closed) e `motivo` iniciado por "Invalid".
- [ ] Teste (ou asserção de prompt) garantindo sincronia entre o texto do prompt e os timeframes avaliados pelo gate.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
