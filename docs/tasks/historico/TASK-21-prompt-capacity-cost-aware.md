# TASK-21: Capacidade de Compra do Prompt Consciente de Custos (Prompt ↔ Engine Capacity Drift)

## Status: done
**Data de Criação:** 2026-10-22  
**Prioridade:** Alta  
**Origem:** Auditoria do Motor de Risco e do Prompt — divergência prompt↔engine na capacidade máxima de compra (BUY rebaixado silenciosamente)  
**Pacotes Afetados:** `@bolinha/core`, `@bolinha/ai`, `@bolinha/exchange`

---

## 1. Contexto e Problema Observado

### 1.1 O prompt anuncia uma quantidade que o motor de risco nunca aprova
- `packages/ai/src/index.ts:233` (antes da correção) calculava a capacidade com
  `maxSharesCanBuy = Math.floor(cash / currentPrice)` — notional puro, **sem** slippage
  nem emolumentos.
- `packages/risk-engine/src/index.ts:203-225` dimensiona o BUY de forma **cost-aware**:
  reserva `estimateB3BuyCost(price, qty).totalBrl * (1 + buffer)` (fonte única em
  `@bolinha/core`) e reduz a quantidade até o débito real caber no caixa.
- Consequência com caixa R$ 100,00 e preço R$ 10,00: o prompt anunciava **10 ações**
  (máx R$ 100,00) enquanto o motor aprovava **9** — o modelo era instruído a pedir um
  tamanho que seria rebaixado (ou rejeitado com `Insufficient funds` no broker).

### 1.2 Definição duplicada de `roundStepDown`
A função de arredondamento vivia inline em `packages/core/src/index.ts:123` e, ao mesmo
tempo, num módulo novo `packages/core/src/rounding.ts` importado por `b3-costs.ts`,
criando duas fontes de verdade para o mesmo arredondamento financeiro.

### 1.3 Caso de capacidade zero com texto sem sentido
Com caixa insuficiente para 1 ação o prompt interpolava `${maxSharesCanBuy} ação(ões)`
e `máx R$ 0,00`, produzindo frases como *"permite comprar até 0 ação(ões)"* e
*"informe no máximo R$ 0,00 (de 1 ação até 0 ações)"*.

---

## 2. Requisitos de Implementação

1. **Fonte única de arredondamento:** manter `roundStepDown` exportado publicamente por
   `@bolinha/core` a partir de `./rounding.js` (re-export no `index.ts`) e remover a
   definição inline duplicada, preservando exatamente
   `Math.floor((value + 1e-12) / step) * step`.
2. **Helper compartilhado de capacidade:**
   `maxAffordableB3BuyQuantity({ cashBrl, price, stepSize, minQty?, minNotional?, costModel?, buyCostBufferPct? })`
   em `packages/core/src/b3-costs.ts`, exportado por `@bolinha/core`, que:
   - reserve `estimateB3BuyCost(...).totalBrl` + headroom (mesma noção de `reservedCost`);
   - arredonde sempre PARA BAIXO no `stepSize` e nunca exceda o caixa com custos;
   - retorne `0` (nunca negativo/NaN/Infinity) quando nem um lote cabe ou os inputs são inválidos;
   - use `resolveBuyCostBufferPct` como default fail-closed.
3. **Prompt usando o helper:** substituir `Math.floor(cash/preço)` em `buildB3Prompt`,
   mantendo `maxBuyAmountBrl` como NOTIONAL (2 casas) e nunca acima do caixa; adicionar
   opção de buffer retrocompatível com default `config.RISK_BUY_COST_BUFFER_PCT`
   (o mesmo valor que o worker passa para `applyB3Risk`).
4. **Texto de capacidade zero:** todas as interpolações (`capacidade máxima`, `caixa
   livre`, `valor_usdt`/BUY, `varie o tamanho`) devem dizer explicitamente que não há
   capacidade de compra, sem números negativos/NaN. Não alterar a regra de entrada
   (`describeEntryConfluenceRule`) nem o texto de RSI.
5. **Motor de risco intocado:** `packages/risk-engine/src/index.ts` mantém a lógica
   inline exatamente como está (quantidades auditadas: 9 / 5 / 3).

---

## 3. Critérios de Aceite

- [x] Existe exatamente UMA definição de `roundStepDown` no código (`packages/core/src/rounding.ts`), re-exportada por `@bolinha/core`; risk-engine e testes seguem importando sem alteração.
- [x] `maxAffordableB3BuyQuantity` existe em `packages/core/src/b3-costs.ts` e é exportado por `@bolinha/core`.
- [x] `maxAffordableB3BuyQuantity(...) === quantidade aprovada por applyB3Risk(...)` em um sweep de 256 combinações de caixa/preço/stepSize/buffer, incluindo 100/10 (9), 60/10 (5), 100.97/30.20 (3), 100/25 (3) e 5/10 (0).
- [x] `B3PaperBroker` preenche (`FILLED`) toda quantidade anunciada, sem `Insufficient funds`.
- [x] Prompt com caixa R$ 100,00 / preço R$ 10,00 anuncia **9** ações (antes: 10) e `máx R$ 90.00`.
- [x] Prompt com caixa R$ 5,00 / preço R$ 10,00 diz *"sem capacidade de compra no momento"*, sem `0 ação(ões)`, `máx R$ 0,00`, `NaN` ou quantidades negativas.
- [x] `maxBuyAmountBrl` (quantidade × preço, 2 casas) nunca excede o caixa disponível.
- [x] Testes unitários do helper (arredondamento, stepSize, minQty/minNotional, custos, buffer, inputs inválidos).
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build` 100% aprovados.
