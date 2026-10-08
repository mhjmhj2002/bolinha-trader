# BUG-01: Rejeição de Ordem Binance Testnet (HTTP 400 -1021 recvWindow) e Bloqueio de Ciclos

- **Status**: TO-DO
- **Data da Ocorrência**: 2026-10-07 15:06 UTC (12:06 BRT)
- **Severidade**: ALTA (Interrompe execução de novos ciclos por trava de reconciliação de segurança fail-closed)
- **Pacotes Envolvidos**: `@bolinha/exchange`, `@bolinha/worker`, `@bolinha/database`

---

## 1. Descrição do Problema (O que aconteceu?)

Durante a operação automática do worker em 07/10/2026:
1. Às **15:03:16 UTC**, o worker executou com sucesso uma ordem de **BUY** de `0.00024 BTC` na Binance Testnet (Ordem #84749, Posição #7 criada).
2. No ciclo seguinte, às **15:06:08 UTC**, a IA decidiu **SELL** para encerrar/realizar a posição.
3. O worker registrou a intenção da ordem localmente no PostgreSQL com status `PENDING` (`orders.id = 17`, `clientOrderId = 725bde5f-2327-4ade-a0d5-ce0dbaf93023`).
4. Ao submeter a ordem a mercado via API assinada da Binance Testnet, a chamada falhou com:
   ```text
   Binance Testnet HTTP 400 (-1021): Timestamp for this request is outside of the recvWindow.
   ```
5. O worker capturou a falha e tentou consultar a ordem pelo `clientOrderId` para ver se havia sido executada. Como a ordem foi rejeitada na borda antes de entrar no livro da Binance, `orderByClientId` retornou `null`.
6. O worker lançou exceção e a ordem permaneceu no banco local como `PENDING`.
7. Nos ciclos seguintes, o mecanismo de segurança fail-closed (`tradingReady` em `apps/worker/src/service.ts`) detectou `1 pending order(s) require reconciliation` e bloqueou com razão todos os ciclos subsequentes (`cycle_skipped`), logando repetidamente sem gastar IA.

---

## 2. Causa Raiz

1. **Janela de `recvWindow` muito estreita e sem sincronização de relógio**:
   - Em [`packages/exchange/src/index.ts`](file:///home/mhj/git/bolinha-trader/packages/exchange/src/index.ts#L55-L56), o parâmetro `timestamp` usa `Date.now()` local e `recvWindow` está fixado em `5000` (5 segundos):
     ```typescript
     params.set('timestamp', String(Date.now()));
     params.set('recvWindow', '5000');
     ```
   - Pequenas variações de latência de rede ou desvio de relógio (clock drift) entre a máquina local/container e os servidores da Binance fazem com que a requisição chegue com timestamp fora do intervalo `[serverTime - recvWindow, serverTime + 1000]`.
   - A Binance permite `recvWindow` de até `60000` (60 segundos). Além disso, pode-se calcular e armazenar o offset entre o relógio local e o servidor da Binance (`/api/v3/time`).

2. **Reconciliação de Ordem Rejeitada pela Binance**:
   - Quando o erro HTTP 400 (-1021 ou outro erro de validação da Binance) ocorre na submissão, a Binance **nunca processou a ordem**.
   - No entanto, o fluxo manteve a ordem como `PENDING` indefinidamente sem que o ciclo regular a marque como `REJECTED`, travando a operação até que haja uma intervenção manual ou startup reconciliation.
   - Posição `#7` (`0.00024 BTC`) continua `OPEN` no banco de dados enquanto a ordem `17` de venda ficou travada como `PENDING`.

---

## 3. Especificação da Demanda para o Agente

### Objetivo
1. Tornar o cliente da Binance Testnet resiliente a desvios de relógio e latência de rede.
2. Tratar a reconciliação e destravamento automático quando uma ordem é rejeitada na submissão com erro definitivo da Binance.
3. Resolver o estado pendente atual no banco de dados (ordem `id = 17` e posição `id = 7`).

### Requisitos Técnicos:
1. **Ajuste em `@bolinha/exchange` (`packages/exchange/src/index.ts`)**:
   - Aumentar o `recvWindow` padrão para `60000` (ou torná-lo configurável via `config.BINANCE_RECV_WINDOW_MS`, com fallback seguro para `60000`).
   - Implementar cálculo de sincronização de relógio (`timeOffset`):
     - Na inicialização (ou antes de chamadas assinadas se necessário), consultar `/api/v3/time`.
     - Calcular `timeOffset = binanceServerTime - Date.now()`.
     - Utilizar `Date.now() + timeOffset` ao assinar parâmetros.
     - Se ocorrer erro `-1021`, invalidar o offset, sincronizar novamente e tentar uma vez (retry seguro).
2. **Tratamento de Ordens Pendentes no `@bolinha/worker`**:
   - Garantir que a rotina de reconciliação (`reconcileStateOnStartup` ou `submitAndPersistOrder`) identifique ordens com erro 400 da Binance onde a ordem comprovadamente não existe, marcando-as como `REJECTED` com justificativa clara (`reconciliation_reason`).
   - Se a ordem de venda for rejeitada, a posição deve permanecer aberta para que o próximo ciclo normal possa tentar vendê-la novamente com segurança.
3. **Limpeza do Estado Atual**:
   - Ordem `id: 17`: Atualizar status para `REJECTED` com `reconciliation_reason = 'Binance Testnet HTTP 400 (-1021) timestamp outside recvWindow; order never registered'`.
   - Garantir que a posição `id: 7` possa ser tratada pelo ciclo de fechamento ou novo ciclo de trading.
4. **Testes Unitários**:
   - Adicionar testes em `tests/` ou nos pacotes respectivos cobrindo:
     - Assinatura com `timeOffset` e `recvWindow`.
     - Tratamento e reconciliação de ordem rejeitada na submissão.
   - Garantir que `pnpm test` e `pnpm typecheck` passem 100%.

---

## 4. Checklist de Conclusão para o Agente

- [ ] `packages/exchange/src/index.ts` atualizado com sincronização de tempo e `recvWindow` seguro.
- [ ] Tratamento de reconciliação de ordens que falharam na submissão validado.
- [ ] Ordem `id: 17` resolvida no banco de dados.
- [ ] Testes unitários implementados e passando (`pnpm test`).
- [ ] Typecheck e linter passando (`pnpm typecheck`, `pnpm lint`).
- [ ] Status atualizado em `docs/tasks/ANDAMENTO.md`.
