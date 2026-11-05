# TASK-34: Ingestão de Cotações em Tempo Real (WebSocket / Ticks) com Fila de Eventos e Decisão Desacoplada

## Status: `doing`

---

## 1. Contexto e Motivação
Atualmente, o **Bolinha Trader** opera num ciclo por amostragem temporal (polling a cada `INTERVAL_SECONDS`, configurado para 180s ou 60s). 
Embora a amostragem periódica seja eficiente para checagem de confluência em fechamento de barras (candles de 1m, 5m, 15m), ela é lenta para o **gerenciamento de risco de saída** (Stop Loss, Trailing Stop e Take Profit) em posições abertas na B3.

Para obter o melhor dos dois mundos sem custo adicional (usando cotações gratuitas de bridges locais como MT5 ou feeds em tempo real), a arquitetura precisa ser dividida em **duas frentes coordenadas**:
1. **Pipeline de Ingestão em Tempo Real (Event-Driven)**:
   - Um servidor/cliente WebSocket ou receptor de ticks que escuta eventos de preço (`TICK_EVENT` ou `CANDLE_CLOSE_EVENT`).
   - Esses eventos são enfileirados em uma fila concorrente segura e bufferizada em memória (`TickEventQueue`).
2. **Worker Consumidor de Eventos e Gerenciador de Risco Imediato (Fast Path)**:
   - Processa ticks da fila imediatamente.
   - Quando há posição aberta, verifica violação de Stop Loss, Trailing Stop ou Take Profit no exato milissegundo em que o tick ocorre, disparando ordens de saída imediatas.
3. **Agendador Periódico Mantido (Slow Path / Periodic Scanner)**:
   - Continua rodando no fechamento de janelas para avaliar escaneamento de ativos da cesta B3 e confluência técnica de compra (onde não há pressa de microssegundos).

---

## 2. Requisitos Técnicos
1. **Contrato de Eventos e Tipos (`@bolinha/core`)**:
   - Definir `MarketTickEvent`: `{ symbol: string, price: number, volume?: number, timestamp: number }`.
   - Definir `MarketCandleEvent`: `{ symbol: string, interval: '1m' | '5m' | '15m', candle: Candle }`.
   - Variáveis no schema Zod (`WS_ENABLED`, `WS_PORT`, `WS_PATH`, etc.) com valores default seguros e retrocompatíveis.
2. **Fila de Eventos Desacoplada (`TickEventQueue`)**:
   - Fila em memória eficiente (FIFO com backpressure/descarte de ticks obsoletos por ativo para não estourar memória).
   - Suporte a múltiplos assinantes / workers assíncronos.
3. **Receptor WebSocket / Gateway (`@bolinha/exchange`)**:
   - `B3WebSocketFeed` ou listener compatível com JSON-RPC / raw ticks da bridge MT5.
   - Fail-closed: se a conexão cair, logar aviso e manter o fallback de polling HTTP sem quebrar o trading.
4. **Fast-Path no Serviço do Worker (`apps/worker`)**:
   - Escuta eventos da fila.
   - Se o preço violar os limites matemáticos calculados da posição (SL / TP / Trailing), executa a ordem de fechamento diretamente sem esperar o próximo ciclo de polling.
5. **Preservação de Testes e Tipos**:
   - Cobertura de testes unitários para a fila, receptor e processador de ticks.
   - `pnpm test` e `pnpm typecheck` 100% verdes.

---

## 3. Critérios de Aceite
- [ ] Interface e tipagens de eventos de mercado criadas e exportadas.
- [ ] Implementação de fila concorrente de ticks (`TickEventQueue`) com testes de concorrência e bufferização.
- [ ] Servidor/cliente de ingestão de ticks via WebSocket ou fila local sem dependências proprietárias pagas.
- [ ] Integração no `TradingService` para avaliação de risco em tempo real quando evento de tick for recebido.
- [ ] Todos os 284+ testes unitários passando.
