# Andamento e Status das Tarefas - Bolinha Trader

Este documento consolida a rastreabilidade e status de todas as tarefas e demandas (features, melhorias e bugs) do projeto **bolinha-trader**.

---

## Tabela Resumo

| Identificador | Título / Demanda | Tipo | Status | Localização |
|---|---|---|---|---|
| **BUG-04** | Sincronização de Preço entre Paper Broker e Market Data e Prevenção de Gap na Execução | Bug | **done** | [`docs/tasks/bug/historico/BUG-04-sincronizacao-preco-paper-broker-e-market-data.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-04-sincronizacao-preco-paper-broker-e-market-data.md) |
| **BUG-05** | Normalização do Gerador Sintético de Candles e Correção de Saturação do RSI em 100 | Bug | **done** | [`docs/tasks/bug/historico/BUG-05-normalizacao-gerador-candles-e-rsi.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-05-normalizacao-gerador-candles-e-rsi.md) |
| **BUG-03** | Colisão de Order ID na Reinicialização do Paper Broker e Dimensionamento de Banca Fracionada | Bug | **done** | [`docs/tasks/bug/historico/BUG-03-colisao-order-id-paper-e-dimensionamento-banca.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-03-colisao-order-id-paper-e-dimensionamento-banca.md) |
| **BUG-01** | Rejeição de Ordem Binance Testnet (HTTP 400 -1021 recvWindow) e Bloqueio de Ciclos | Bug | **done** | [`docs/tasks/bug/historico/BUG-01-binance-recvwindow-e-ordem-pendente.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-01-binance-recvwindow-e-ordem-pendente.md) |
| **BUG-02** | Reconciliação Contínua e Tratamento Robusto de Falha de Rede na Submissão de Ordens | Bug | **done** | [`docs/tasks/bug/historico/BUG-02-reconciliacao-continua-e-falha-de-rede.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-02-reconciliacao-continua-e-falha-de-rede.md) |
| **TASK-01** | Guia e Regras de Desenvolvimento dos Agentes | Feature/Meta | **done** | [`docs/tasks/historico/TASK-01-agents-guide.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-01-agents-guide.md) |
| **TASK-02** | Timeout do OpenRouter Parametrizável | Melhoria | **done** | [`docs/tasks/historico/TASK-02-timeout-openrouter-parametrizavel.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-02-timeout-openrouter-parametrizavel.md) |
| **TASK-03** | Calibração de Prompt de IA (Aversão a Overtrading e Viés de HOLD) | Melhoria/IA | **done** | [`docs/tasks/historico/TASK-03-calibracao-prompt-ia.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-03-calibracao-prompt-ia.md) |
| **TASK-04** | Intervalo Operacional e Rotação de Modelos OpenRouter | Melhoria | **done** | [`docs/tasks/historico/TASK-04-intervalo-e-modelos-openrouter.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-04-intervalo-e-modelos-openrouter.md) |
| **TASK_003** | Reconciliação e Recuperação de Estado Operacional | Core/Segurança | **done** | [`docs/tasks/historico/TASK_003_RECONCILIACAO_E_RECUPERACAO.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_003_RECONCILIACAO_E_RECUPERACAO.md) |
| **TASK_004** | Contabilidade de Taxas e Cálculo de PnL | Core/Financeiro | **done** | [`docs/tasks/historico/TASK_004_CONTABILIDADE_TAXAS_E_PNL.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_004_CONTABILIDADE_TAXAS_E_PNL.md) |
| **TASK_005** | Relatório Operacional Diário | Observabilidade | **done** | [`docs/tasks/historico/TASK_005_RELATORIO_OPERACIONAL_DIARIO.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_005_RELATORIO_OPERACIONAL_DIARIO.md) |
| **TASK_006** | Dashboard Operacional | Frontend/UI | **done** | [`docs/tasks/historico/TASK_006_DASHBOARD_OPERACIONAL.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_006_DASHBOARD_OPERACIONAL.md) |
| **TASK_007** | Configuração Operacional em Banco de Dados | Database | **done** | [`docs/tasks/historico/TASK_007_CONFIGURACAO_OPERACIONAL_DB.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_007_CONFIGURACAO_OPERACIONAL_DB.md) |
| **TASK_008** | CRUD e Endpoints de Configuração Operacional | API | **done** | [`docs/tasks/historico/TASK_008_CRUD_CONFIGURACAO_OPERACIONAL.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_008_CRUD_CONFIGURACAO_OPERACIONAL.md) |
| **TASK_009** | Ajuste de Fuso Horário CLI e Editabilidade de Config | Core/CLI | **done** | [`docs/tasks/historico/TASK_009_AJUSTAR_FUSO_CLI_E_EDITABILIDADE_CONFIG.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_009_AJUSTAR_FUSO_CLI_E_EDITABILIDADE_CONFIG.md) |
| **TASK_010** | Corrigir Cálculo de Ciclos Esperados | Worker/Métricas | **done** | [`docs/tasks/historico/TASK_010_CORRIGIR_CICLOS_ESPERADOS.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_010_CORRIGIR_CICLOS_ESPERADOS.md) |
| **TASK_011** | Documentação Completa do Projeto | Documentação | **done** | [`docs/tasks/historico/TASK_011_DOCUMENTACAO_COMPLETA_PROJETO.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK_011_DOCUMENTACAO_COMPLETA_PROJETO.md) |
| **TASK-05** | Migração Estratégica para o Mercado Brasileiro (B3 Day Trade) | Arquitetura/B3 | **done** | [`docs/tasks/historico/TASK-05-migracao-mercado-acoes-b3.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-05-migracao-mercado-acoes-b3.md) |
| **TASK-06** | Conector de Simulação e Execução B3 (Paper Trading / MT5 Bridge) | Exchange/B3 | **done** | [`docs/tasks/historico/TASK-06-conector-execucao-b3.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-06-conector-execucao-b3.md) |
| **TASK-07** | Virada Definitiva para a B3 (Worker, API, Dashboard e Limpeza de Cripto) | Core/Worker/B3 | **done** | [`docs/tasks/historico/TASK-07-virada-definitiva-b3.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-07-virada-definitiva-b3.md) |
| **TASK-08** | Remoção Completa de Binance / Bitcoin / USDT | Limpeza/B3 | **done** | [`docs/tasks/historico/TASK-08-remocao-binance-bitcoin.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-08-remocao-binance-bitcoin.md) |
| **TASK-09** | Banca de R$ 100 com Compras Fracionadas | Risk/Exchange/Database | **done** | [`docs/tasks/historico/TASK-09-banca-100-reais-fracionado.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-09-banca-100-reais-fracionado.md) |
| **TASK-10** | Visibilidade de Saldo em Caixa Livre e Detalhamento de Banca e PnL no Dashboard | Frontend/API | **done** | [`docs/tasks/historico/TASK-10-visibilidade-caixa-saldo-e-pnl-dashboard.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-10-visibilidade-caixa-saldo-e-pnl-dashboard.md) |
| **BUG-06** | Prevenção de Trava de Posição sem Saída (Stop Loss e Take Profit Intradiários Dinâmicos) | IA/Risk/Worker | **done** | [`docs/tasks/bug/historico/BUG-06-prevencao-trava-hold-stop-loss-dinamico.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-06-prevencao-trava-hold-stop-loss-dinamico.md) |
| **BUG-07** | Sincronização e Amostragem Temporal Coerente entre Candles (1m, 5m e 15m) | Exchange/MarketData | **done** | [`docs/tasks/bug/historico/BUG-07-sincronizacao-e-agrupamento-candles-multi-timeframe.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-07-sincronizacao-e-agrupamento-candles-multi-timeframe.md) |
| **TASK-11** | Calibração Dinâmica de Stop Loss e Banda de Tolerância ao Ruído Intradiário | IA/Risk/Core | **done** | [`docs/tasks/historico/TASK-11-calibracao-dinamica-stop-loss-ruido-intradiario.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-11-calibracao-dinamica-stop-loss-ruido-intradiario.md) |
| **TASK-12** | Atualização e Saneamento da Rotação de Modelos Fallback OpenRouter | Core/IA/Worker | **done** | [`docs/tasks/historico/TASK-12-atualizacao-modelos-fallback-openrouter.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-12-atualizacao-modelos-fallback-openrouter.md) |
| **BUG-08** | Progressão Temporal Dinâmica e Janela Deslizante de Candles Sintéticos no Market Data | Bug | **done** | [`docs/tasks/bug/historico/BUG-08-progressao-temporal-dinamica-candles-sinteticos.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-08-progressao-temporal-dinamica-candles-sinteticos.md) |
| **BUG-09** | Desacoplamento da Paginação de Decisões e Correção do Cálculo Total de DecisionCounts no Dashboard | Bug | **done** | [`docs/tasks/bug/historico/BUG-09-desacoplamento-paginacao-e-contagem-decisoes-dashboard.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-09-desacoplamento-paginacao-e-contagem-decisoes-dashboard.md) |
| **BUG-10** | EMA com Seed Duplicada, Candles Agregados Parciais (Sem Compras) e Lucro Flutuante Sem Venda e Caixa Livre Não Refletindo a Venda no Painel | Bug | **done** | [`docs/tasks/bug/historico/BUG-10-ema-duplicada-candles-parciais-e-pnl-flutuante-sem-venda.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-10-ema-duplicada-candles-parciais-e-pnl-flutuante-sem-venda.md) |
| **TASK-13** | Implementação de Proteção por Breakeven e Trailing Stop Dinâmico | IA/Risk/Worker | **done** | [`docs/tasks/historico/TASK-13-protecao-breakeven-trailing-stop.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-13-protecao-breakeven-trailing-stop.md) |
| **TASK-16** | Dimensionamento de Posição no Motor de Risco com Headroom para Custos de Corretagem | Risk/Exchange/Core | **done** | [`docs/tasks/historico/TASK-16-risk-engine-fee-aware-sizing.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-16-risk-engine-fee-aware-sizing.md) |
| **TASK-17** | Alinhamento do Prompt com o Gate Determinístico e Robustez no Parsing de Respostas da IA | IA/MarketData | **done** | [`docs/tasks/historico/TASK-17-ai-prompt-engine-rsi-alignment.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-17-ai-prompt-engine-rsi-alignment.md) |
| **TASK-18** | Centralização e Efetividade das Variáveis Financeiras no Schema Zod | Core/Exchange/Config | **done** | [`docs/tasks/historico/TASK-18-config-zod-typed-financial-vars.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-18-config-zod-typed-financial-vars.md) |
| **TASK-19** | Correção de Fuso Horário e de Clamp de Fronteira no Scheduler | Worker/Core | **done** | [`docs/tasks/historico/TASK-19-scheduler-timezone-correctness.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-19-scheduler-timezone-correctness.md) |
| **TASK-20** | Observabilidade de Runtime nos Logs de Deploy e Delimitação de Ruído de Testes | Observabilidade/Deploy | **done** | [`docs/tasks/historico/TASK-20-observability-runtime-logs.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-20-observability-runtime-logs.md) |
| **TASK-21** | Capacidade de Compra do Prompt Consciente de Custos (Prompt ↔ Engine Capacity Drift) | IA/Core/Risk | **done** | [`docs/tasks/historico/TASK-21-prompt-capacity-cost-aware.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-21-prompt-capacity-cost-aware.md) |
| **MELHORIA-03** | Filtro de Confluência Multi-Timeframe para Entrada (BUY) — Melhoria #3 da Auditoria Operacional | IA/Risk/MarketData/Worker | **done** | [`docs/tasks/historico/TASK-14-melhoria-03-filtro-confluencia-multi-timeframe.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-14-melhoria-03-filtro-confluencia-multi-timeframe.md) |
| **MELHORIA-04** | Modelo Sintético de Ondas de Momentum Intradiárias para Candles B3 — Melhoria #4 da Auditoria Operacional | Exchange/MarketData/Core | **done** | [`docs/tasks/historico/TASK-15-melhoria-04-modelo-sintetico-ondas-momentum.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-15-melhoria-04-modelo-sintetico-ondas-momentum.md) |
| **TASK-22** | Scanner Multi-Ativos B3 para Oportunidades de Day Trade | Core/MarketData/Worker/Risk | **done** | [`docs/tasks/historico/TASK-22-scanner-multi-ativos-b3.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-22-scanner-multi-ativos-b3.md) |
| **TASK-23** | Propagação de Ticker do Ativo em Ordens, Posições e Visibilidade Multi-Ativos no Dashboard | Exchange/Worker/Database/Dashboard | **done** | [`docs/tasks/historico/TASK-23-propagacao-ticker-ordens-e-dashboard.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-23-propagacao-ticker-ordens-e-dashboard.md) |
| **TASK-24** | Limite Diário de Perda (Daily Loss Limit / Circuit Breaker da Conta) | Risk/Core/Worker | **done** | [`docs/tasks/historico/TASK-24-daily-loss-limit-circuit-breaker.md`](docs/tasks/historico/TASK-24-daily-loss-limit-circuit-breaker.md) |
| **TASK-25** | Indicador e Filtro Institucional de VWAP Intradiária para Ações B3 | MarketData/Risk/IA | **done** | [`docs/tasks/historico/TASK-25-vwap-intradiaria-filtro-institucional.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-25-vwap-intradiaria-filtro-institucional.md) |
| **TASK-27** | Stop Loss Dinâmico Baseado na Volatilidade Real do Ativo (Stop ATR) | MarketData/Risk/Core | **done** | [`docs/tasks/historico/TASK-27-stop-loss-dinamico-baseado-em-atr.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-27-stop-loss-dinamico-baseado-em-atr.md) |
| **TASK-28** | Saídas Parciais Mecânicas Automáticas com Múltiplos Alvos (Scale-out) | Risk/Database/Core | **done** | [`docs/tasks/historico/TASK-28-saidas-parciais-mecanicas-automaticas.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-28-saidas-parciais-mecanicas-automaticas.md) |
| **TASK-29** | Grade de Horários Operacionais (16:45 / 17:15) e Proteção de Fim de Pregão (EOD Unwind) | Core/Risk/Worker/DB | **done** | [`docs/tasks/historico/TASK-29-grade-horarios-e-protecao-fim-de-pregao.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-29-grade-horarios-e-protecao-fim-de-pregao.md) |
| **BUG-11** | Venda Precoce da IA por Pânico, Alucinação de Violação de Stop Loss e Calibração de Alvos Intradiários | Bug | **done** | [`docs/tasks/bug/historico/BUG-11-venda-precoce-panico-ia-e-calibracao-alvos.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-11-venda-precoce-panico-ia-e-calibracao-alvos.md) |
| **TASK-30** | Take Profit Total Mecânico e Trava de Lucro Mínimo (Profit Lock-in / Multi-tier Protection) | Risk/Core/Worker/IA | **done** | [`docs/tasks/historico/TASK-30-take-profit-total-mecanico-e-trava-lucro.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-30-take-profit-total-mecanico-e-trava-lucro.md) |
| **TASK-31** | Robôs Pré-Analistas Determinísticos e Alinhamento do Stop Loss | MarketData/Risk/IA/Worker | **done** | [`docs/tasks/historico/TASK-31-robos-pre-analise-e-alinhamento-stop-loss.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-31-robos-pre-analise-e-alinhamento-stop-loss.md) |
| **TASK-32** | Desacoplamento Inteligente de IA e Economia de Recursos por Robôs Pré-Analistas | MarketData/Worker/Core | **done** | [`docs/tasks/historico/TASK-32-desacoplamento-ia-economia-recursos-robos.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-32-desacoplamento-ia-economia-recursos-robos.md) |
| **BUG-12** | Dessincronização de Posição no B3PaperBroker após Reinício de Contêiner | Bug/Worker/Exchange | **done** | [`docs/tasks/bug/historico/BUG-12-dessincronizacao-posicao-paper-broker-restart.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-12-dessincronizacao-posicao-paper-broker-restart.md) |
| **TASK-33** | Alvos de Lucro (Take Profit) Líquidos Conscientes de Taxas e Imposto de Renda (IR 20%) | Risk/Core/Worker/Exchange | **done** | [`docs/tasks/historico/TASK-33-alvos-lucro-liquido-taxas-e-ir.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-33-alvos-lucro-liquido-taxas-e-ir.md) |
| **TASK-34** | Ingestão de Cotações em Tempo Real (WebSocket / Ticks) com Fila de Eventos e Decisão Desacoplada | Core/Exchange/Worker | **done** | [`docs/tasks/historico/TASK-34-ingestao-tempo-real-websocket-fila-eventos.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-34-ingestao-tempo-real-websocket-fila-eventos.md) |
| **TASK-35** | Calibração de Stop/Alvo contra Volatilidade Real e Custos de Transação | Risk/Core | **done** | [`docs/tasks/historico/TASK-35-calibracao-stop-alvo-vs-volatilidade-e-custos.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-35-calibracao-stop-alvo-vs-volatilidade-e-custos.md) |
| **TASK-36** | Dimensionamento de Posição por Risco | Risk/Worker | **done** | [`docs/tasks/historico/TASK-36-dimensionamento-posicao-por-risco.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-36-dimensionamento-posicao-por-risco.md) |
| **TASK-37** | Qualidade de Entrada e Backtest dos Critérios Determinísticos | MarketData/Risk/Worker | **done** | [`docs/tasks/historico/TASK-37-qualidade-entrada-e-backtest-criterios.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-37-qualidade-entrada-e-backtest-criterios.md) |
| **TASK-38** | Resiliência da IA a Rate Limit (429) com Backoff e Confiança no Fallback | AI/Worker | **done** | [`docs/tasks/historico/TASK-38-resiliencia-ia-rate-limit-429.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-38-resiliencia-ia-rate-limit-429.md) |
| **TASK-39** | Métricas Corretas em `daily_results` e Relatório de Expectativa Pós-Pregão | Database/Worker | **done** | [`docs/tasks/historico/TASK-39-metricas-daily-results-corretas-e-expectativa.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-39-metricas-daily-results-corretas-e-expectativa.md) |
| **TASK-40** | Time-Stop e Entrada Escalonada para Reduzir Perda Cheia por Stop | Risk/Worker | **done** | [`docs/tasks/historico/TASK-40-time-stop-e-entrada-escalonada.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-40-time-stop-e-entrada-escalonada.md) |
| **BUG-13** | Erro de Tipagem SQL na Reconciliação e Fechamento de Posições (`timestamp with time zone >= interval`) | Bug/Database | **done** | [`docs/tasks/bug/historico/BUG-13-erro-sql-interval-fechamento-posicao.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-13-erro-sql-interval-fechamento-posicao.md) |
| **TASK-41** | Ajustes Pós-Pregão 05/11: Calibração de Escalabilidade, Cooldown de Tranches e Refinamento do Scanner B3 | Risk/Core/Worker | **done** | [`docs/tasks/historico/TASK-41-calibracao-scaling-cooldown-e-scanner-b3.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/historico/TASK-41-calibracao-scaling-cooldown-e-scanner-b3.md) |


---

## Convenções de Status

- **`to-do`**: Tarefa especificada, com critérios de aceite claros, aguardando início de implementação.
- **`doing`**: Tarefa em desenvolvimento ativo por um agente ou desenvolvedor.
- **`done`**: Tarefa implementada, testada com suíte automatizada (`pnpm test`), tipada (`pnpm typecheck`) e movida para `docs/tasks/historico/`.

---

## Fluxo Operacional Obrigatório para Agentes

> [!IMPORTANT]
> **REGRAS MANDATÓRIAS DE TRANSIÇÃO DE ESTADO:**
> 1. **Ao assumir a demanda (`to-do` -> `doing`)**:
>    - O agente **DEVE IMEDIATAMENTE** editar a tabela resumo deste arquivo ([`docs/tasks/ANDAMENTO.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/ANDAMENTO.md)) e alterar o status da task de `to-do` para **`doing`** antes de realizar qualquer alteração no código.
> 2. **Durante a execução**:
>    - Implementar a solução acompanhada de testes unitários (`pnpm test`) e validação de tipos (`pnpm typecheck`).
> 3. **Ao finalizar a demanda (`doing` -> `done`)**:
>    - O agente **DEVE** mover o arquivo da tarefa para a pasta de histórico:
>      - Se for tarefa/feature:
>        ```bash
>        mv docs/tasks/<TASK-ARQUIVO>.md docs/tasks/historico/
>        ```
>      - Se for bug:
>        ```bash
>        mkdir -p docs/tasks/bug/historico
>        mv docs/tasks/bug/<BUG-ARQUIVO>.md docs/tasks/bug/historico/
>        ```
>    - O agente **DEVE** atualizar o status para **`done`** e o caminho da localização na tabela resumo deste arquivo ([`docs/tasks/ANDAMENTO.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/ANDAMENTO.md)).
>    - Confirmar a movimentação e status no relatório final de entrega.
