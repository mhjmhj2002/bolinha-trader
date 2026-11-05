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

### ⚠️ Nota operacional obrigatória: banca inicial do `.env` × banco de dados

> [!IMPORTANT]
> `INITIAL_BANK_BRL` e `MAX_POSITION_PERCENT` no `.env` são **apenas o valor de seed/padrão**, usados somente quando a tabela `trading_configuration` está **VAZIA**. Com uma linha existente, **o banco vence** (o runtime lê o PostgreSQL primeiro e só cai no `.env`/default se não houver configuração gravada) — comportamento intencional desde a TASK-18.

- A migration histórica `packages/database/drizzle/0001_trading_configuration.sql` semeia `initial_bank_usdt = 20`.
- Portanto, em um **volume pré-existente** (banco já migrado antes de a banca ser ajustada para R$ 100), a banca efetiva pode continuar sendo **R$ 20**, mesmo com `INITIAL_BANK_BRL=100` no `.env`.
- Após reiniciar os serviços, **confira a banca efetiva** e corrija se estiver errada:
  ```bash
  pnpm trading:status        # banca/posição efetivas em uso pelo runtime
  ```
  (alternativas: o dashboard operacional ou o endpoint de configuração da API).

Regra prática: **banca efetiva = 20 ⇒ banco pré-existente com o seed legado**; ajuste pela API/dashboard para o valor desejado, pois editar o `.env` sozinho **não** sobrescreve uma linha já existente.

## Padrão de Logs

Todos os scripts gravam seus logs na pasta `docs/ambiente/deploy/logs/`. Uma execução gera até **três famílias de artefatos, todas com o mesmo timestamp** (permitindo correlacioná-las):

| Artefato | Nome do arquivo | Conteúdo |
|---|---|---|
| Build/deploy | `<yyyy-mm-dd-hh-mm-ss>-<app>-log.txt` (ex.: `2026-10-22-08-58-45-all-log.txt`) | Validações, build e deploy. **Termina poucos segundos após os contêineres subirem.** |
| Testes (fixtures) | `<yyyy-mm-dd-hh-mm-ss>-<app>-test-log.txt` | Cópia isolada da saída do `vitest`. **Nunca contém eventos de produção.** |
| Runtime (produção) | `<yyyy-mm-dd-hh-mm-ss>-<serviço>-runtime-log.txt` (ex.: `-worker-runtime-log.txt`, `-api-runtime-log.txt`, `-postgres-runtime-log.txt`) | Saída real de cada contêiner — a evidência do que o robô fez. |

- `<app>` segue a convenção já existente: `all`, `postgres`, `api`, `worker`, `stop`.
- **Dentro dos logs**: cada mensagem de log possui timestamp prefixado no mesmo padrão do nome do arquivo:
  ```text
  [2026-10-14-08-39-49] [INFO] Verificando ferramentas instaladas no sistema...
  [2026-10-14-08-39-49] [SUCCESS] Todas as ferramentas necessárias estão presentes...
  ```

### Delimitação da saída de testes

A suíte `vitest` emite linhas JSON de nível `ERROR` que são **fixtures** (`temporary B3 outage`, `dashboard writer unavailable`, `B3 Testnet HTTP 400 (-1021): Timestamp ... outside of the recvWindow`, `broker unavailable while reconciling retry-after-outage`) e já foram confundidas com incidentes reais. Para eliminar essa ambiguidade, a fase de testes é envolvida por uma faixa inequívoca no log de deploy:

```text
################################################################################
# ===== INÍCIO SAÍDA DE TESTES (vitest) — NÃO SÃO EVENTOS DE PRODUÇÃO =====
################################################################################
# [...] [TESTES] Linhas JSON 'ERROR' aqui são FIXTURES de teste; JAMAIS incidentes.
# [...] [TESTES] Eventos reais de produção ficam nos arquivos *-runtime-log.txt,
# [...] [TESTES] cujo hostname é o ID do contêiner (ex.: 6c7e88124b62), não 'nani-Latitude-3480'.
# [...] [TESTES] Cópia isolada desta seção: .../logs/<timestamp>-all-test-log.txt
################################################################################
...saída do vitest...
################################################################################
# ===== FIM SAÍDA DE TESTES (vitest) — RESULTADO: SUCESSO =====
# [...] [TESTES] Acima: somente resultados de teste. Nenhum evento de produção.
################################################################################
```

> **Regra de leitura**: `hostname` igual ao nome da máquina de build (ex.: `nani-Latitude-3480`) ⇒ **fixture de teste**. `hostname` igual ao ID do contêiner (ex.: `6c7e88124b62`, `ebe270625b7c`) ⇒ **evento de produção**.

### Captura dos logs de runtime

Ao final do deploy (`deploy.sh`, `run-all.sh`, `stop-all.sh` e variantes por serviço), a função `capture_runtime_logs` grava um **snapshot** de cada serviço:

```bash
docker compose logs --no-color --timestamps --since <início-da-execução> <serviço> \
  > logs/<timestamp>-<serviço>-runtime-log.txt
```

Cada arquivo abre com o cabeçalho `===== INÍCIO LOG DE RUNTIME — contêiner '<serviço>' (EVENTOS DE PRODUÇÃO) =====`.

**Streaming é OPT-IN e limitado no tempo** (padrão = snapshot). O motivo: `docker logs -f` sem limite travaria o script de deploy indefinidamente. Habilitando:

```bash
# Acompanha o runtime por até 300s e anexa ao arquivo do timestamp corrente
RUNTIME_LOG_FOLLOW=true RUNTIME_LOG_FOLLOW_SECONDS=300 ./docs/ambiente/deploy/deploy.sh
```

`RUNTIME_LOG_FOLLOW_SECONDS` (padrão `180`) é aplicado via `timeout`; se `timeout` não existir no sistema, o opt-in é ignorado com aviso (para jamais travar o deploy). `RUNTIME_LOG_SINCE` permite sobrescrever a fronteira temporal da captura (padrão: instante de início do script, em UTC/RFC3339).

**Acompanhamento manual** (comandos equivalentes, sempre disponíveis):

```bash
# Snapshot novo a qualquer momento
docker compose logs --no-color --timestamps --since 2026-10-22T11:58:45Z worker \
  > docs/ambiente/deploy/logs/$(date +'%Y-%m-%d-%H-%M-%S')-worker-runtime-log.txt

# Acompanhamento contínuo no terminal (Ctrl+C para sair)
docker compose logs --no-color --timestamps -f worker

# Acompanhamento limitado (não trava a sessão)
timeout 300 docker compose logs --no-color --timestamps -f worker
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
