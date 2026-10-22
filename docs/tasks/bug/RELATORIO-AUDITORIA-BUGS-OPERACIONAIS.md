# Relatório de Diagnóstico e Auditoria Operacional: Análise de Bugs em Execução

**Data:** 19/10/2026  
**Ambiente:** Bolinha Trader (B3 Day Trade Paper Trading)  
**Status do Projeto:** Ativo e em execução (Containers API, Worker e Postgres operando ininterruptamente)  
**Solicitação:** Não parar o projeto, analisar se há bug e gerar relatório detalhado.

---

## 1. Resumo Executivo

O projeto **continua em execução ativa**, operando com os containers Docker saudáveis (`bolinha-trader-api-1`, `bolinha-trader-worker-1` e `bolinha-trader-postgres-1`).
A auditoria cruzou as tabelas do banco de dados PostgreSQL (`orders`, `trades`, `positions`, `market_snapshots`, `ai_decisions`, `ai_usage`, `system_events`), os logs dos containers em tempo real e as chamadas da API REST (`/dashboard/data`).

Foram identificados **dois bugs principais**:
1. **BUG-A (Arquitetural / Simulador): Série de Candles Sintéticos Estática / Congelada no Tempo**
   - No `B3MarketDataService`, a série inicial de 1500 candles de 1 minuto é gerada na primeira requisição e armazenada em memória cache (`candlesStore`).
   - Nos ciclos subsequentes (executados a cada 3 minutos), o código verifica apenas se `series1m.length < required1mCount`. Como o tamanho já é 1500, **ele não anexa novas velas de 1m conforme o tempo avança**!
   - **Consequência:** Todos os 128 ciclos do dia de hoje (19/10) receberam exatamente o mesmo snapshot congelado com preço cravado em **R$ 29,88**, RSI em **34,48** e volume em **2.081**, deixando a IA em um loop estático contínuo de HOLD sem nenhuma volatilidade de mercado após as primeiras operações da manhã.
2. **BUG-B (Interface / Dashboard Data): Truncamento de `decisionCounts` por `LIMIT 100`**
   - Na query SQL de decisões em `DatabaseRepository.dashboardData(day)`, foi adicionada a cláusula `limit 100`.
   - O objeto `decisionCounts` (BUY, SELL, HOLD) exibido no Dashboard e no gráfico de pizza é calculado iterando sobre as decisões retornadas por essa query com limite.
   - **Consequência:** Como hoje já ocorreram mais de 128 ciclos e os últimos 100 foram todos `HOLD`, a contagem do dia no dashboard exibe **BUY: 0, SELL: 0, HOLD: 100**, apagando visualmente o `BUY` e o `SELL` que de fato ocorreram no dia (às 09:24 e 09:33), gerando divergência evidente entre a tabela de Trades (que mostra 2 trades) e o gráfico/contador de Decisões (que mostra 0 BUY e 0 SELL).

---

## 2. Auditoria Detalhada dos Componentes

### 2.1 Posições, Ordens e Trades Executados Hoje (19/10/2026)

