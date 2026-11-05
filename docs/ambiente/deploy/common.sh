#!/usr/bin/env bash
# ==============================================================================
# common.sh - Funções compartilhadas para scripts de build e deploy
# Projeto: bolinha-trader
# ==============================================================================

# Garante interrupção imediata em erros não tratados
set -eo pipefail

# Determina diretórios canônicos
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AMBIENTE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCS_DIR="$(cd "${AMBIENTE_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DOCS_DIR}/.." && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"

# Cria pasta de logs caso não exista
mkdir -p "${LOG_DIR}"

# Estado global compartilhado (preenchido por init_logging / capture_runtime_logs)
LOG_FILE=""
LOG_TS=""
APP_NAME=""
LOG_STARTED_ISO=""
TEST_LOG_FILE=""
RUNTIME_LOG_FILES=()

# Obtém timestamp no padrão yyyy-mm-dd-hh-mm-ss
get_timestamp() {
  date +'%Y-%m-%d-%H-%M-%S'
}

# Funções utilitárias de impressão com timestamp no mesmo padrão do nome do arquivo
log_info() {
  local ts
  ts="$(get_timestamp)"
  echo -e "[${ts}] \033[1;34m[INFO]\033[0m $*"
}

log_success() {
  local ts
  ts="$(get_timestamp)"
  echo -e "[${ts}] \033[1;32m[SUCCESS]\033[0m $*"
}

log_warn() {
  local ts
  ts="$(get_timestamp)"
  echo -e "[${ts}] \033[1;33m[WARN]\033[0m $*"
}

log_error() {
  local ts
  ts="$(get_timestamp)"
  echo -e "[${ts}] \033[1;31m[ERROR]\033[0m $*" >&2
}

# Inicia espelhamento do stdout e stderr no terminal e no arquivo de log
# Nome do arquivo: <yyyy-mm-dd-hh-mm-ss>-<app>-log.txt
init_logging() {
  local script_name="$1"
  local app_name="${2:-}"

  # Se app_name não for fornecido, tenta derivar do script_name
  if [ -z "${app_name}" ]; then
    local lower
    lower="$(echo "${script_name}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${lower}" == *"postgres"* ]]; then
      app_name="postgres"
    elif [[ "${lower}" == *"worker"* ]]; then
      app_name="worker"
    elif [[ "${lower}" == *"api"* ]]; then
      app_name="api"
    elif [[ "${lower}" == *"completo"* ]] || [[ "${lower}" == *"todos"* ]]; then
      app_name="all"
    else
      app_name="bolinha-trader"
    fi
  fi

  local ts
  ts="$(get_timestamp)"
  LOG_FILE="${LOG_DIR}/${ts}-${app_name}-log.txt"

  # Timestamp e app da execução corrente: reutilizados para nomear os arquivos
  # satélites (saída de testes e logs de runtime) com o MESMO timestamp do log
  # principal, permitindo correlacionar todos os artefatos de uma execução.
  LOG_TS="${ts}"
  APP_NAME="${app_name}"
  # Instante (UTC, RFC3339) de início da execução: base do `docker compose logs --since`
  LOG_STARTED_ISO="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  # Fronteira temporal da captura de runtime (sobrescrevível por variável de ambiente)
  : "${RUNTIME_LOG_SINCE:=${LOG_STARTED_ISO}}"
  export RUNTIME_LOG_SINCE

  # Duplica stdout e stderr para o arquivo de log e para os descritores de terminal originais
  exec 3>&1 4>&2
  exec > >(tee -a "${LOG_FILE}") 2>&1
  echo "========================================================================"
  echo "🚀 [bolinha-trader] Iniciando: ${script_name}"
  echo "🕒 Data/Hora: $(date +'%Y-%m-%d %H:%M:%S %Z')"
  echo "📁 Repositório: ${REPO_ROOT}"
  echo "📄 Log de saída (build/deploy): ${LOG_FILE}"
  echo "========================================================================"
}

