# TASK 02: Parametrização e Aumento do Timeout do OpenRouter

## Objetivo
Tornar o timeout das chamadas à API do OpenRouter configurável via variável de ambiente, aumentando o valor padrão para 30 segundos (30.000 ms), reduzindo falhas por timeout em modelos com fila ou latência variável.

## Contexto Atual
Atualmente, a classe `OpenRouterClient` em `packages/ai/src/index.ts` possui um timeout estático fixado no código de 20 segundos (`AbortSignal.timeout(20_000)`). Em horários de pico ou para modelos maiores gratuitos, o tempo de resposta do OpenRouter frequentemente ultrapassa 20s, resultando em aborto da requisição e acionamento de fallback em HOLD.

## Requisitos de Implementação
1. **Configuração Centralizada no Core (`packages/core/src/index.ts`)**:
   - Adicionar ao schema Zod a variável `OPENROUTER_TIMEOUT_MS`:
     ```ts
     OPENROUTER_TIMEOUT_MS: numeric(30_000)
     ```
   - Atualizar os arquivos `.env` e `.env.example` com o valor default:
     ```env
     OPENROUTER_TIMEOUT_MS=30000
     ```
2. **Atualização no Pacote AI (`packages/ai/src/index.ts`)**:
   - Modificar o construtor da classe `OpenRouterClient` para receber `timeoutMs: number = 30_000`.
   - Utilizar `AbortSignal.timeout(this.timeoutMs)` na chamada de `fetch`.
3. **Injeção no Worker (`apps/worker`)**:
   - Garantir que o worker passe `config.OPENROUTER_TIMEOUT_MS` ao instanciar o `OpenRouterClient` no `service.ts` ou onde o cliente for inicializado.
4. **Testes Unitários**:
   - Adicionar ou atualizar testes no `packages/ai/src/index.test.ts` (ou equivalente) cobrindo a parametrização do timeout e abort handling.

## Critérios de Aceite
- [ ] Variável `OPENROUTER_TIMEOUT_MS` definida no core com fallback de 30000.
- [ ] `OpenRouterClient` respeita o timeout informado.
- [ ] Testes automatizados passando (`pnpm test`).
- [ ] Typecheck passando (`pnpm typecheck`).
- [ ] Arquivo da task movido para `documentacao/tasks/historico/` ao concluir.
