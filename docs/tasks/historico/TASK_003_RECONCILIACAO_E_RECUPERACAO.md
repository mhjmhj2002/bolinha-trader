# TASK_003 — Reconciliação e recuperação após crash/restart

## Contexto

O `bolinha-trader` já possui:

- Binance Spot Testnet;
- PostgreSQL como fonte de verdade conceitual;
- ordens com `clientOrderId`;
- persistência de ordens/trades/posições;
- lock PostgreSQL;
- loop autônomo;
- force-close;
- retomada baseada em horário;
- proteção contra ordem duplicada;
- reconciliação pontual de ordem ambígua dentro da mesma execução.

Agora precisamos endurecer a aplicação para um cenário crítico:

> o processo/container/notebook cai exatamente entre a Binance executar uma ordem e o PostgreSQL registrar completamente essa execução.

O sistema deve conseguir reiniciar sozinho sem:
- comprar duas vezes;
- vender duas vezes;
- ficar eternamente travado por uma ordem `PENDING`;
- acreditar que não há posição quando a Binance já executou BUY;
- acreditar que há posição quando SELL já foi executado;
- finalizar o dia com estado divergente.

Esta task continua SOMENTE em Binance Spot Testnet.

Não habilitar produção.

---

## 1. Reconciliação obrigatória no startup

Antes de o worker executar qualquer novo ciclo de trading, executar:

`reconcileStateOnStartup()`

O worker NÃO pode começar a operar enquanto a reconciliação não terminar.

Fluxo mínimo:

1. carregar conta conceitual;
2. carregar posição conceitual aberta;
3. carregar ordens locais `PENDING`;
4. consultar Binance Testnet para cada ordem pendente usando `clientOrderId`;
5. reconciliar o resultado;
6. verificar consistência final;
7. só então liberar ciclos normais.

Registrar:

- `reconciliation_started`
- `reconciliation_completed`
- `reconciliation_failed`
- `pending_order_reconciled`
- `state_inconsistency_detected`

---

## 2. Ordens PENDING

Hoje uma ordem pode ficar `PENDING` se ocorrer crash no momento errado.

Para cada ordem `PENDING`:

### Caso A — Binance retorna FILLED

Persistir exatamente a execução retornada pela Binance.

Usar o MESMO fluxo contábil normal de:

- order -> FILLED;
- trade;
- position;
- cash;
- P/L;
- eventos.

A reconciliação deve ser idempotente.

Executar duas vezes não pode criar:

- trade duplicado;
- posição duplicada;
- movimentação dupla de caixa.

### Caso B — Binance informa que a ordem não existe

Somente depois de confirmação segura:

- marcar ordem local como `REJECTED` ou estado equivalente;
- registrar motivo de reconciliação.

### Caso C — Binance responde estado ainda aberto/pendente

Não criar nova ordem.

Manter sistema em estado seguro até resolver.

### Caso D — Binance está indisponível

Não operar.

Worker continua:
- heartbeat;
- health;
- retries limitados de reconciliação.

Nenhum novo BUY/SELL enquanto houver estado ambíguo.

---

## 3. Idempotência real da persistência

Revisar `recordExecution()`.

Garantir que uma execução identificada por:

- `binanceOrderId`
ou
- `clientOrderId`

não possa ser aplicada duas vezes.

Adicionar proteção de banco adequada:

- unique constraint quando aplicável;
- verificação transacional;
- operação idempotente.

Exemplo:

ordem foi executada na Binance;
worker persistiu;
processo caiu antes de responder;
startup reconcilia novamente;

Resultado esperado:

`already reconciled`

e nenhuma alteração contábil adicional.

---

## 4. Crash depois do BUY

Criar teste deste cenário:

1. cria ordem BUY local `PENDING`;
2. Binance retorna BUY executado;
3. simular crash ANTES de `recordExecution()`;
4. reiniciar worker;
5. startup encontra PENDING;
6. consulta Binance por `clientOrderId`;
7. encontra FILLED;
8. persiste BUY;
9. cria exatamente UMA posição;
10. desconta caixa exatamente UMA vez.

Depois disso o loop pode continuar normalmente.

---

## 5. Crash depois do SELL

Criar cenário equivalente:

1. existe posição;
2. SELL é executado na Binance;
3. processo cai antes da persistência final;
4. restart;
5. reconciliação identifica SELL executado;
6. fecha posição exatamente uma vez;
7. registra P/L exatamente uma vez;
8. caixa recebe valor exatamente uma vez.

---

## 6. Reconciliação da posição conceitual

A Binance Testnet possui saldos extras fictícios.

NÃO usar o saldo total BTC da Binance como posição da Bolinha.

A fonte conceitual continua sendo PostgreSQL.

Porém:

se existir uma ordem conhecida da Bolinha executada na Binance e ainda não aplicada no PostgreSQL, usar essa ordem para reparar o ledger.

Nunca inferir:

"Binance tem X BTC, então a Bolinha possui X BTC."

Somente ordens identificadas pela aplicação podem alterar a posição conceitual.

---

## 7. Consistência antes de cada ciclo

