# TASK 06: Conector de Simulação e Execução B3 (Paper Trading / MT5 Bridge)

## Objetivo
Criar o conector de mercado para a B3 com suporte a **Paper Trading simulado com dados reais da B3** e bridge para execução em corretora brasileira (via MetaTrader 5 ou API de corretora nacional).

---

## 1. Motivação
Para testar e validar o robô de day trade sem risco e com dados fidedignos da B3, é necessário:
1. Obter feeds de cotação intradiária de ações brasileiras (PETR4, VALE3, etc.).
2. Executar simulação de preenchimento de ordens (Paper Trading B3) que respeite o livro de ofertas (slippage, spread e taxa da B3/emolumentos).
3. Disponibilizar ponte de conexão com MetaTrader 5 (MT5 Bridge) para quando o usuário conectar sua conta demo ou real de corretora (Clear, XP, Genial, BTG).

---

## 2. Requisitos de Implementação
1. **Módulo de Market Data B3 (`packages/exchange/src/b3/`)**:
   - Provedor de candles para tickers brasileiros (1m, 5m, 15m).
   - Suporte a tickers de ações padrão (`PETR4`, `VALE3`) e fracionário (`PETR4F`).
2. **Simulador de Execução (B3 Paper Broker)**:
   - Permite rodar o loop do worker em ambiente de simulação com saldo em BRL (ex: R$ 1.000,00 ou R$ 5.000,00).
   - Simula custos reais de Day Trade B3: Emolumentos B3 (~0,03%) e taxa de liquidação.
3. **Bridge HTTP/Socket para MetaTrader 5**:
   - Endpoint ou script em Python/MQL5 para comunicação com o terminal MT5 da corretora brasileira, permitindo envio de ordens a mercado de compra e venda de ações.
4. **Testes Unitários**:
   - Testes cobrindo validação de tickers B3, arredondamento de lotes (100 ações vs 1 ação fracionária) e contabilidade de emolumentos B3.

---

## 3. Critérios de Aceite
- [ ] Conector B3 funcional para simulação de day trade em ações brasileiras.
- [ ] Cálculo correto de custos e emolumentos da B3.
- [ ] Testes automatizados aprovados no monorepo.
