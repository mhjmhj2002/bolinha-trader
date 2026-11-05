# TASK-39: Métricas Corretas em `daily_results` e Relatório de Expectativa Pós-Pregão

## Status: `doing`

---

## 1. Contexto e Motivação
A sessão de 30/10 foi consolidada com sucesso (`consolidation_status=OK`, `forced_close_occurred=t`), mas a análise do registro em `daily_results` revelou métricas incorretas ou insuficientes:
- `gross_return_pct = -3.0143` é igual ao retorno **líquido**. O bruto real seria `gross_pnl_usdt / initial_equity` (-2,80%).
- `ai_call_count = 154` é igual a `decision_cycles`; ele inclui os ciclos resolvidos por `deterministic_robots` (sem IA). O real foi ~31 chamadas (`model_returned <> 'deterministic_robots'`).
- Não existem métricas de expectativa: win rate (4/8), ganho médio (~R$ 0,50) vs perda média (~R$ 1,25), profit factor, peso das taxas (R$ 0,43 de R$ 2,80 bruto negativo), MAE/MFE.
- `buy_count`/`sell_count` contam ordens (inclui parciais), sem distinguir posições.

## 2. Requisitos Técnicos
1. Corrigir `gross_return_pct` (bruto) e adicionar `net_return_pct`.
2. Separar `ai_call_count` (chamadas reais a modelos) de `bypass_count` (ciclos determinísticos).
3. Adicionar a `daily_results` (migração em `@bolinha/database`): `position_count`, `win_count`, `loss_count`, `avg_win_usdt`, `avg_loss_usdt`, `profit_factor`, `expectancy_usdt`, `fees_pct_of_gross`.
4. Registrar por posição: MAE, MFE, duração e motivo de saída (stop, trailing, take profit, parcial, force close, IA).
5. Exibir os novos indicadores no dashboard e nos logs de consolidação.
6. Testes em `@bolinha/database` e `@bolinha/worker` (consolidação).

## 3. Critérios de Aceite
- Os valores de 30/10 recalculados batem com os dados reais (win rate 50%, profit factor < 1).
- Fail-closed: a consolidação nunca bloqueia o encerramento da sessão por erro de métrica.
- `pnl` e `gross` permanecem conciliados com `positions` e `trade_fees`.
- `pnpm test`, `pnpm typecheck` e `pnpm lint` verdes.