- **Trades realizados:** 2 (uma compra e uma venda completas, fechando a Posição #1):
  - **Trade #1 (BUY):** Executado às 09:24:02 (12:24:02 UTC). Compra de 1 ação de `PETR4` a R$ 29,89 (preço cotação R$ 29,88 + slippage simulado + R$ 0,009 de taxa).
  - **Trade #2 (SELL):** Executado às 09:33:03 (12:33:03 UTC). Venda de 1 ação de `PETR4` a R$ 29,87 (preço cotação R$ 29,88 - slippage simulado - R$ 0,009 de taxa).
- **Resultado Financeiro da Operação:**
  - PnL Bruto: -R$ 0,029
  - Taxas B3: R$ 0,018 (R$ 0,009 na compra + R$ 0,009 na venda)
  - PnL Líquido Realizado: **-R$ 0,038**
  - Caixa final: R$ 99,962 (banca inicial de R$ 100,00)
- **Status do Bug Anterior (BUG-04):**
  - O antigo bug de preço fixo em R$ 30,00/30,02 do relatório anterior de 15/10 foi corrigido (o preço executou sincronizado com a cotação em R$ 29,88). Não houve gap de execução na ordem.

---

### 2.2 Diagnóstico do BUG-A: Gerador de Candles Congelado no Tempo

#### Causa Raiz:
No arquivo [`packages/exchange/src/b3/market-data.ts`](file:///home/mhj/git/bolinha-trader/packages/exchange/src/b3/market-data.ts):
```typescript
const existingSeries = this.candlesStore.get(symbol) ?? { '1m': [], '5m': [], '15m': [] };
const now = Date.now();
const required1mCount = Math.max(limit * 15, 1500);

let series1m = existingSeries['1m'];
if (series1m.length < required1mCount) {
  series1m = this.generateSynthetic1m(symbol, required1mCount, now);
  existingSeries['1m'] = series1m;
  this.candlesStore.set(symbol, existingSeries);
}

const last1mClose = series1m[series1m.length - 1].close;
```

1. Quando o container inicia, `series1m` está vazia. O gerador cria 1500 candles terminando no timestamp do início do dia (09:00 / 12:00 UTC).
2. O último candle da série fecha em **R$ 29,88**, com volume 2081 e RSI 34,48.
3. A cada novo ciclo de 3 minutos (180 segundos), `series1m.length` já é 1500. A condição `if (series1m.length < required1mCount)` é **falsa**.
4. Não há nenhuma rotina que gere os novos candles correspondentes aos minutos transcorridos entre o último candle gerado e o horário atual (`now`), nem um `shift()` dos candles antigos.
5. Em consequência, do ciclo 1 até o ciclo 128, o método `candles()` devolve exatamente os mesmos 100 candles gerados há 6 horas atrás.
6. A IA continua sendo consultada a cada 3 minutos via OpenRouter, gastando tokens (já custou $ 0,1086 USD hoje), recebendo sempre o mesmo snapshot estático idêntico, respondendo invariavelmente `HOLD`.

---

### 2.3 Diagnóstico do BUG-B: Inconsistência de Métricas no Dashboard

#### Causa Raiz:
No arquivo [`packages/database/src/index.ts`](file:///home/mhj/git/bolinha-trader/packages/database/src/index.ts#L949-L990):
```typescript
// Query com limite fixo de 100
select timestamp,model_returned,model_requested,action_requested,action_after_risk,
       amount_requested,amount_after_risk,confidence,reason,rejection_reason
from ai_decisions where to_char(timestamp at time zone $2,'YYYY-MM-DD')=$1
order by timestamp desc limit 100;

// O cálculo de decisionCounts itera sobre a lista 'decisions', que só tem 100 elementos!
const decisionCounts = { BUY: 0, SELL: 0, HOLD: 0, rejectedByRisk: 0 };
for (const decision of decisions) {
  const action = String(decision.actionAfterRisk) as 'BUY' | 'SELL' | 'HOLD';
  if (action in decisionCounts) decisionCounts[action]++;
}
```

1. Quando o dia ultrapassa 100 ciclos (cada sessão B3 com ciclo de 3 min tem até 180 ciclos por dia), as decisões das primeiras horas do pregão deixam de figurar no `LIMIT 100`.
2. Como as compras e vendas ocorreram no início da manhã, elas caíram fora dos 100 registros mais recentes.
3. O dashboard exibe:
   - Trades: 2 operações (compra e venda visíveis).
   - Decisões de IA no gráfico de pizza: 0 BUY, 0 SELL, 100 HOLD.
4. **Impacto:** O usuário ou operador que observa o dashboard tem a impressão falsa de que a IA nunca tomou decisão de BUY/SELL ou que o sistema perdeu as decisões.

---

### 2.4 Eventos e Observabilidade de Falhas (Logs e Fallback)

- **Erros no Worker:** 0 erros fatais (reconciliação saudável, loop operando normalmente).
- **Erros na API:** 0 requisições com código 5xx (todas 200 OK).
- **Incidentes de Rede / OpenRouter:**
  - Às 10:06:15 (13:06:15 UTC), o primeiro modelo configurado (`google/gemini-2.5-flash`) respondeu temporariamente com **HTTP 404** no OpenRouter.
  - O mecanismo de tolerância e rotação de modelos (**TASK-12**) funcionou com perfeição: realizou fallback transparente para `deepseek/deepseek-chat` sem interromper o ciclo nem gerar crash.
  - Nos ciclos posteriores, o modelo primário voltou a operar normalmente.

---

## 3. Plano de Ação Recomendado (Próximos Passos)

Para solucionar de forma definitiva sem interromper a execução:

1. **Correção do BUG-A (Gerador de Candles Sintéticos Dinâmico / Contínuo)**:
   - Em `B3MarketDataService.candles()`, verificar o timestamp do último candle armazenado (`lastCandle.closeTime`).
   - Se `now > lastCandle.closeTime + 60_000`, calcular quantos minutos passaram e gerar incrementalmente os novos candles de 1m a partir do preço do último fechamento, adicionando-os ao final da série e descartando os mais antigos para manter o tamanho fixo (janela deslizante).
   - Dessa forma, o mercado simulado terá volatilidade real e contínua durante todo o pregão.

2. **Correção do BUG-B (Cálculo Agregado de `decisionCounts` em SQL)**:
   - Em `DatabaseRepository.dashboardData()`, separar a consulta da tabela paginada/limitada (para exibição visual dos últimos 100 itens) da contagem total agregada por ação do dia:
     ```sql
     SELECT action_after_risk, count(*)::int
     FROM ai_decisions
     WHERE to_char(timestamp AT TIME ZONE $2, 'YYYY-MM-DD') = $1
     GROUP BY action_after_risk;
     ```
   - Isso garante que a contagem reflita com fidelidade 100% de todas as decisões do dia, mesmo com mais de 100 ciclos.
