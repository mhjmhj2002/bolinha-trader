# TASK-41: Ajustes Pós-Pregão 05/11: Calibração de Escalabilidade, Cooldown de Tranches e Refinamento do Scanner B3

## Status: `done`

---

## 1. Contexto e Motivação (Auditoria do Pregão 05/11/2026)
No pregão de 05/11/2026:
- 8 posições operadas, resultado final: -R$ 1,95 (-1,95%).
- O **Time-Stop de 45 minutos** comprovou alta eficácia protetiva: das 6 perdas, 5 foram encerradas pelo time-stop praticamente no zero a zero (perdas mínimas de -0,01 a -0,21), impedindo que caíssem em stop loss cheio (-1,23%).
- Apenas 1 posição atingiu stop loss mecânico (-1,23% em BBDC4).
- As operações vencedoras (+0,46 em PETR4 e +0,08 em BBAS3) mostraram que papéis com tendência e momentum geram retorno positivo.
- **Gargalos identificados**:
  1. **Concentração excessiva em ativos estagnados (BBDC4)**: 4 das 8 operações do dia foram em BBDC4, que oscilou em range muito estreito e sem volume de expansão, resultando em saídas por time-stop.
  2. **Agrupamento de entradas escalonadas (Scaling Tranches)**: Na posição #3 (BBDC4), as 3 tranches de compra ocorreram em menos de 7 minutos (14:17, 14:18 e 14:24), acumulando posição no mesmo topo local antes da reversão.
  3. **Time-Stop**: 45m foi muito protetivo, mas pode ser refinado para 35-40 minutos quando o ativo não demonstrar progresso inicial, liberando capital mais rápido.

---

## 2. Requisitos Técnicos
1. **Cooldown / Intervalo Mínimo entre Tranches de Entrada Escalonada**:
   - Criar parâmetro configurável `ENTRY_SCALING_COOLDOWN_MINUTES` (padrão: 5 minutos).
   - Impedir que novas tranches de aumento de posição (`BUY` com posição aberta) sejam autorizadas se o tempo decorrido desde a última execução/tranche for menor que esse cooldown.
2. **Filtro de Qualidade de Volatilidade / Volume no Scanner Multi-Ativos B3**:
   - Ajustar a pontuação de ranqueamento do scanner para priorizar ativos com maior amplitude/volatilidade útil (ATR) e momentum ativo, penalizando ativos em consolidação estagnada (range muito estreito).
3. **Calibração de Configurações no `.env` e `.env.example`**:
   - Parametrizar `ENTRY_SCALING_COOLDOWN_MINUTES` com Zod no pacote `@bolinha/core`.
   - Atualizar `TIME_STOP_MINUTES` para 35 minutos se desejado ou manter 40m/45m com flexibilidade.
4. **Testes Unitários**:
   - Adicionar testes cobrindo o bloqueio de aumento de posição durante o cooldown de escalonamento.
   - Garantir que todos os testes (`pnpm test`) e tipos (`pnpm typecheck`) passem com sucesso.

---

## 3. Critérios de Aceite
- `ENTRY_SCALING_COOLDOWN_MINUTES` implementado no `core`, `risk-engine` e orquestrado no `worker`.
- Se uma posição já aberta receber novo sinal de `BUY`, o motor de risco só autoriza se `minutesSinceLastBuy >= entryScalingCooldownMinutes`.
- Ranqueamento do scanner prioriza ativos com volatilidade útil (ATR / momentum) para evitar seleção repetida de papéis lateralizados.
- `pnpm test`, `pnpm typecheck` e `pnpm lint` 100% verdes.

