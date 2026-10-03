# TASK_010 — Corrigir cálculo de ciclos esperados da sessão

## Contexto

O projeto `bolinha-trader` já possui:

- worker autônomo;
- janela operacional configurável;
- `decisionCycles`;
- `operationalChecks`;
- relatório diário;
- dashboard;
- consolidação de sessão;
- métricas de infraestrutura;
- scheduler sem sobreposição.

No teste autônomo de 03/10/2026 aconteceu o seguinte:

- janela configurada: 09:00 → 18:00;
- loop foi efetivamente ligado apenas por volta de 09:47;
- último decision cycle ocorreu por volta de 17:40;
- relatório mostrou:

  Ciclos esperados: 53
  Decision cycles executados: 49
  Diagnóstico:
  "4 ciclo(s) esperado(s) não foram executados."

Esse diagnóstico é incorreto.

O sistema contou ciclos esperados desde 09:00, mesmo que o worker/loop só tenha começado efetivamente às 09:47.

## Objetivo

Corrigir o cálculo de `expectedDecisionCycles` para considerar o início real da execução da sessão.

Não alterar o comportamento do scheduler.
Não alterar estratégia.
Não alterar intervalo.
Não habilitar Binance produção.

## 1. Início efetivo da execução

O cálculo dos ciclos esperados deve usar:

effectiveStart = max(
  configuredSessionStart,
  actualTradingStart
)

Onde `actualTradingStart` representa o momento real em que o loop começou a executar decision cycles naquela sessão.

Pode usar, nesta ordem de preferência:

1. `trading_sessions.started_at`, se ele representar corretamente o início real do loop;
2. primeiro `cycle_started` válido da sessão;
3. primeiro decision cycle persistido;
4. outro marcador persistido equivalente e confiável.

Não usar apenas o horário configurado da sessão.

## 2. Final efetivo

Para sessão concluída:

effectiveEnd = min(
  stopNewPositionsTime,
  finishedAt
)

Os decision cycles esperados devem existir somente durante a janela em que decisões normais BUY/SELL/HOLD podem ocorrer.

Não incluir:

- NO_NEW_POSITIONS;
- FORCE_CLOSE;
- FORCE_CLOSE_PENDING;
- FINISHED;
- retries operacionais;
- reconciliation;
- heartbeat.

## 3. Fórmula

Com intervalo de 600 segundos:

Se:

effectiveStart = 09:47
stopNewPositions = 17:50

o número esperado deve refletir apenas os slots possíveis a partir de 09:47.

Considerar corretamente:

- primeiro ciclo imediato no startup;
- ciclos subsequentes pelo scheduler;
- alinhamento do scheduler, se ele trabalha em horários fixos;
- não gerar off-by-one.

A fórmula deve refletir o comportamento REAL do scheduler atual.

Não criar uma fórmula teórica que diverge da implementação.

## 4. Scheduler alinhado

Se o scheduler atual executa:

09:47 primeiro ciclo imediato
09:50
10:00
10:10
...
17:40

o relatório deve considerar exatamente esses slots.

Se o comportamento real for outro, documentar e calcular de acordo com ele.

## 5. Persistência

Se necessário, persistir explicitamente em `trading_sessions`:

- loop_started_at
ou
- first_decision_cycle_at

Preferir dado persistido a inferência de logs.

Não depender de stdout.

## 6. Restart durante sessão

Se worker reiniciar durante a sessão:

- NÃO resetar o início esperado;
- continuar considerando o início real original da sessão;
- ciclos perdidos durante downtime devem aparecer como realmente perdidos.

Exemplo:

09:00 começa normalmente.
12:00 worker cai.
12:30 volta.

Os ciclos entre 12:00 e 12:30 devem ser contabilizados como esperados e não executados.

Ou seja:

o início real só serve para corrigir atraso inicial antes do loop começar.

Restart posterior não pode apagar gaps.

## 7. Loop ligado depois do horário configurado