# Carrega ambiente NVM / PNPM / Docker caso ainda não estejam no PATH da sessão
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  source "${HOME}/.nvm/nvm.sh" 2>/dev/null || true
fi
export PATH="${HOME}/.nvm/versions/node/$(ls "${HOME}/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:/snap/bin:${HOME}/.local/bin:${PATH}"

# Finalização com status
finish_logging() {
  local exit_code=$?
  echo "========================================================================"
  if [ "${exit_code}" -eq 0 ]; then
    echo "✅ [bolinha-trader] Execução concluída com SUCESSO!"
  else
    echo "❌ [bolinha-trader] Execução falhou com código de saída: ${exit_code}"
  fi
  echo "🕒 Fim: $(date +'%Y-%m-%d %H:%M:%S %Z')"
  echo "📄 Log build/deploy: ${LOG_FILE:-${LOG_DIR}}"
  echo "🧪 Log de testes (FIXTURES, não é produção): ${TEST_LOG_FILE:-<não executado nesta execução>}"
  local rf
  if [ ${#RUNTIME_LOG_FILES[@]} -gt 0 ]; then
    for rf in "${RUNTIME_LOG_FILES[@]}"; do
      echo "🟢 Log de runtime (PRODUÇÃO): ${rf}"
    done
  else
    echo "🟢 Log de runtime (PRODUÇÃO): <não capturado — use 'docker compose logs' conforme o README>"
  fi
  echo "========================================================================"

  # Mantém o terminal aberto se solicitado por PAUSE_ON_CLOSE=true ou caso não seja um subshell temporário
  if [ "${PAUSE_ON_CLOSE:-true}" = "true" ] && [ -t 0 -o -c /dev/tty ]; then
    echo ""
    echo -n "Pressione [ENTER] para fechar esta janela..."
    read -r _ < /dev/tty 2>/dev/null || read -r _ || true
  fi

  exit "${exit_code}"
}

# Registra trap de saída
trap finish_logging EXIT

# Valida pré-requisitos de ferramentas do sistema
validate_tools() {
  local required_tools=("$@")
  log_info "Verificando ferramentas instaladas no sistema..."
  local missing=()
  for tool in "${required_tools[@]}"; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      missing+=("${tool}")
    fi
  done

  if [ ${#missing[@]} -ne 0 ]; then
    log_error "Ferramenta(s) obrigatória(s) não encontrada(s): ${missing[*]}"
    exit 1
  fi
  log_success "Todas as ferramentas necessárias estão presentes: ${required_tools[*]}"
}

# Variáveis obrigatórias (erro) e recomendadas (aviso) do .env
REQUIRED_ENV_VARS=(DATABASE_URL SYMBOL INITIAL_BANK_BRL OPENROUTER_MODELS INTERVAL_SECONDS TRADING_LOOP_ENABLED)
RECOMMENDED_ENV_VARS=(OPENROUTER_API_KEY)

# Valida presença e conteúdo do arquivo .env (tudo que falta vai para o log em logs/)
validate_env_file() {
  local env_path="${REPO_ROOT}/.env"
  log_info "Validando arquivo de variáveis de ambiente: ${env_path}..."

  if [ ! -f "${env_path}" ]; then
    log_error "Arquivo .env não encontrado em: ${env_path}"
    log_error "Crie a partir do template com: cp ${REPO_ROOT}/.env.example ${REPO_ROOT}/.env"
    exit 1
  fi

  set -a
  # shellcheck source=/dev/null
  source "${env_path}"
  set +a

  local errors=0 var
  for var in "${REQUIRED_ENV_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
      log_error "Variável obrigatória ausente ou vazia no .env: ${var}"
      errors=$((errors + 1))
    fi
  done
  for var in "${RECOMMENDED_ENV_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
      log_warn "Variável recomendada ausente no .env: ${var} (IA cairá em HOLD seguro)."
    fi
  done

  if [ -n "${SYMBOL:-}" ] && [ "${SYMBOL}" != "PETR4" ]; then
    log_error "SYMBOL deve ser fixado em 'PETR4' (B3). Valor atual: '${SYMBOL}'."
    errors=$((errors + 1))
  fi
  if [ -n "${INITIAL_BANK_BRL:-}" ] && ! awk -v v="${INITIAL_BANK_BRL}" 'BEGIN{exit !(v+0>0)}'; then
    log_error "INITIAL_BANK_BRL deve ser numérico e positivo. Valor atual: '${INITIAL_BANK_BRL}'."
    errors=$((errors + 1))
  fi

  if [ "${errors}" -gt 0 ]; then
    log_error "Falha na validação do .env (${errors} erro(s) crítico(s)). Abortando por segurança financeira."
    exit 1
  fi
  log_success "Validação de variáveis de ambiente do .env concluída com sucesso."
}

# Valida funcionamento do Docker daemon e tenta iniciar se estiver parado
validate_docker_daemon() {
  log_info "Verificando se o daemon do Docker está em execução..."
  if ! docker info >/dev/null 2>&1; then
    log_warn "Docker não está respondendo. Tentando iniciar o serviço Docker automaticamente..."
    if command -v systemctl >/dev/null 2>&1; then
      if systemctl list-unit-files snap.docker.dockerd.service >/dev/null 2>&1; then
        sudo systemctl start snap.docker.dockerd.service 2>/dev/null || systemctl start snap.docker.dockerd.service 2>/dev/null || true
      elif systemctl list-unit-files docker.service >/dev/null 2>&1; then
        sudo systemctl start docker 2>/dev/null || systemctl start docker 2>/dev/null || true
      fi
    elif command -v service >/dev/null 2>&1; then
      sudo service docker start 2>/dev/null || service docker start 2>/dev/null || true
    fi

    # Aguarda até 10 segundos para o Docker inicializar
    local attempts=0
    while [ ${attempts} -lt 10 ]; do
      if docker info >/dev/null 2>&1; then
        break
      fi
      sleep 1
      attempts=$((attempts + 1))
    done
  fi

  if ! docker info >/dev/null 2>&1; then
    log_error "Não foi possível comunicar com o Docker daemon. Certifique-se de que o serviço Docker está ativo."
    exit 1
  fi
  log_success "Docker daemon operacional."
}

# --- Controle de serviços (Docker Compose) -----------------------------------

# Retorna 0 se o serviço compose estiver em execução
service_running() {
  local service="$1"
  [ -n "$(cd "${REPO_ROOT}" && docker compose ps --status running -q "${service}" 2>/dev/null)" ]
}

# Se o serviço já estiver iniciado, para antes do build/deploy
stop_if_running() {
  local service="$1"
  if service_running "${service}"; then
    log_warn "Serviço '${service}' já está iniciado. Parando antes de prosseguir..."
    (cd "${REPO_ROOT}" && docker compose stop "${service}")
    log_success "Serviço '${service}' parado."
  else
    log_info "Serviço '${service}' não está em execução."
  fi
}

# --- Delimitação visível da saída de testes (vitest) -------------------------
# A suíte emite linhas JSON de nível ERROR que são FIXTURES (ex.: "temporary B3
# outage", "dashboard writer unavailable", "B3 Testnet HTTP 400 (-1021)...",
# "broker unavailable while reconciling retry-after-outage"). Elas são
# indistinguíveis de incidentes reais quando coladas no log de deploy.
# Solução: faixa de marcadores inequívoca + arquivo dedicado (<ts>-<app>-test-log.txt).

# Abre a seção de testes: banner no log de deploy e espelho em arquivo próprio
test_log_start() {
  local ts test_host
  ts="$(get_timestamp)"
  test_host="$(hostname 2>/dev/null || echo 'host-de-build')"
  TEST_LOG_FILE="${LOG_DIR}/${LOG_TS:-${ts}}-${APP_NAME:-bolinha-trader}-test-log.txt"
  : >"${TEST_LOG_FILE}"

  echo ""
  echo "################################################################################"
  echo "# ===== INÍCIO SAÍDA DE TESTES (vitest) — NÃO SÃO EVENTOS DE PRODUÇÃO ====="
  echo "################################################################################"
  echo "# [$ts] [TESTES] Tudo entre esta faixa e o marcador de FIM é saída da suíte"
  echo "# [$ts] [TESTES] automatizada, executada na máquina de build (hostname: ${test_host})."
  echo "# [$ts] [TESTES] Linhas JSON 'ERROR' aqui são FIXTURES de teste; JAMAIS incidentes."
  echo "# [$ts] [TESTES] Eventos reais de produção ficam nos arquivos *-runtime-log.txt,"
  echo "# [$ts] [TESTES] cujo hostname é o ID do contêiner (ex.: 6c7e88124b62), não '${test_host}'."
  echo "# [$ts] [TESTES] Cópia isolada desta seção: ${TEST_LOG_FILE}"
  echo "################################################################################"

  {
    echo "################################################################################"
    echo "# ===== INÍCIO SAÍDA DE TESTES (vitest) — NÃO SÃO EVENTOS DE PRODUÇÃO ====="
    echo "################################################################################"
    echo "# Arquivo.....: ${TEST_LOG_FILE}"
    echo "# Log pai.....: ${LOG_FILE:-n/a}"
    echo "# Host do build: ${test_host}"
    echo "# [$ts] [TESTES] Linhas JSON 'ERROR' abaixo são FIXTURES de teste, JAMAIS incidentes."
    echo "################################################################################"
  } >>"${TEST_LOG_FILE}"
}

# Fecha a seção de testes com o resultado da suíte
test_log_end() {
  local status="${1:-0}"
  local ts result_line
  ts="$(get_timestamp)"
  if [ "${status}" -eq 0 ]; then
    result_line="# ===== FIM SAÍDA DE TESTES (vitest) — RESULTADO: SUCESSO ====="
  else
    result_line="# ===== FIM SAÍDA DE TESTES (vitest) — RESULTADO: FALHA (código ${status}) ====="
  fi

  echo "################################################################################"
  echo "${result_line}"
  echo "# [$ts] [TESTES] Acima: somente resultados de teste. Nenhum evento de produção."
  echo "################################################################################"
  echo ""

  if [ -n "${TEST_LOG_FILE:-}" ]; then
    {
      echo "################################################################################"
      echo "${result_line}"
      echo "# [$ts] [TESTES] Acima: somente resultados de teste. Nenhum evento de produção."
      echo "################################################################################"
    } >>"${TEST_LOG_FILE}"
  fi

}

# --- Captura de logs de RUNTIME dos contêineres -----------------------------
# O log `<ts>-<app>-log.txt` cobre apenas build/deploy e termina segundos após os
# contêineres subirem, sem nenhuma evidência do que o robô fez em runtime.
# Aqui persistimos a saída real de cada contêiner em arquivo próprio:
#   <logs>/<yyyy-mm-dd-hh-mm-ss>-<serviço>-runtime-log.txt
# Estratégia DEFAULT = snapshot (nunca bloqueia o deploy):
#   docker compose logs --no-color --timestamps --since <início> <serviço>
# Streaming contínuo é OPT-IN e LIMITADO no tempo (ver follow_runtime_logs).

# Caminho canônico do log de runtime de um serviço
runtime_log_path() {
  local service="$1"
  local ts="${LOG_TS:-$(get_timestamp)}"
  echo "${LOG_DIR}/${ts}-${service}-runtime-log.txt"
}

# Fronteira temporal da captura (início da execução do script, em UTC/RFC3339)
runtime_log_since() {
  echo "${RUNTIME_LOG_SINCE:-${LOG_STARTED_ISO:-}}"
}

# Grava o cabeçalho de demarcação no arquivo de runtime
write_runtime_log_header() {
  local file="$1" service="$2" since="$3"
  {
    echo "################################################################################"
    echo "# ===== INÍCIO LOG DE RUNTIME — contêiner '${service}' (EVENTOS DE PRODUÇÃO) ====="
    echo "################################################################################"
    echo "# Arquivo........: ${file}"
    echo "# Origem.........: docker compose logs --no-color --timestamps --since ${since} ${service}"
    echo "# Capturado em...: $(date +'%Y-%m-%d %H:%M:%S %Z')"
    echo "# Escopo.........: somente saída real do contêiner (hostname = ID do contêiner)."
    echo "# [AVISO] Fixtures de teste NÃO aparecem aqui; veja <ts>-<app>-test-log.txt."
    echo "################################################################################"
  } >>"${file}"
}

# Snapshot dos logs de runtime de um ou mais serviços (padrão seguro, não bloqueante)
capture_runtime_logs() {
  local since_arg=""
  if [ "$1" = "--since" ]; then
    since_arg="$2"
    shift 2
  fi
  local services=("$@")
  if [ ${#services[@]} -eq 0 ]; then
    log_warn "capture_runtime_logs chamado sem serviços; nada a capturar."
    return 0
  fi

  local since
  if [ -n "${since_arg}" ]; then
    since="${since_arg}"
  else
    since="$(runtime_log_since)"
  fi
  if [ -z "${since}" ]; then
    since="2 hours ago"
    log_warn "Instante de início da execução desconhecido; capturando runtime com --since '${since}'."
  fi

  echo ""
  echo "################################################################################"
  echo "# ===== INÍCIO CAPTURA DE LOGS DE RUNTIME (EVENTOS DE PRODUÇÃO) ====="
  echo "################################################################################"
  log_info "Capturando logs de runtime (docker compose logs --since ${since}) dos serviços: ${services[*]}"

  local s file
  for s in "${services[@]}"; do
    file="$(runtime_log_path "${s}")"
    : >"${file}"
    write_runtime_log_header "${file}" "${s}" "${since}"
    if (cd "${REPO_ROOT}" && docker compose logs --no-color --timestamps --since "${since}" "${s}" >>"${file}" 2>&1); then
      RUNTIME_LOG_FILES+=("${file}")
      log_success "Log de runtime de '${s}' salvo em: ${file}"
    else
      log_warn "Não foi possível capturar o log de runtime de '${s}' (arquivo: ${file})."
    fi
  done

  show_runtime_log_help "${services[@]}"
  echo "################################################################################"
  echo "# ===== FIM CAPTURA DE LOGS DE RUNTIME ====="
  echo "################################################################################"
  echo ""
}

# Instruções exatas de acompanhamento/consulta dos logs de runtime
show_runtime_log_help() {
  local services=("$@")
  local since
  since="$(runtime_log_since)"
  local s file
  echo "# --------------------------------------------------------------------------"
  echo "# Como acompanhar o runtime em tempo real (todos os comandos são manuais):"
  echo "#   1) Snapshot novo (sobrescreve o arquivo do timestamp corrente):"
  echo "#      docker compose logs --no-color --timestamps --since ${since} <serviço> \\"
  echo "#        > ${LOG_DIR}/<timestamp>-<serviço>-runtime-log.txt"
  echo "#   2) Acompanhamento contínuo no terminal (Ctrl+C para sair):"
  echo "#      docker compose logs --no-color --timestamps -f worker"
  echo "#   3) Acompanhamento limitado no tempo (não trava a sessão):"
  echo "#      timeout 300 docker compose logs --no-color --timestamps --since ${since} -f worker"
  echo "#   4) Opt-in dentro do próprio script de deploy (limitado a"
  echo "#      RUNTIME_LOG_FOLLOW_SECONDS=180s, configurável):"
  echo "#      RUNTIME_LOG_FOLLOW=true RUNTIME_LOG_FOLLOW_SECONDS=300 ./docs/ambiente/deploy/deploy.sh"
  echo "#"
  for s in "${services[@]}"; do
    file="$(runtime_log_path "${s}")"
    echo "#   runtime de '${s}': ${file}"
  done
  echo "# --------------------------------------------------------------------------"
}

# OPT-IN: acompanhamento contínuo por tempo LIMITADO de RUNTIME_LOG_FOLLOW_SECONDS.
# Nunca é o padrão porque `docker logs -f` travaria o script de deploy para sempre.
follow_runtime_logs() {
  local services=("$@")
  if [ "${RUNTIME_LOG_FOLLOW:-false}" != "true" ]; then
    return 0
  fi

  local secs="${RUNTIME_LOG_FOLLOW_SECONDS:-180}"
  if ! command -v timeout >/dev/null 2>&1; then
    log_warn "RUNTIME_LOG_FOLLOW=true ignorado: comando 'timeout' indisponível (evita travar o deploy)."
    return 0
  fi

  local since
  since="$(runtime_log_since)"
  log_info "RUNTIME_LOG_FOLLOW=true: acompanhando logs de runtime por até ${secs}s (opt-in, limitado)."

  local s file rc
  for s in "${services[@]}"; do
    file="$(runtime_log_path "${s}")"
    (cd "${REPO_ROOT}" && timeout "${secs}" docker compose logs --no-color --timestamps --since "${since}" -f "${s}" >>"${file}" 2>&1)
    rc=$?
    if [ "${rc}" -eq 124 ]; then
      log_success "Acompanhamento de '${s}' encerrado pelo limite de ${secs}s (comportamento esperado)."
    elif [ "${rc}" -eq 0 ]; then
      log_info "Acompanhamento de '${s}' encerrado pelo serviço."
    else
      log_warn "Acompanhamento de '${s}' terminou com código ${rc}."
    fi
  done
}

# Valida código (install, typecheck, testes, build TS) apenas para serviços Node/TS
validate_code() {
  cd "${REPO_ROOT}"
  log_info "Instalando dependências (pnpm install --frozen-lockfile)..."
  pnpm install --frozen-lockfile
  log_info "Typecheck, lint e testes..."
  pnpm typecheck
  pnpm lint

  # Fase de testes: delimitada por banner e espelhada em arquivo próprio,
  # para que fixtures ('temporary B3 outage', 'dashboard writer unavailable',
  # 'B3 Testnet HTTP 400 (-1021)') nunca sejam lidas como incidentes de produção.
  test_log_start
  local test_status=0
  set +e
  NODE_ENV=test pnpm test 2>&1 | tee -a "${TEST_LOG_FILE}"
  test_status=${PIPESTATUS[0]}
  set -e
  test_log_end "${test_status}"

  if [ "${test_status}" -ne 0 ]; then
    log_error "Suíte de testes falhou (código ${test_status}). Abortando por segurança financeira."
    exit "${test_status}"
  fi

  pnpm build
}

# Build da imagem de um serviço
build_service() {
  local service="$1"
  if [ "${service}" = "postgres" ]; then
    log_info "Serviço 'postgres' usa imagem pronta: baixando/atualizando (docker compose pull)..."
    if (cd "${REPO_ROOT}" && docker compose pull postgres); then
      log_success "Imagem do 'postgres' atualizada."
    else
      # Se falhar a rede/DNS (ex: timeout do Docker Hub), mas a imagem já existir localmente, reutiliza com segurança
      if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^postgres:17-alpine$'; then
        log_warn "Falha ao baixar imagem remota do Docker Hub (rede/DNS indisponível), mas 'postgres:17-alpine' já existe localmente. Prosseguindo..."
      else
        log_error "Falha ao baixar imagem do 'postgres' e nenhuma versão local foi encontrada."
        exit 1
      fi
    fi
    return 0
  fi
  log_info "Construindo imagem do serviço '${service}'..."
  (cd "${REPO_ROOT}" && docker compose build "${service}")
  log_success "Build de '${service}' concluído."
}

# Garante o PostgreSQL saudável (dependência de api e worker)
ensure_postgres() {
  log_info "Garantindo PostgreSQL em execução..."
  (cd "${REPO_ROOT}" && docker compose up -d --wait postgres)
  log_success "PostgreSQL saudável."
}

# Sobe um serviço isolado (sem recriar dependências) e espera ficar saudável
deploy_service() {
  local service="$1"
  if [ "${service}" != "postgres" ]; then
    ensure_postgres
  fi
  log_info "Subindo serviço '${service}'..."
  if ! (cd "${REPO_ROOT}" && docker compose up -d --no-deps --force-recreate --wait --wait-timeout 120 "${service}"); then
    log_error "Serviço '${service}' não ficou saudável. Logs recentes:"
    (cd "${REPO_ROOT}" && docker compose logs --tail=60 "${service}") || true
    exit 1
  fi
  log_success "Serviço '${service}' em execução e saudável."
}

# Resumo final
show_status() {
  (cd "${REPO_ROOT}" && docker compose ps)
}

# Fluxos completos reutilizados pelos scripts por projeto e pelos scripts gerais
# run_build <servico...>: valida ambiente/código, para o que estiver rodando e constrói a imagem
run_build() {
  validate_tools node pnpm docker
  validate_env_file
  validate_docker_daemon
  local s
  for s in "$@"; do stop_if_running "${s}"; done

  # Só precisa validar TypeScript se houver serviços de aplicação (api/worker)
  local needs_code_validation=false
  for s in "$@"; do
    if [ "${s}" != "postgres" ]; then
      needs_code_validation=true
      break
    fi
  done
  if [ "${needs_code_validation}" = true ]; then
    validate_code
  fi

  for s in "$@"; do build_service "${s}"; done
}

# run_deploy <servico...>: valida ambiente, para o que estiver rodando, builda e sobe cada serviço.
# O volume de dados do PostgreSQL é sempre preservado. Ao reimplantar só o postgres,
# api e worker (que dependem dele) são parados antes e religados depois.
run_deploy() {
  validate_tools node pnpm docker
  validate_env_file
  validate_docker_daemon
  local s dependents=()
  case " $* " in
    *" postgres "*)
      # Se o postgres for o único alvo ou fizer parte dos alvos,
      # api e worker sempre devem estar saudáveis juntos (já que o healthcheck do worker consulta a api).
      for s in worker api; do stop_if_running "${s}"; done
      case " $* " in *" api "*) ;; *) dependents+=("api"); ;; esac
      case " $* " in *" worker "*) ;; *) dependents+=("worker"); ;; esac
      ;;
  esac
  for s in "$@"; do stop_if_running "${s}"; done

  local needs_code_validation=false
  for s in "$@"; do
    if [ "${s}" != "postgres" ]; then
      needs_code_validation=true
      break
    fi
  done
  if [ "${needs_code_validation}" = true ]; then
    validate_code
  fi

  for s in "$@"; do build_service "${s}"; done
  for s in "$@"; do deploy_service "${s}"; done
  for s in "${dependents[@]}"; do deploy_service "${s}"; done

  # Persiste a saída real de runtime de cada serviço em <ts>-<serviço>-runtime-log.txt.
  # Snapshot não bloqueante (sem `-f`); acompanhamento contínuo é opt-in e limitado.
  local runtime_targets=("$@" "${dependents[@]}")
  capture_runtime_logs "${runtime_targets[@]}"
  follow_runtime_logs "${runtime_targets[@]}"

  show_status
  log_success "Deploy concluído: $*"
}
