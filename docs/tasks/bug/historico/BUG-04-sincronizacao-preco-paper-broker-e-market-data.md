# BUG-04: Sincronização de Preço entre Paper Broker e Market Data e Prevenção de Gap na Execução

## Contexto e Sintoma Observado
Durante a execução de testes operacionais do Worker e IA na B3 (Paper Trading):
1. **Divergência Crítica entre Preço da Análise e Preço da Ordem**:
   - A IA analisou os indicadores gerados a partir dos candles de 1m, 5m e 15m (onde `PETR4` atingiu preços entre R$ 30,45 e R$ 31,01, registrando lucro não realizado de até +3,03%) e emitiu ordem de `SELL` para realização de lucro.
   - Contudo, todas as ordens de venda foram executadas rigidamente a **R$ 30,02**, resultando em prejuízo sistemático de **-0,19%** em 100% das 12 operações registradas no banco de dados.
2. **Causa Raiz Identificada**:
   - `B3MarketDataService.candles()` calcula candles sintéticos oscilando a partir de um valor base, mas **não atualiza `currentPrices`** com o preço de fechamento da vela mais recente.
   - Ao executar a ordem a mercado (`placeMarketOrder`), o `B3PaperBroker` chama `this.price()`, que não encontra cotação em cache e invoca `candles(symbol, '1m', 1)`. Com `limit = 1`, o cálculo sempre converge para ~R$ 30,00.
   - Além disso, cada componente instanciou serviços isolados sem um estado de preço de mercado compartilhado (LTP - Last Traded Price).

## Critérios de Aceite
1. **Sincronização de Cotação Corrente (`currentPrices`)**:
   - Ao gerar ou receber candles (`candles()`), o `B3MarketDataService` deve atualizar o preço corrente do ticker com o valor de fechamento (`close`) da última vela gerada/consultada.
   - O método `price()` deve refletir exatamente o preço do último fechamento de candle de 1 minuto.
2. **Compartilhamento de Instância / Singleton de Cotação**:
   - O `BrokerGateway` e o serviço de market data devem utilizar a mesma referência de dados de mercado para garantir que a ordem a mercado seja preenchida na cotação real visualizada pela IA (acrescida de slippage e taxas).
3. **Slippage Guard / Verificação de Preço Mínimo na Venda**:
   - Ao submeter a ordem de venda com base em uma decisão da IA, garantir que a execução não ocorra em patamar flagrantemente desfavorável em relação ao preço do snapshot da decisão (proteção contra fill com prejuízo inesperado).
4. **Validação Automatizada**:
   - Testes unitários comprovando que após consultar `candles()`, uma chamada subsequente a `price()` e `placeMarketOrder()` executa no valor do fechamento do candle (com o slippage esperado).
   - Suíte de testes (`pnpm test` e `pnpm typecheck`) 100% verde.
