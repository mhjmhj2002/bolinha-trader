# BUG-02: Reconciliação Contínua e Tratamento Robusto de Falha de Rede na Submissão de Ordens

## 1. Contexto e Descrição do Problema
O ciclo de trading do worker travou novamente com o erro:
`cycle_skipped: 1 pending order(s) require reconciliation`

### Causa Raiz:
1. No `BUG-01`, a tratativa de rejeição imediata da ordem só marcava como `REJECTED` se a mensagem contivesse `HTTP 400`.
2. Em caso de falha de rede/transporte (`fetch failed`, timeout de socket, etc.), o erro lançado não é HTTP 400.
3. Se a consulta posterior na Binance via `orderByClientId` retornar `null` (confirmando que a Binance nunca recebeu nem executou a ordem), o código anterior não marcava a ordem como `REJECTED`, deixando-a como `PENDING` indefinidamente no banco de dados.
4. Além disso, o worker só executa reconciliação de inicialização (`reconcileStateOnStartup`) uma única vez no boot. Durante o loop operacional regular (`tick()`), se houver ordens pendentes (`pendingOrderCount > 0`), o método `tradingReady()` retorna `ready: false`, fazendo com que o worker apenas emita logs de `cycle_skipped` eternamente sem jamais tentar reconciliar as ordens pendentes com a Binance para se auto-recuperar.

## 2. Objetivos e Requisitos da Correção
1. **Confirmação Definitiva de Ausência na Binance**:
   - Em `submitAndPersistOrder`, se a submissão falhar (por qualquer motivo: erro HTTP, `fetch failed`, etc.) e `orderByClientId(clientOrderId)` retornar `null` (ou seja, a Binance confirmou que a ordem não existe), a ordem DEVE ser imediatamente marcada como `REJECTED` no banco de dados com a devida justificativa, impedindo que vire uma ordem fantasma pendente.
   - Fail-closed: se `orderByClientId` lançar erro de rede durante o catch (isto é, não foi possível confirmar nem que existe nem que não existe), a ordem permanece `PENDING` por segurança.
2. **Auto-recuperação Contínua no Ciclo Operacional**:
   - Se o worker encontrar ordens pendentes durante o ciclo operacional (`runOnceLocked` / `tick`), ele não deve apenas desistir e pular o ciclo passivamente para sempre. Ele deve disparar uma tentativa ativa de reconciliação de ordens pendentes (`reconcilePendingOrders()`).
   - Se a reconciliação com a Binance constatar que a ordem foi executada ou que ela não existe na exchange, atualiza o status correspondente e libera o bot para o ciclo seguinte sem necessidade de intervenção manual humana ou reinício de container.
3. **Testes Automatizados**:
   - Cobertura com testes unitários em `tests/trading-service.test.ts` e/ou `tests/reconciliation.test.ts`.
