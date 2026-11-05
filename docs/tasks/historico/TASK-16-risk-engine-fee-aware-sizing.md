# TASK-16: Dimensionamento de Posição no Motor de Risco com Headroom para Custos de Corretagem

## Status: done
**Data de Criação:** 2026-10-22  
**Prioridade:** Alta  
**Origem:** Auditoria de execução B3 (paper) — ordens BUY aprovadas pelo motor de risco e rejeitadas pelo broker por `Insufficient funds`  
**Pacotes Afetados:** `@bolinha/risk-engine`, `@bolinha/core`, `@bolinha/exchange`

---

## 1. Contexto e Problema Observado

O dimensionamento de posição do motor de risco desconhece os custos aplicados pelo broker, criando uma divergência de contabilidade entre a aprovação (`@bolinha/risk-engine`) e a execução (`@bolinha/exchange`).

- `packages/risk-engine/src/index.ts:161-168` calcula `quantity = roundStepDown(amount / price, stepSize)` e rejeita quando `quantity * price > account.cashBrl`. Ou seja, o motor de risco valida apenas o **notional bruto**.
- `packages/exchange/src/b3/paper-broker.ts:92-107` aplica **+0,05% de slippage** sobre o preço de mercado, calcula a comissão de **0,03%** via `calculateB3Fees` sobre o valor bruto e lança `Insufficient funds` quando `cashBrl < gross + commission`. Ou seja, o broker valida o **custo total (bruto + corretagem)**.

### Mecanismo do Problema:
Sempre que o caixa disponível é múltiplo quase exato do preço do ativo, o motor de risco aprova a compra da quantidade máxima e o broker rejeita a ordem, pois o custo total excede o caixa em centavos.

Exemplo canônico: caixa `R$ 100,00`, preço `R$ 25,00`, `stepSize = 1`.
- Motor de risco: `quantity = 4`, `4 * 25,00 = R$ 100,00` → aprovado.
- Broker: `executionPrice = 25,00 * 1,0005 = R$ 25,01` → `gross = R$ 100,04` + comissão `R$ 0,03` → total `R$ 100,07` > `R$ 100,00` → `Insufficient funds`.

O resultado é um ciclo perdido: a decisão BUY da IA é convertida em erro de execução em vez de ser dimensionada de forma executável.

---

## 2. Requisitos de Implementação

1. **Headroom Configurável de Custos e Slippage no Motor de Risco:**
   - Reservar no `@bolinha/risk-engine` uma margem para slippage e corretagem antes de calcular a quantidade executável, de modo que `quantity * price * (1 + headroom) <= cashBrl`.
   - A margem (slippage + taxa) deve ser **configurável e tipada** via Zod em `packages/core/src/index.ts`, com defaults seguros alinhados ao broker (`0,0005` de slippage e `0,0003` de corretagem), refletida em `.env.example` e `.env` (AGENTS.md §2.2).
2. **Alinhamento com a Fonte de Verdade de Custos:**
   - O cálculo de custo usado pelo risco deve ser coerente com `calculateB3Fees` já existente em `@bolinha/exchange`, evitando duas fórmulas divergentes de corretagem.
3. **Preservação do Fail-Closed:**
   - Insuficiência genuína de caixa continua resultando em `HOLD` com motivo explícito; jamais reduzir a regra de lote mínimo (`minNotional`, `minQty`, `stepSize`).

---

## 3. Critérios de Aceite

- [x] O motor de risco reserva headroom configurável de custos/slippage no cálculo de `quantity`.
- [x] Testes unitários em `@bolinha/risk-engine` cobrindo casos de borda estilo `cash = 100,00` / `price = 25,00` (quantidade reduzida para uma ordem executável em vez de rejeitada no broker).
- [x] Teste unitário garantindo que a ordem aprovada pelo risco é efetivamente aceita pelo `B3PaperBroker` (sem `Insufficient funds`).
- [x] A suíte existente de `@bolinha/risk-engine` continua 100% aprovada.
- [x] Comportamento fail-closed (`HOLD` seguro) preservado em casos de insuficiência real e de dados inválidos.
- [x] `pnpm test` e `pnpm typecheck` 100% aprovados.