Exemplo:

Sessão:
09:00 → 18:00

Loop ligado:
14:00

ExpectedDecisionCycles deve considerar 14:00 em diante.

Não acusar como perdidos os ciclos 09:00–13:59.

## 8. Loop desligado e religado

Se o loop for desligado manualmente no meio da sessão e religado depois:

não esconder o intervalo.

Os ciclos desse período devem ser considerados não executados, porque a sessão já havia começado efetivamente.

Distinguir:

- atraso inicial antes da primeira ativação;
- interrupção após início real.

## 9. Relatório

Atualizar:

`pnpm trading:report:today`

Exibir:

Infraestrutura
- Início configurado
- Início efetivo
- Decision cycles esperados
- Decision cycles executados
- Decision cycles perdidos

Exemplo:

Início configurado: 09:00
Início efetivo: 09:47
Decision cycles esperados: 49
Decision cycles executados: 49
Decision cycles perdidos: 0

Não gerar WARN quando diferença for zero.

## 10. Dashboard

Se o dashboard exibe ciclos esperados/perdidos, usar a mesma lógica centralizada.

Não duplicar fórmula no frontend.

Criar cálculo em domínio/service compartilhado e apenas expor o resultado pela API.

## 11. Testes obrigatórios

Adicionar testes para:

### Caso 1
Config:
09:00 start
17:50 stop buy
600s

Loop inicia 09:00.

Expected = comportamento normal completo.

### Caso 2
Loop inicia 09:47.

Expected deve começar em 09:47.

Não contar 09:00–09:46 como perdido.

### Caso 3
Loop inicia 14:00.

Não contar manhã como ciclo perdido.

### Caso 4
Loop inicia 09:00, worker cai 12:00–12:30.

Ciclos desse intervalo devem aparecer como perdidos.

### Caso 5
Loop inicia 09:00, é desligado 15:00 e religado 16:00.

Intervalo deve continuar contando como esperado/perdido.

### Caso 6
Sessão começa depois de stopNewPositionsTime.

ExpectedDecisionCycles = 0.

### Caso 7
Sessão parcial ainda em andamento.

Calcular expected apenas até o horário atual, não até o fim futuro da sessão.

### Caso 8
Sessão finalizada.

Calcular até stopNewPositionsTime ou finishedAt, conforme o que ocorrer primeiro.

## 12. Fonte única de cálculo

Criar uma função/service clara, por exemplo:

calculateExpectedDecisionCycles(...)

ou equivalente.

Usar a mesma função em:

- relatório CLI;
- API;
- dashboard;
- diagnósticos.

Evitar implementações diferentes em cada camada.

## 13. Diagnóstico

A regra:

"X ciclos esperados não foram executados"

só deve aparecer quando:

expectedDecisionCycles > executedDecisionCycles

usando a nova lógica.

Se:

expected = executed

resultado:
sem warning.

## 14. Não fazer

Não:
- alterar scheduler;
- mudar intervalo padrão;
- alterar horários;
- mexer em estratégia;
- mexer em OpenRouter;
- habilitar produção;
- ligar loop automaticamente.

## 15. Validação

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build

Todos devem ficar verdes.

## 16. Validação com evidência real

Usar a sessão real de 03/10/2026 já persistida.

Esperado:

- não considerar 09:00–09:46 como ciclos perdidos;
- recalcular expectedDecisionCycles conforme início real;
- remover falso alerta de 4 ciclos perdidos, se a evidência confirmar que todos os ciclos possíveis foram executados.

Não apagar nem alterar evidência histórica para forçar o resultado.

## 17. Entrega

Informar:

1. regra final de cálculo;
2. dado usado como início efetivo;
3. tratamento de restart;
4. tratamento de loop ligado tarde;
5. resultado para a sessão real de 03/10/2026;
6. expectedDecisionCycles antes/depois;
7. testes adicionados;
8. total de testes passando;
9. lint/typecheck/build.
