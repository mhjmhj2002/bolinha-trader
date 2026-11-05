# TASK-35: Calibração de Stop/Alvo contra Volatilidade Real e Custos de Transação

## Status: `doing`

---

## 1. Contexto e Motivação
Teste de 30/10 (09:05–12:22): 3 de 4 operações fecharam em stop loss de ~1,3%, e o único ganho (+R$ 0,28) saiu por breakeven/trailing. Relação ganho/perda negativa; equity R$ 96,57 sobre R$ 100. Slippage de ~0,066%% por lado mais taxas dá custo de round-trip de ~R$ 0,18, da mesma ordem do lucro esperado.

---

## 2. Requisitos Técnicos
1. Calcular a expectativa mínima de movimento (custos de round-trip + slippage + margem) e bloquear BUY quando o alvo líquido esperado não a superar.
2. Validar se o stop (ATR/ruído intradiário) está compatível com a volatilidade do ativo; registrar a razão ganho/perda esperada (R:R) na decisão.
3. Exigir R:R mínimo configurável (ex.: `MIN_REWARD_RISK_RATIO`).
4. Relatório de backtest/replay sobre os trades de 30/10 comparando parâmetros atuais e calibrados.
5. Testes unitários em `@bolinha/risk-engine`.

---

## 3. Critérios de Aceite
- Fail-closed: qualquer incerteza resulta em HOLD seguro.
- Novas variáveis em Zod (`packages/core/src/index.ts`), `.env.example` e `.env`, com defaults seguros.
- `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% verdes.
