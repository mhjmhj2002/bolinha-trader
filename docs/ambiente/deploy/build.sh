#!/usr/bin/env bash
# ==============================================================================
# BUILD completo (postgres + api + worker)
# Projeto: bolinha-trader
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

init_logging "BUILD completo (postgres + api + worker)" "all"
run_build postgres api worker
