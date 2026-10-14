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

  # Duplica stdout e stderr para o arquivo de log e para os descritores de terminal originais
  exec 3>&1 4>&2
  exec > >(tee -a "${LOG_FILE}") 2>&1
  echo "========================================================================"
  echo "🚀 [bolinha-trader] Iniciando: ${script_name}"
  echo "🕒 Data/Hora: $(date +'%Y-%m-%d %H:%M:%S %Z')"
  echo "📁 Repositório: ${REPO_ROOT}"
  echo "📄 Log de saída: ${LOG_FILE}"
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
  echo "📄 Log salvo em: ${LOG_FILE:-${LOG_DIR}}"
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

# Valida código (install, typecheck, testes, build TS) apenas para serviços Node/TS
validate_code() {
  cd "${REPO_ROOT}"
  log_info "Instalando dependências (pnpm install --frozen-lockfile)..."
  pnpm install --frozen-lockfile
  log_info "Typecheck, lint e testes..."
  pnpm typecheck
  pnpm lint
  NODE_ENV=test pnpm test
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
  show_status
  log_success "Deploy concluído: $*"
}
