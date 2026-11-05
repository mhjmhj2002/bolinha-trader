# TASK-36: Dimensionamento de Posição por Risco (em vez de usar ~90% do caixa)

## Status: `doing`

---

## 1. Contexto e Motivação
Cada posição usa ~R$ 90 da banca de R$ 100 (3 ações a ~R$ 30), então cada stop de 1,3%% custa ~1,2%% do banco, sem diversificação nem ajuste por confiança.

---

## 2. Requisitos Técnicos
1. Calcular a quantidade pelo risco: `qty = (banca * RISK_PER_TRADE_PCT) / distância_do_stop`, respeitando lote, `minQty`, `stepSize` e caixa disponível.
2. Variável `RISK_PER_TRADE_PCT` (default seguro, ex.: 0,5%%) e teto de exposição `MAX_POSITION_PCT`.
3. Opcional: escalar o tamanho pela confiança/convergência dos robôs.
4. Manter o comportamento fee-aware (TASK-16) e o fail-closed quando o lote mínimo inviabilizar a operação.
5. Testes em `@bolinha/risk-engine` e `@bolinha/worker`.

---

## 3. Critérios de Aceite
- Fail-closed: qualquer incerteza resulta em HOLD seguro.
- Novas variáveis em Zod (`packages/core/src/index.ts`), `.env.example` e `.env`, com defaults seguros.
- `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% verdes.
