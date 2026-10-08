# TASK 01: Criação e Formalização do AGENTS.md e Fluxo de Tarefas

## Objetivo
Formalizar as diretrizes de desenvolvimento para agentes de IA e desenvolvedores que atuam no repositório `bolinha-trader`, estabelecendo o ciclo de vida de tarefas, exigências de qualidade e a regra de arquivamento para a pasta de histórico.

## Contexto
Para garantir consistência nas implementações, qualquer agente que assumir demandas deve seguir um fluxo previsível: ler a tarefa, desenvolver com testes automatizados, garantir integridade dos pacotes do monorepo e arquivar a tarefa concluída em `documentacao/tasks/historico/`.

## Requisitos de Implementação
1. Criar o arquivo `AGENTS.md` na raiz do projeto contendo:
   - Ciclo de vida e regras de execução de tarefas.
   - Padrões de código do monorepo (TypeScript strict, Zod schemas centralizados).
   - Diretrizes financeiras fail-closed (toda falha de IA/rede resulta em HOLD).
   - Instrução mandatória de mover o arquivo da tarefa para `documentacao/tasks/historico/` após a conclusão.
2. Assegurar que o diretório `documentacao/tasks/historico/` existe e está versionado.

## Critérios de Aceite
- [x] Arquivo `AGENTS.md` criado na raiz com todas as seções descritas.
- [x] Diretório `documentacao/tasks/historico/` disponível.
- [x] Ao término, mover este arquivo `TASK-01-agents-guide.md` para `documentacao/tasks/historico/`.
