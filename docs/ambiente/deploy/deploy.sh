#!/usr/bin/env bash
# ==============================================================================
# DEPLOY completo (postgres + api + worker)
# Projeto: bolinha-trader
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

init_logging "DEPLOY completo (postgres + api + worker)" "all"
run_deploy postgres api worker
