# BUG-13: Erro de Tipagem SQL na Reconciliação e Fechamento de Posições (`operator does not exist: timestamp with time zone >= interval`)

## Contexto e Descoberta
Durante o teste em pregão do dia 03/11/2026, às 10:09:00:
1. Uma posição em `PETR4` atingiu o critério de **Time-Stop** (48 minutos aberta sem evolução favorável e PnL líquido de -0.30%).
2. O motor de risco disparou a ordem a mercado de `SELL` para fechar a posição.
3. A ordem de `SELL` foi enviada e executada na B3 (paper broker).
4. Ao persistir a execução no banco de dados via `TradingRepository.recordExecution()`, o PostgreSQL lançou o erro fatal:
   `DatabaseError: operator does not exist: timestamp with time zone >= interval (code 42883)`.
5. Como a transação falhou, a ordem de venda ficou em estado `PENDING` no banco e a posição permaneceu aberta no ledger.
6. A partir desse momento (10:09 em diante até o fim do pregão), a reconciliação periódica a cada ciclo (3 minutos) tentava reconciliar a ordem pendente e reexecutar a query de fechamento, caindo repetidamente no mesmo erro SQL e bloqueando todo o ciclo operacional com `Trading cycle blocked pending reconciliation`.

## Causa Raiz
No arquivo `packages/database/src/index.ts` (linhas 612-620):
```sql
select coalesce(
  (select payload->>'reason' from system_events where created_at >= $1 - interval '5 seconds' and created_at <= $1 + interval '5 seconds' and event in ('decision_rejected_by_risk', 'realtime_risk_exit_triggered') order by id desc limit 1),
  (select 'Forced close at end of session' from system_events where created_at >= $1 - interval '5 seconds' and created_at <= $1 + interval '5 seconds' and event = 'force_close_completed' order by id desc limit 1),
  (select 'AI discretionary SELL decision' from system_events where created_at >= $1 - interval '5 seconds' and created_at <= $1 + interval '5 seconds' and event = 'decision_created' and payload->>'requestedAction' = 'SELL' order by id desc limit 1),
  'Market exit'
) as reason
```
No PostgreSQL, quando o driver `pg` envia o parâmetro `$1` (um objeto JavaScript `Date`), a consulta pode ser inferida de forma ambígua sem cast explícito, fazendo com que `$1 - interval '5 seconds'` gere ambiguidade de operador no parser SQL (`timestamp with time zone >= interval`). O PostgreSQL exige expressamente type cast explícito `$1::timestamptz - interval '5 seconds'` e `$1::timestamptz + interval '5 seconds'`.

## Plano de Correção
1. Ajustar a query em `packages/database/src/index.ts` adicionando `$1::timestamptz` em todas as ocorrências de adição/subtração de interval.
2. Adicionar teste unitário de repositório / query para garantir que `recordExecution` com `fullClose` execute sem falha de sintaxe SQL com datas parametrizadas.
3. Recompilar e rodar a suíte de testes (`pnpm test` e `pnpm typecheck`).
4. Mover este bug para o histórico e atualizar `ANDAMENTO.md`.
