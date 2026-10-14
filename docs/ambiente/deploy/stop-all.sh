#!/usr/bin/env bash
# ==============================================================================
# stop-all.sh - Para e encerra o projeto completo (postgres + api + worker)
# Permite acionamento via terminal ou com 2 cliques na interface gráfica.
# Mantém o terminal aberto ao final para confirmação.
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
    TERMINAL_CMD="mate-terminal --title=\"Bolinha Trader - Parar Projeto\" --"
  elif command -v gnome-terminal >/dev/null 2>&1; then
    TERMINAL_CMD="gnome-terminal --title=\"Bolinha Trader - Parar Projeto\" --"
  elif command -v x-terminal-emulator >/dev/null 2>&1; then
    TERMINAL_CMD="x-terminal-emulator -e"
  elif command -v xterm >/dev/null 2>&1; then
    TERMINAL_CMD="xterm -title \"Bolinha Trader - Parar Projeto\" -e"
  fi

  if [ -n "${TERMINAL_CMD}" ]; then
    eval exec ${TERMINAL_CMD} bash -l -c "\"${BASH_SOURCE[0]}\"; exec bash"
  fi
fi

# Carrega ambiente Snap/Docker caso ainda não estejam no PATH da sessão
export PATH="/snap/bin:${HOME}/.local/bin:${PATH}"

cd "${REPO_ROOT}"

# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

init_logging "PARAR completo (postgres + api + worker)" "stop"

# Função para pausar a tela antes de fechar o terminal
pause_on_finish() {
  local code=$?
  echo ""
  echo "========================================================================"
  if [ "${code}" -eq 0 ]; then
    echo -e "\033[1;32m🛑 [bolinha-trader] Todos os serviços foram PARADOS com sucesso!\033[0m"
  else
    echo -e "\033[1;31m⚠️  [bolinha-trader] Ocorreu um erro ao parar os serviços (código: ${code}).\033[0m"
  fi
  echo "========================================================================"
  echo -n "Pressione [ENTER] para fechar esta janela..."
  read -r _ < /dev/tty 2>/dev/null || read -r _ || true
  exit "${code}"
}

trap pause_on_finish EXIT

log_info "Interrompendo todos os serviços Docker Compose (down)..."
docker compose down

log_info "Verificando se restou algum contêiner ativo..."
docker compose ps

log_success "Projeto bolinha-trader totalmente encerrado."
