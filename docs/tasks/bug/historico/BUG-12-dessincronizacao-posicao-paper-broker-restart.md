# BUG-12 - Dessincronização de Posição no B3PaperBroker após Reinício de Contêiner

## Contexto e Sintoma
Durante execuções de testes em ambiente de deploy (`run-all.sh` ou reinicialização do contêiner `worker`), ao existir uma posição aberta previamente no banco de dados PostgreSQL, os ciclos de venda subsequentes (por Take Profit parcial/total, Stop Loss ou recomendação dos robôs) falhavam repetidamente a cada ciclo operacional de 180s com o erro:

```text
ERROR external_service_error: "Insufficient position to sell: required 2, have 0" (ou "required 3, have 0")
at B3PaperBroker.placeMarketOrder (paper-broker.ts:132:15)
at TradingService.submitAndPersistOrder (service.ts:287:17)
```

## Causa Raiz
1. O `B3PaperBroker` mantinha o seu estado de posição (`currentPosition`) apenas na memória volátil do processo Node.js.
2. Ao reiniciar o contêiner do `worker`, o broker iniciava com `currentPosition = null` (quantidade zero).
3. Embora o `reconcileStateOnStartup` e `reconcileOperationalState` verificassem as ordens pendentes e a consistência do banco de dados, eles **não sincronizavam a posição aberta ativa do PostgreSQL com a instância do broker**.
4. Quando uma ordem de venda parcial ou total era submetida pelo `TradingService`, o `B3PaperBroker.placeMarketOrder` realizava a validação `this.currentPosition.quantity < quantity`, lançando exceção por falta de posição em memória.
5. A imagem Docker anterior em execução não possuía o método e a chamada de sincronização atualizados.

## Correção Implementada
1. **No pacote `@bolinha/exchange`**:
   - Adicionado o método `syncPosition(position)` em `B3PaperBroker`:
     - Se receber uma posição com quantidade > 0, atualiza `currentPosition` com `ticker`, `quantity`, `entryPrice` e `costBrl`, além de ajustar o ticker ativo.
     - Se receber `null` ou quantidade <= 0, reseta `currentPosition = null`.
   - Incluído o método opcional `syncPosition?(...)` na interface `BrokerGateway`.
2. **No serviço `TradingService` (`@bolinha/worker`)**:
   - Dentro de `reconcileStateLocked`, logo após a validação de consistência contábil (`stateConsistency`), adicionada a chamada de sincronização:
     - Consulta `this.repo.openPosition()`.
     - Invoca `this.exchange.syncPosition(...)` passando os dados da posição aberta ativa ou `null` caso não haja posição.
     - Atualiza o ticker no broker via `this.exchange.setTicker(ticker)`.
3. **Na imagem do contêiner Docker**:
   - Recompilada a imagem `bolinha-trader-worker` via `docker compose build worker` e recriado o contêiner com `docker compose up -d worker`.
4. **Testes Unitários**:
   - Adicionado teste específico em `tests/trading-service.test.ts` verificando que `reconcileStateOnStartup` sincroniza perfeitamente a posição aberta e o ticker com o gateway da exchange.
   - Suíte de testes (`pnpm test`) executada com 100% de aprovação (25 arquivos, 275 testes passando).

## Validação em Produção (Runtime)
- O contêiner `worker` subiu com a nova imagem e executou o startup reconciliation, restaurando a posição de 3 ações de `PETR4`.
- No ciclo das 13:56:53 (16:56Z), o robô identificou oportunidade de saída e executou com sucesso a venda parcial de 2 ações a R$ 30,52 (recebimento líquido R$ 61,02, lucro realizado R$ +0,82).
- No ciclo seguinte às 13:57:02 (16:57Z), executou o encerramento da posição restante de 1 ação a R$ 30,52 (recebimento líquido R$ 30,51, lucro realizado R$ +0,41).
- A posição foi encerrada com status `CLOSED`, gerando lucro total de R$ +1,24 (+1,24%), saldo em caixa atualizado para R$ 101,24 e histórico de ordens e trades 100% íntegro e consistente.
