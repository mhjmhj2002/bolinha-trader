# Execução do projeto

## Objetivo

Listar scripts reais e seus riscos. A sequência do operador fica no [runbook](20_RUNBOOK_OPERACIONAL.md).

| Comando | Objetivo |
| --- | --- |
| `pnpm dev` | API e worker locais em watch; requer banco local |
| `pnpm build` / `pnpm typecheck` | compila todos os projetos TypeScript |
| `pnpm lint` | ESLint do repositório |
| `pnpm test` | Vitest uma vez |
| `pnpm db:migrate` | migrations na `DATABASE_URL` atual |
| `pnpm trading:once` | ciclo no container; pode negociar na fase correta |
| `pnpm trading:once:local` | mesmo ciclo no processo local |
| `pnpm trading:smoke:testnet` | BUY e SELL reais na Testnet; exige posição conceitual fechada |
| `pnpm trading:force-close` | tenta vender a posição conceitual inteira |
| `pnpm trading:status` | JSON de estado persistido |
| `pnpm trading:day-test:check` | resumo legível da sessão |
| `pnpm trading:report:today` | relatório operacional atual |
| `pnpm trading:finalize:today` | consolida só sessão `FINISHED` sem posição |

Scripts de trading exceto `:local` usam `docker compose exec` e requerem o worker rodando. `pnpm format` reescreve arquivos e não é um passo operacional.
