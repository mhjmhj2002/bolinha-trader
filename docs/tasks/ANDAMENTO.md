# Andamento e Status das Tarefas - Bolinha Trader

Este documento consolida a rastreabilidade e status de todas as tarefas e demandas (features, melhorias e bugs) do projeto **bolinha-trader**.

---

## Tabela Resumo

| Identificador | Título / Demanda | Tipo | Status | Localização |
|---|---|---|---|---|
| **BUG-01** | Rejeição de Ordem Binance Testnet (HTTP 400 -1021 recvWindow) e Bloqueio de Ciclos | Bug | **done** | [`docs/tasks/bug/historico/BUG-01-binance-recvwindow-e-ordem-pendente.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/historico/BUG-01-binance-recvwindow-e-ordem-pendente.md) |
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
