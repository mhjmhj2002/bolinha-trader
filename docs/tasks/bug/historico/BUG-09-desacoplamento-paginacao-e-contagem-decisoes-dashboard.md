# BUG-09: Desacoplamento da Paginação de Decisões e Correção do Cálculo Total de DecisionCounts no Dashboard

## Status: to-do
**Data de Criação:** 2026-10-19  
**Prioridade:** Alta  
**Origem:** Auditoria Operacional de Execução Contínua B3 ([`RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md))  
**Pacotes Afetados:** `@bolinha/database`, `apps/api`

---

## 1. Contexto e Problema Observado

No backend da API ([`DatabaseRepository.dashboardData`](file:///home/mhj/git/bolinha-trader/packages/database/src/index.ts#L949-L990)), a consulta das decisões de IA utiliza uma limitação de 100 linhas:

```typescript
const [..., decisionsResult, ...] = await Promise.all([
  ...
  this.client.query<Row>(
    `select timestamp,model_returned,model_requested,action_requested,action_after_risk,amount_requested,amount_after_risk,confidence,reason,rejection_reason
     from ai_decisions where to_char(timestamp at time zone $2,'YYYY-MM-DD')=$1 order by timestamp desc limit 100`, localDay),
  ...
]);

const decisions = decisionsResult.rows.map(...);
const decisionCounts = { BUY: 0, SELL: 0, HOLD: 0, rejectedByRisk: 0 };
for (const decision of decisions) {
  const action = String(decision.actionAfterRisk) as 'BUY' | 'SELL' | 'HOLD';
  if (action in decisionCounts) decisionCounts[action]++;
  if (decision.actionRequested !== decision.actionAfterRisk) decisionCounts.rejectedByRisk++;
}
```

### Mecanismo da Falha:
1. No pregão da B3, o ciclo opera a cada 180s (3 minutos) entre 09:00 e 18:00, gerando até 180 decisões por dia.
2. Quando a quantidade de ciclos no dia ultrapassa 100, a query com `limit 100` descarta as decisões mais antigas do dia (que ocorreram na parte da manhã).
3. O cálculo do objeto `decisionCounts` (BUY, SELL, HOLD, rejectedByRisk) é feito em memória iterando apenas sobre as 100 linhas retornadas.
4. Como as decisões de `BUY` e `SELL` ocorreram logo pela manhã (às 09:24 e 09:33) e as 100 decisões subsequentes foram `HOLD`, o objeto resultante enviado ao frontend foi:
   ```json
   {
     "BUY": 0,
     "SELL": 0,
     "HOLD": 100,
     "rejectedByRisk": 0
   }
   ```

### Impacto:
- O painel exibe **0 BUY** e **0 SELL** no card e no gráfico de pizza de decisões do dia, mesmo havendo operações registradas e exibidas na tabela de trades (2 trades preenchidos).
- Cria uma inconsistência evidente de dados na tela do operador, ocultando ações tomadas pela IA.

---

## 2. Requisitos de Implementação

1. **Separação entre Decisões Paginas/Amostradas e Métricas Agregadas do Dia:**
   - Realizar a contagem total de decisões agregada diretamente no banco de dados para todo o dia selecionado, sem ser afetada pelo `LIMIT 100`:
     ```sql
     SELECT 
       action_after_risk,
       count(*)::int as count,
       count(*) FILTER (WHERE action_requested <> action_after_risk)::int as rejected_by_risk
     FROM ai_decisions
     WHERE to_char(timestamp AT TIME ZONE $2, 'YYYY-MM-DD') = $1
     GROUP BY action_after_risk;
     ```
   - Preencher `decisionCounts` com base no resultado agregado do dia completo.
2. **Preservação da Performance da Tabela de Decisões:**
   - A tabela visual de decisões (`payload.decisions`) continua limitada a 100 registros recentes para não sobrecarregar o tráfego HTTP nem renderizar milhares de nós no DOM.

---

## 3. Critérios de Aceite

- [ ] Em um dia com mais de 100 decisões onde BUY e SELL ocorreram nas primeiras posições, `payload.decisionCounts` reporta com exatidão a quantidade real de BUYs, SELLs e HOLDs do dia todo.
- [ ] O total de `rejectedByRisk` considera todas as decisões do dia.
- [ ] Testes unitários atualizados em `tests/dashboard-data.test.ts` cobrindo cenários com > 100 decisões.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
