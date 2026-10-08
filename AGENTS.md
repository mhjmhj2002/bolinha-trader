# Guia e Regras de Desenvolvimento dos Agentes

Este documento estabelece o modelo operacional, ciclo de vida de tarefas e padrões de engenharia para qualquer agente ou desenvolvedor que for implementar melhorias no repositório **bolinha-trader**.

---

## 1. Ciclo de Vida de Tarefas (Workflow Obrigatório)

As tarefas ativas residem na pasta `docs/tasks/`. Cada tarefa possui nomenclatura padronizada:
`TASK-<numero>-<slug>.md` (exemplo: `TASK-01-agents-guide.md`).

### Etapas de Execução:
1. **Assumir a Tarefa e Atualizar para `doing`**:
   - Ler integralmente o arquivo da task ou bug antes de realizar qualquer alteração de código.
   - Atualizar **imediatamente** o status da respectiva linha para **`doing`** em `docs/tasks/ANDAMENTO.md`.
   - Conferir se existem pré-requisitos ou dependências entre pacotes.
2. **Execução Incremental com TDD/Testes**:
   - Manter cobertura de testes unitários em `@bolinha/core`, `@bolinha/ai`, `@bolinha/risk-engine`, `@bolinha/worker`, etc.
   - Sempre executar `pnpm test` e `pnpm typecheck` para garantir que nada quebrou.
3. **Validação e Auditoria**:
   - Rodar linter e formatação (`pnpm lint`).
4. **Finalização, Arquivamento e Atualização para `done`**:
   - Após a task estar 100% implementada e testada, **o agente DEVE mover o arquivo da tarefa** para o diretório de histórico:
     ```bash
     mv docs/tasks/<TASK-ARQUIVO>.md docs/tasks/historico/
     # Para bugs:
     mkdir -p docs/tasks/bug/historico
     mv docs/tasks/bug/<BUG-ARQUIVO>.md docs/tasks/bug/historico/
     ```
   - Atualizar o status correspondente para **`done`** e a localização em `docs/tasks/ANDAMENTO.md`.
   - Registrar no relatório final a confirmação de movimentação para o histórico.

---

## 2. Padrões de Qualidade de Código

1. **Fail-Closed e Segurança Financeira**:
   - O projeto opera ordens em exchange (Binance Testnet). Toda e qualquer incerteza, erro de rede, timeout ou resposta inválida de IA **deve sempre cair em HOLD seguro**.
   - Jamais ignore erros de validação financeira ou regras de lote mínimo (`minNotional`, `minQty`, `stepSize`).
2. **Configurações Centralizadas e Tipadas**:
   - Novas variáveis de ambiente devem ser registradas com schema Zod no pacote `packages/core/src/index.ts` e refletidas em `.env.example` e `.env`.
   - Utilize valores padrão seguros.
3. **Isolamento de Monorepo (pnpm workspaces)**:
   - Respeite as fronteiras entre os pacotes (`@bolinha/core`, `@bolinha/ai`, `@bolinha/database`, `@bolinha/exchange`, `@bolinha/market-data`, `@bolinha/risk-engine`).
4. **Respeito ao Estilo e Formatação**:
   - TypeScript strict mode ativado.
   - Sem supressões arbitrárias de tipos (`as any` ou `@ts-ignore` são estritamente desencorajados).
