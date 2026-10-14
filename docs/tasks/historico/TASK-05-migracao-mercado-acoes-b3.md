# TASK 05: Migração Estratégica para o Mercado Brasileiro (B3 Day Trade: Ações e Futuros)

## Objetivo
Reorientar e remodelar a arquitetura do Bolinha Trader de criptomoedas (Binance / BTCUSDT) para o **Mercado de Ações Brasileiro (B3)**, preparando o sistema para operar Day Trade em ativos nacionais de alta liquidez (ex: PETR4, VALE3, ITUB4, BBAS3 ou Mini-Índice/Mini-Dólar).

---

## 1. Contexto e Motivação
- O projeto inicial utilizava Binance Testnet apenas como sandbox de validação de infraestrutura, mas o objetivo de negócio é operar **ações na B3 (Brasil)** em reais (BRL).
- Criptomoedas foram descartadas pelo operador; o foco exclusivo é o mercado acionário brasileiro.

---

## 2. Diagnóstico das Mudanças Arquiteturais Necessárias

### A. Moeda Base e Contabilidade
- **Atual**: Conta em USDT (Dólar cripto), lotes fracionários com 8 a 12 casas decimais (`0.00024 BTC`).
- **Novo**: Moeda base em **BRL (R$)**, lote padrão de ações B3 (múltiplos de 100 ações no mercado padrão, ou 1 a 99 no mercado fracionário ex: `PETR4F`).

### B. Provedor de Dados e Roteamento de Ordens (Broker Gateway)
- **Atual**: Binance Spot API REST/WebSocket (`@bolinha/exchange`).
- **Novo**: O mercado brasileiro (B3) opera via corretoras reguladas (Clear, Genial, XP, BTG) com gateways padronizados:
  1. **MetaTrader 5 (MT5)**: Padrão da indústria brasileira para automação de day trade na B3, com simulador (Demo B3), cotações em tempo real e execução de ordens via Socket/Bridge HTTP.
  2. **APIs de Market Data B3**: Provedores de cotação em tempo real e feeds históricos para ações brasileiras (ex: Yahoo Finance/Brapi para dados de candles, ou feed nativo MT5/corretora).

### C. Horários de Negociação (Sessão B3)
- O horário configurado no projeto já estava calibrado para fuso `America/Sao_Paulo` (09:00 às 18:00), perfeitamente compatível com o pregão da B3 (Ações: 10:00 às 17:00 / Futuros: 09:00 às 18:00).

---

## 3. Requisitos de Implementação da TASK-05

1. **Abstração do Gateway de Execução (`@bolinha/exchange`)**:
   - Criar interface genérica de broker/exchange desacoplada de cripto (`BrokerGateway`), permitindo plug-in do conector B3 (ex: `B3MetaTraderClient` ou simulador de Paper Trading B3).
   - Suportar ativos B3 (ex: tickers de 4 a 6 letras: `PETR4`, `VALE3`, `WIN$`, `WDO$`).

2. **Scanner e Multi-Ativos B3**:
   - Permitir configuração de cesta de ações líquidas brasileiras: `PETR4,VALE3,ITUB4,BBDC4,BBAS3`.
   - Analisar o book/candles de cada papel em paralelo e ranquear o melhor setup de tendência e volume.

3. **Motor de Risco B3 (`@bolinha/risk-engine`)**:
   - Ajustar regras de lote para o mercado de ações: lote padrão (100 ações) e fracionário.
   - Cálculo de margem e alocação financeira em BRL (R$).
   - Regras de Day Trade na B3: encerramento compulsório antes do fechamento do pregão (zeragem intradiária para evitar custódia overnight e custos adicionais).

4. **Metodologia de Trading Orientada a Lucro (Take Profit / Stop Loss)**:
   - Eliminar saída prematura por ruído de 1 minuto.
   - Relação Risco:Retorno mínima de 2:1 (ex: buscar +1,2% com stop de -0,5% na ação).
   - Consciência de preço de entrada e PnL não realizado da posição no prompt de IA.

---

## 4. Critérios de Aceite
- [ ] Especificação e arquitetura aprovadas para suportar cotações e ordens de ativos B3.
- [ ] Moeda e contabilidade ajustadas para suportar BRL e lotes inteiros de ações.
- [ ] Testes unitários do motor de risco e core cobrindo regras de ativos da B3.
- [ ] Manter 100% de integridade na suíte de testes do monorepo.
