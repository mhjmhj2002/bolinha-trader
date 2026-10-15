# Relatório de Diagnóstico: Análise de Gaps, Bugs e Divergência na Execução de Venda da IA

**Data da Investigação:** 2026-10-15  
**Ambiente Analisado:** Paper Trading B3 (`bolinha-trader`) via PostgreSQL, Worker Daemon e OpenRouter  
**Status do Teste:** Parado via script `stop-all.sh`

---

## 1. Resumo Executivo da Pergunta do Usuário

> *"está tendo um gap entre a previsão da ia e a venda, porque vi em momentos que a ia retornou que era bom pra vender porque teria lucro e depois aparece prejuizo mesmo assim, avalia se é gap ou bug. avalia todos os logs, dados salvos no bd, etc e ve se tem mais gaps e bugs, adiciona um relatorio disso na pasta de bug para depois gerar bugs separados disso a partir do relatorio"*

### Veredito: É um **BUG CRÍTICO DE ARQUITETURA NO SIMULADOR DE MERCADO (com gap metodológico associado)**

Não se trata de atraso de rede (delay) na execução da ordem nem de alucinação da IA. O problema raiz é uma **grave dessincronização entre as instâncias do serviço de cotação**, aliada à **ausência de persistência do preço gerado**:
1. **O Snapshot (visão da IA)** usa uma geração de candles sintéticos onde o preço foi de R$ 30,20 para **R$ 30,98** (+3,03% de alta). A IA enxergou lucro real com base no snapshot e mandou vender para realizar lucro.
2. **A Execução da Ordem (`placeMarketOrder`)** foi enviada para o `B3PaperBroker`, cujo método `price()` **não compartilha nem salva o estado do gerador de candles**, caindo em um fallback fixo que sempre retorna **R$ 30,00**.
3. Com o slippage simulado (0,05%) e as taxas da B3 (0,03%):
   - A compra sempre executa a **R$ 30,06** (R$ 30,00 * 1,0005 + taxas).
   - A venda sempre executa a **R$ 30,02** (R$ 30,00 * 0,9995 - taxas).
   - **Resultado:** 100% das 12 posições do dia foram vendidas a exatamente **R$ 30,02**, gerando **prejuízo fixo sistemático de -0,19% a -0,58%**, mesmo quando a IA detectou alta expressiva de +1% a +3% no gráfico.

---

## 2. Auditoria dos Dados Salvos no Banco de Dados

### 2.1 Todas as 12 Posições Operadas e Encerradas

| Posição ID | Qtd | Preço Entrada Registrado | Preço Exec. Venda | PnL Realizado (R$) | PnL Calculado pela IA no Motivo |
|---|---|---|---|---|---|
| **Posição 2** | 1 | R$ 30,069 | R$ 30,02 | -R$ 0,058 (-0,19%) | IA viu **+3,13%** (R$ 31,01) |
| **Posição 3** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+3,06%** (R$ 30,99) |
| **Posição 4** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+2,23%** (R$ 30,74) |
| **Posição 5** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+1,70%** (R$ 30,58) |
| **Posição 6** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+2,66%** (R$ 30,87) |
| **Posição 7** | 1 | R$ 30,069 | R$ 30,02 | -R$ 0,058 (-0,19%) | IA viu **+1,87%** (R$ 30,63) |
| **Posição 8** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+1,27%** (R$ 30,45) |
| **Posição 9** | 1 | R$ 30,069 | R$ 30,02 | -R$ 0,058 (-0,19%) | IA viu **+2,43%** (R$ 30,80) |
| **Posição 10** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+1,90%** (R$ 30,64) |
| **Posição 11** | 1 | R$ 30,069 | R$ 30,02 | -R$ 0,058 (-0,19%) | IA viu **+2,13%** (R$ 30,71) |
| **Posição 12** | 3 | R$ 30,069 | R$ 30,02 | -R$ 0,174 (-0,19%) | IA viu **+3,03%** (R$ 30,98) |

> **Constatação Matemática Irrefutável:**  
> Todas as compras foram executadas a **R$ 30,06** e todas as vendas a **R$ 30,02**. Em momento algum o `B3PaperBroker` executou uma venda acima de R$ 30,02, porque ele ignora o preço das cotações que geraram o snapshot!

---

## 3. Detalhamento dos Bugs Encontrados no Código

### BUG #1 (CRÍTICO): Dessincronização de Preço entre Market Data e Execução da Ordem no `B3PaperBroker`

- **Local:** `packages/exchange/src/b3/paper-broker.ts` (linhas 57-59 e 86-89) e `packages/exchange/src/b3/market-data.ts` (linhas 22-68).
- **Mecanismo da Falha:**
  1. No loop do worker (`service.ts`), o ciclo faz:
     ```typescript
     this.exchange.candles('1m'); // gera 100 candles sintéticos terminando em ex: 30.98
     ```
  2. O método `candles()` em `B3MarketDataService` calcula as velas a partir de `basePrice` usando Math.sin e Math.random. Contudo, **ele NÃO atualiza `this.currentPrices` com o preço de fechamento final do candle de 1m**. Ele só atualiza se for chamado via `setMockCandles`.
  3. Quando a ordem é enviada (`placeMarketOrder`):
     ```typescript
     const currentPrice = await this.price();
     ```
     O método `price(ticker)` consulta `this.currentPrices.get(symbol)`. Como nunca foi setado pelo `candles()`, ele executa:
     ```typescript
     const generated = await this.candles(symbol, '1m', 1); // limit = 1
     const lastPrice = generated[0]?.close ?? 30.0;
     ```
     Quando `candles(..., limit=1)` roda, `i=1`:
     `current = 30.0; variation = Math.sin(1/5)*0.15 + (random-0.5)*0.1 ~ 0.03 -> close = 30.03`
     Isso fixa o `price` em torno de **R$ 30,00** para sempre!
  4. Além disso, cada nova instância de `B3PaperBroker` criada no worker instancia um `new B3MarketDataService()`, em vez de ter um singleton compartilhado de cotações em memória ou no Redis/DB.
