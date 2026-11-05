# TASK 22: Scanner Multi-Ativos B3 para Oportunidades de Day Trade

## Objetivo
Permitir que o Bolinha Trader monitore e escaneie simultaneamente uma cesta de ações líquidas da B3 (ex: `PETR4,VALE3,ITUB4,BBDC4,BBAS3`), selecionando o melhor ativo com oportunidade técnica de compra em vez de ficar restrito a um único ticker.

---

## 1. Contexto e Motivação
- Atualmente, o sistema opera estritamente com `SYMBOL=PETR4`. Quando a PETR4 está em tendência de baixa contínua ou consolidada, o robô passa todo o pregão em `HOLD`, mesmo que outros papéis de alta liquidez estejam apresentando confluência clara de alta (EMA9 > EMA21 em multi-timeframe com RSI favorável).
- Na B3, o sucesso de um robô intradiário depende da capacidade de escanear o mercado e direcionar o capital da banca para o papel com maior probabilidade e momentum.

---

## 2. Requisitos de Engenharia

### A. Configuração Centralizada (`packages/core`)
- Adicionar ao schema Zod a variável `SYMBOLS: z.string().default('PETR4,VALE3,ITUB4,BBDC4,BBAS3')`.
- Manter compatibilidade com `SYMBOL` (caso `SYMBOLS` não seja fornecido, usar `[config.SYMBOL]`).
- Fornecer helper tipado `getTradingSymbols(): string[]`.
- Atualizar `.env.example` e `.env`.

### B. Coleta e Varredura de Market Data (`packages/exchange` & `packages/market-data`)
- Suportar geração ou obtenção de candles (1m, 5m, 15m) e cálculo de snapshots de indicadores para múltiplos ativos em paralelo (`Promise.all`).
- Calcular a confluência multi-timeframe de alta para cada ativo.

### C. Lógica de Decisão no Worker (`apps/worker`)
- **Se houver posição aberta:** O worker foca no ativo da posição aberta para gerenciar saída, Stop Loss, Take Profit e Trailing Stop.
- **Se NÃO houver posição aberta (caixa livre):**
  - O scanner varre todos os ativos de `SYMBOLS`.
  - Filtra os ativos elegíveis (que atendem ao gate de confluência multi-timeframe: `confluentTimeframes >= ENTRY_MIN_CONFLUENT_TIMEFRAMES`).
  - Se nenhum ativo atender ao critério, emite `HOLD` justificando que nenhum papel da cesta atendeu ao setup de compra.
  - Se houver ativos elegíveis, ranqueia pelo momentum (ex: confluência mais forte, spread EMA9-EMA21, retorno recente) e envia o ativo mais promissor (ou a lista ranqueada) para a decisão e dimensionamento da IA.

### D. Integração e Observabilidade (`apps/api` & `packages/database`)
- O dashboard e a API já suportam `symbol` por posição e ordem.
- Eventos de log registram o resultado da varredura (`scanner_scan_completed` com ativos analisados e ativos elegíveis).

---

## 3. Critérios de Aceite
- [ ] Schema Zod em `@bolinha/core` aceita `SYMBOLS` como lista separada por vírgula.
- [ ] Helper retorna array sanitizado de tickers em maiúsculas (ex: `['PETR4', 'VALE3', 'ITUB4']`).
- [ ] Scanner filtra e ranqueia ativos elegíveis sem bloquear o loop.
- [ ] Se houver posição aberta, opera estritamente o ativo da posição até a zeragem.
- [ ] 100% dos testes unitários existentes e novos passando (`pnpm test`).
- [ ] `pnpm typecheck` e `pnpm lint` sem erros.