Antes de enviar uma nova ordem:

confirmar que NÃO existe:

- ordem local PENDING não resolvida;
- reconciliação em andamento;
- inconsistência conhecida.

Se houver:

ação = HOLD operacional.

Não perguntar à IA para "resolver" problemas de infraestrutura.

---

## 8. Health

Adicionar ao `/health`:

- reconciliationStatus:
  - OK
  - RUNNING
  - ERROR

- pendingOrders
- stateConsistent

Exemplo:

{
  "status": "UP",
  "reconciliationStatus": "OK",
  "pendingOrders": 0,
  "stateConsistent": true
}

Se existir estado ambíguo:

`status` pode continuar UP tecnicamente,

mas trading deve estar bloqueado.

---

## 9. Status

Adicionar ao `/status`:

- pendingOrderCount;
- reconciliationStatus;
- lastReconciliationAt;
- lastReconciliationError;
- tradingBlockedReason.

---

## 10. Eventos

Persistir:

- reconciliation_started
- reconciliation_completed
- reconciliation_failed
- pending_order_found
- pending_order_reconciled
- pending_order_not_found
- duplicate_execution_ignored
- trading_blocked_inconsistent_state

Metadata deve ser segura e incluir quando útil:

- clientOrderId;
- binanceOrderId;
- side;
- localOrderId;
- Binance status.

Nunca secrets.

---

## 11. Startup do worker

Sequência obrigatória:

1. conectar banco;
2. ensureAccount;
3. heartbeat;
4. reconciliation_started;
5. reconciliar;
6. reconciliation_completed;
7. somente depois:
   - avaliar horário;
   - entrar no loop.

Se reconciliação falhar:

- worker permanece vivo;
- heartbeat continua;
- health informa ERROR;
- trading permanece bloqueado;
- tentar novamente em intervalo controlado.

Não derrubar/reiniciar container infinitamente por falha temporária da Binance.

---

## 12. Force-close e reconciliação

Force-close também deve respeitar ordens pendentes.

Exemplo:

17:55:
SELL enviado.

17:55:01:
Binance executa.

17:55:02:
worker cai.

18:02:
worker volta.

Esperado:

- reconciliação encontra SELL FILLED;
- persiste fechamento;
- NÃO envia outro SELL;
- posição fica CLOSED;
- daily result pode então ser criado.

---

## 13. Testes obrigatórios

Adicionar testes para:

### BUY
- crash após Binance executar BUY;
- restart reconcilia;
- posição criada uma única vez;
- caixa debitado uma única vez.

### SELL
- crash após Binance executar SELL;
- restart reconcilia;
- posição fechada uma única vez;
- caixa creditado uma única vez;
- P/L aplicado uma única vez.

### duplicidade
- reconciliar mesma FILLED duas vezes;
- segunda execução não altera ledger.

### PENDING
- Binance não conhece order -> rejeitada;
- Binance indisponível -> trading bloqueado;
- Binance retorna ordem ainda aberta -> nenhuma nova ordem.

### force close
- crash após force-close executado na Binance;
- restart depois das 18h;
- reconciliar SELL;
- não duplicar venda;
- finalizar dia corretamente.

---

## 14. Teste manual de recuperação

Criar, se útil, comando de diagnóstico:

`pnpm trading:reconcile`

Deve executar apenas:

- reconciliação;
- imprimir resultado;
- não executar IA;
- não abrir nova posição.

Exemplo:

Reconciliation
Pending local orders: 1
Reconciled: 1
Rejected: 0
Still pending: 0
State consistent: YES

---

## 15. Documentação

Atualizar:

- README;
- docs/ARCHITECTURE.md;
- docs/TRADING_LIFECYCLE.md;
- docs/OBSERVABILITY.md;
- docs/LOCAL_DAY_TEST.md.

Explicar claramente:

PostgreSQL é o ledger conceitual.

Binance é a fonte autoritativa sobre o estado das ordens enviadas.

A reconciliação conecta as duas coisas depois de falhas.

---

## 16. Não fazer nesta task

Não:

- habilitar Binance produção;
- provisionar VPS;
- adicionar Redis;
- adicionar Kafka;
- adicionar Kubernetes;
- criar dashboard frontend;
- mudar estratégia da IA;
- alterar intervalo do trading;
- habilitar loop automaticamente.

Manter:

`TRADING_LOOP_ENABLED=false`

ao finalizar.

---

## 17. Validação final

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build
docker compose up -d --build

Validar:

GET /health
GET /status

Executar:

pnpm trading:reconcile

se o comando for criado.

Confirmar:

- nenhuma ordem PENDING órfã;
- ledger consistente;
- reconciliação OK;
- loop OFF.

---

## 18. Resposta final

Ao terminar, informar somente:

1. alterações implementadas;
2. mecanismo de idempotência adotado;
3. testes adicionados;
4. quantidade total de testes passando;
5. resultado de lint/typecheck/build;
6. resultado da reconciliação local;
7. estado de `/health`;
8. confirmação de que loop continua OFF;
9. qualquer risco ou pendência real encontrada.