- **Impacto:** A simulação nunca reflete as oscilações de mercado na hora de preencher ordens; comprar a R$ 30,06 e vender a R$ 30,02 garante perda matemática garantida de spread + taxas em toda e qualquer operação.

---

### BUG #2 (MÉDIO): Cálculo Distorcido de RSI e Indicadores Sintéticos (RSI 100 Constante)

- **Local:** `packages/market-data/src/index.ts` (linha 9) e `packages/exchange/src/b3/market-data.ts` (linhas 36-45).
- **Mecanismo da Falha:**
  1. O loop sintético de candles gera variações com `Math.sin(i / 5) * 0.15`.
  2. Na fórmula do RSI:
     ```typescript
     if (losses === 0) return 100;
     ```
  3. Em mais de 80% dos snapshots registrados no banco (`market_snapshots`), o RSI de 1m, 5m e 15m está cravado em **100.00**.
  4. Nos logs das decisões da IA (`ai_decisions`), a IA repetidamente justifica:
     *"PETR4 está em estado de sobrecompra (RSI 100 em todos os intervalos)..."*
- **Impacto:** A IA opera induzida por um indicador técnico "preso" no extremo (100.00), forçando-a a acreditar em sobrecompra artificial e forçar saídas prematuras.

---

### BUG #3 (BAIXO): Erro no Log do Sistema com Constraint `orders_binance_order_id_unique`

- **Local:** `packages/database/src/schema.ts` e logs de `system_events` (IDs 142, 382, 384, 387, 390).
- **Mecanismo da Falha:**
  Nos dias anteriores (14/10), ocorreram erros de concorrência ou reexecução tentando gravar a mesma ordem com `broker_order_id` duplicado.
  Embora o BUG-03 tenha adicionado `${Date.now()}-${this.instanceId}-${counter}` para novas ordens, ainda existem índices no banco com nome herdado de binance (`orders_binance_order_id_unique`), e casos de reconexão de worker precisam garantir idempotência sem estourar exception não tratada no `TradingService`.

---

## 4. Análise de Gaps (Lacunas de Arquitetura e Estrutura)

| Identificador | Tipo | Descrição do Gap | Risco / Consequência |
|---|---|---|---|
| **GAP-01** | Arquitetura de Mercado | **Desacoplamento entre Feed de Cotações e Motor de Ordens**: O feed de market data e o livro/broker de ordens não compartilham um "Last Traded Price" (LTP) unificado. Quando a API ou o Worker perguntam o preço, cada um calcula um valor sintético diferente. | Divergência entre gráfico do dashboard, tela da IA e ordem executada. |
| **GAP-02** | Estratégia de IA | **Ausência de Trailing Stop e Limites de Execução (Slippage Guard)**: As ordens emitidas pelo worker são a mercado (`placeMarketOrder`) sem verificação de preço mínimo aceitável de venda (`limitPrice`). Se o preço no momento da execução for inferior ao preço analisado pela IA menos a margem de lucro pretendida, a ordem deveria ser abortada. | Execuções desfavoráveis e perdas não planejadas. |
| **GAP-03** | Validação B3 | **Integração Real de Market Data B3**: O conector atual ainda opera com dados 100% simulados matematicamente (`Math.sin`), sem persistência de tick-by-tick real da B3 (via Brapi, MT5 ou Yahoo Finance com delay de 15m). | Inviabilidade de validar a assertividade da IA em cenário realista de mercado. |

---

## 5. Proposta de Desdobramento em Tarefas de Correção (Bugs a Criar)

A partir deste relatório, recomenda-se criar e registrar no `ANDAMENTO.md` os seguintes bugs específicos:

1. **`BUG-04-sincronizacao-preco-paper-broker-e-market-data.md`**:
   - Fazer o `B3PaperBroker` e o `B3MarketDataService` utilizarem o preço de fechamento real do último candle gerado/coletado.
   - Manter consistência: a ordem a mercado deve executar no preço atual do candle + slippage.
   - Adicionar trava de execução: impedir venda se o preço de mercado for inferior ao limite mínimo de proteção da decisão da IA.

2. **`BUG-05-normalizacao-gerador-candles-e-rsi.md`**:
   - Ajustar o algoritmo gerador sintético de candles para produzir oscilações bidirecionais realistas (Random Walk / Movimento Browniano Geométrico com volatilidade típica de ações da B3: ~1,5% a 2,5% a.d.).
   - Evitar saturação contínua do RSI em 100.00.

---
*Relatório gerado automaticamente para direcionamento das tarefas de correção.*
