#!/usr/bin/env bash
# ==============================================================================
# run-all.sh - Executa BUILD e DEPLOY completos com terminal interativo
# Permite acionamento via terminal ou com 2 cliques na interface gráfica.
# Mantém o terminal aberto ao final para inspeção e diagnóstico de erros.
# Projeto: bolinha-trader
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AMBIENTE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCS_DIR="$(cd "${AMBIENTE_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DOCS_DIR}/.." && pwd)"

# Se não estiver rodando dentro de um terminal interativo (ex: duplo-clique no gerenciador de arquivos),
# detecta e abre o emulador de terminal disponível para exibir a execução completa.
if [ ! -t 0 ] || [ ! -t 1 ]; then
  TERMINAL_CMD=""
  if command -v mate-terminal >/dev/null 2>&1; then
    TERMINAL_CMD="mate-terminal --title=\"Bolinha Trader - Build & Deploy\" --"
  elif command -v gnome-terminal >/dev/null 2>&1; then
    TERMINAL_CMD="gnome-terminal --title=\"Bolinha Trader - Build & Deploy\" --"
  elif command -v x-terminal-emulator >/dev/null 2>&1; then
    TERMINAL_CMD="x-terminal-emulator -e"
  elif command -v xterm >/dev/null 2>&1; then
    TERMINAL_CMD="xterm -title \"Bolinha Trader - Build & Deploy\" -e"
  fi

  if [ -n "${TERMINAL_CMD}" ]; then
    eval exec ${TERMINAL_CMD} bash -l -c "\"${BASH_SOURCE[0]}\"; exec bash"
  fi
fi

# Carrega ambiente NVM / PNPM / Docker caso ainda não estejam no PATH da sessão
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  source "${HOME}/.nvm/nvm.sh" 2>/dev/null || true
fi
export PATH="${HOME}/.nvm/versions/node/$(ls "${HOME}/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:/snap/bin:${HOME}/.local/bin:${PATH}"

cd "${REPO_ROOT}"

# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

init_logging "BUILD + DEPLOY completo (postgres + api + worker)" "all"

# Função para pausar a tela antes de fechar o terminal
pause_on_finish() {
  local code=$?
  echo ""
  echo "========================================================================"
  if [ "${code}" -eq 0 ]; then
    echo -e "\033[1;32m🎉 [bolinha-trader] Build e Deploy concluídos com SUCESSO!\033[0m"
  else
    echo -e "\033[1;31m⚠️  [bolinha-trader] O processo terminou com ERRO (código: ${code}).\033[0m"
    echo -e "\033[1;33mConsulte as linhas acima ou o arquivo de log para identificar o problema.\033[0m"
  fi
  echo "========================================================================"
  echo -n "Pressione [ENTER] para fechar esta janela..."
  read -r _ < /dev/tty 2>/dev/null || read -r _ || true
  exit "${code}"
}

# Registra o trap de pausa para execução mesmo em caso de erro (set -e)
trap pause_on_finish EXIT

log_info "Etapa 1/2: Iniciando BUILD de todos os serviços (postgres, api, worker)..."
run_build postgres api worker

log_info "Etapa 2/2: Iniciando DEPLOY de todos os serviços (postgres, api, worker)..."
# Executa deploy_service para cada componente já que o build e validações foram realizados
deploy_service postgres
deploy_service api
deploy_service worker

show_status
log_success "Build e Deploy de todos os serviços finalizados com sucesso!"
