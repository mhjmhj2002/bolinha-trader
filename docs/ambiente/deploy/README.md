# Scripts de Build e Deploy do Bolinha Trader

Scripts Bash padronizados para validar, construir e implantar os serviços de forma modular (`api`, `worker` e `postgres`) ou completa em 2 cliques.

## Estrutura dos Arquivos

- [`common.sh`](common.sh): Funções compartilhadas (registro de log com espelhamento `tee`, inicialização automática do Docker se inativo, validação rigorosa de ferramentas e variáveis de ambiente, parada limpa de serviços em execução, compilação e deploy isolado com healthcheck, e retenção interativa da tela ao final).
- [`run-all.sh`](run-all.sh): **Executável unificado (Build + Deploy)** para acionamento direto em 2 cliques ou terminal. Abre o emulador de terminal gráfico automaticamente caso clicado via interface gráfica e **mantém o terminal aberto ao término** (aguarda `[ENTER]`) para permitir leitura de mensagens e diagnóstico de erros.
- [`stop-all.sh`](stop-all.sh): **Executável para parar o projeto completo** (`docker compose down`). Também abre terminal interativo se clicado com duplo-clique e mantém o terminal aberto ao final para confirmação.
- [`bolinha-trader-build-deploy.desktop`](bolinha-trader-build-deploy.desktop): Atalho de desktop padrão Linux (disponibilizado também na sua `Área de Trabalho`) para disparar todo o fluxo de Build + Deploy com 2 cliques mantendo a janela de terminal aberta.
- [`bolinha-trader-stop.desktop`](bolinha-trader-stop.desktop): Atalho de desktop (disponibilizado também na sua `Área de Trabalho`) para parar e descer todos os contêineres do projeto com 2 cliques.
- `build.sh` / `deploy.sh`: Scripts modulares para executar build ou deploy do ambiente completo (`postgres` + `api` + `worker`) separadamente.
- `api/build.sh`, `api/deploy.sh`: Build e deploy exclusivo da API.
- `worker/build.sh`, `worker/deploy.sh`: Build e deploy exclusivo do Worker.
- `postgres/build.sh`, `postgres/deploy.sh`: Pull/atualização da imagem e deploy isolado do PostgreSQL (preservando o volume persistente de dados).

## Comportamento Operacional

1. **Auto-start do Docker**: Caso o daemon do Docker não esteja ativo, tenta iniciá-lo automaticamente via `systemctl` ou `service`.
2. **Validação de Ferramentas e Variáveis**:
   - Ferramentas obrigatórias: `node`, `pnpm`, `docker`.
   - `.env` obrigatório: `DATABASE_URL`, `SYMBOL` (deve ser `PETR4`), `INITIAL_BANK_BRL` (> 0), `OPENROUTER_MODELS`, `INTERVAL_SECONDS`, `TRADING_LOOP_ENABLED`.
   - `.env` recomendado: `OPENROUTER_API_KEY` (emite alerta sem travar o deploy).
3. **Terminal Sempre Aberto para Diagnóstico**:
   - Tanto o executável `run-all.sh`, o script `stop-all.sh`, os atalhos `.desktop`, quanto os scripts que utilizam `common.sh` não fecham a janela sozinhos ao final: exigem confirmação com `[ENTER]`, garantindo tempo hábil para checar logs e eventuais falhas.
4. **Parada Inteligente**: Se o serviço alvo (ou serviços dependentes) já estiver em execução, é interrompido antes do início da nova compilação/deploy.
5. **Deploy Isolado & Orquestrado**:
   - O PostgreSQL sobe preservando os dados. Ao atualizar o PostgreSQL isoladamente, a API e o Worker são pausados e religados em ordem garantida.
   - Cada serviço sobe com flags `--no-deps --force-recreate --wait` e aguarda atingir o status **healthy**.

## Padrão de Logs

Todos os scripts gravam seus logs na pasta `docs/ambiente/deploy/logs/`:
- **Nome do arquivo**: `<yyyy-mm-dd-hh-mm-ss>-<app>-log.txt` (ex: `2026-10-14-08-39-49-postgres-log.txt`, `2026-10-14-08-40-36-api-log.txt`, `2026-10-14-08-22-37-all-log.txt`).
- **Dentro dos logs**: Cada mensagem de log possui timestamp prefixado no mesmo padrão do nome do arquivo:
  ```text
  [2026-10-14-08-39-49] [INFO] Verificando ferramentas instaladas no sistema...
  [2026-10-14-08-39-49] [SUCCESS] Todas as ferramentas necessárias estão presentes...
  ```

## Como Executar

```bash
# Execução completa unificada (Build + Deploy com terminal aberto)
./docs/ambiente/deploy/run-all.sh

# Parar o projeto completo (com terminal aberto)
./docs/ambiente/deploy/stop-all.sh

# Ou acionamento com 2 cliques na Área de Trabalho:
# - Clique duas vezes no ícone "Bolinha Trader - Build & Deploy" (para subir)
# - Clique duas vezes no ícone "Bolinha Trader - Parar Projeto" (para parar)

# Build e deploy separados (ambiente completo)
./docs/ambiente/deploy/build.sh
./docs/ambiente/deploy/deploy.sh

# Apenas PostgreSQL
./docs/ambiente/deploy/postgres/build.sh
./docs/ambiente/deploy/postgres/deploy.sh

# Apenas API
./docs/ambiente/deploy/api/build.sh
./docs/ambiente/deploy/api/deploy.sh

# Apenas Worker
./docs/ambiente/deploy/worker/build.sh
./docs/ambiente/deploy/worker/deploy.sh
```
