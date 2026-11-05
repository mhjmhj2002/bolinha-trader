# TASK-19: Correção de Fuso Horário e de Clamp de Fronteira no Scheduler

## Status: done
**Data de Criação:** 2026-10-22  
**Prioridade:** Média-Alta  
**Origem:** Auditoria do worker — scheduler ignora parcialmente o timezone configurado e pode travar o loop por ~15h  
**Pacotes Afetados:** `apps/worker` (`scheduler.ts`), `@bolinha/core`

---

## 1. Contexto e Problema Observado

### 1.1 Timezone não propagado de forma consistente
- `apps/worker/src/scheduler.ts:13-18` — `atLocalSecond` chama `localTime(at)` **sem** passar o timezone configurado.
- `apps/worker/src/scheduler.ts:25-52` — `nextCycleAt` **passa** `schedule.timezone` ao chamar `localTime(at, schedule.timezone)`.

Os resultados são idênticos hoje apenas porque o timezone configurado (`America/Sao_Paulo`) coincide com o timezone local do processo. Qualquer timezone diferente configurado via API (ex: `America/New_York`, `UTC`) desloca silenciosamente os horários-alvo de `start`, `stopNewPositions`, `forceClose` e `end`, fazendo o worker perder ou deslocar janelas de negociação — falha silenciosa e potencialmente financeira.

### 1.2 Clamp de fronteira que pode empurrar o ciclo para o dia seguinte
- `apps/worker/src/scheduler.ts:44-49` calcula `slot = atLocalSecond(at, Math.min(nextSlotSeconds, boundarySeconds))`.
- Quando o `boundarySeconds` resultante cai **em** ou **atrás** de `now`, o `deltaMs <= 0` dentro de `atLocalSecond` soma 24 horas, rolando o agendamento para o **dia seguinte**. Isso pode estagnar o loop por ~15 horas (por exemplo, próximo de `stopNewPositions`/`forceClose`) em vez de aplicar o pequeno atraso mínimo (`minimumDelayMs`).

---

## 2. Requisitos de Implementação

1. **Timezone Threaded Consistentemente:**
   - Propagar `schedule.timezone` (ou o `TradingConfiguration` completo) por toda a cadeia de cálculo de horário, incluindo `atLocalSecond`, eliminando qualquer uso de `localTime(at)` sem timezone explícito.
2. **Correção do Clamp de Fronteira:**
   - Tratar corretamente o caso em que a fronteira calculada é menor ou igual a `now`, evitando o rollover indevido para o dia seguinte (aplicar `minimumDelayMs` em vez de +24h).
3. **Regressão Coberta por Testes:**
   - Testes unitários com timezone diferente de `America/Sao_Paulo` e com `now` exatamente sobre a fronteira.

---

## 3. Critérios de Aceite

- [ ] `schedule.timezone` é honrado em todos os cálculos de horário do scheduler (nenhuma chamada a `localTime` sem timezone explícito).
- [ ] O edge case de clamp de fronteira não rola mais o ciclo para o dia seguinte quando a fronteira está em/atrás de `now`.
- [ ] Testes unitários com timezone não-`America/Sao_Paulo` validando os horários-alvo das fases (`BEFORE_START`, `TRADING`, `FORCE_CLOSE`, `FINISHED`).
- [ ] Teste unitário com `now` exatamente sobre a fronteira garantindo retorno em `minimumDelayMs` e não +24h.
- [ ] Suíte existente do worker continua 100% aprovada.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
