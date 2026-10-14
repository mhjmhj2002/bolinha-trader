#!/usr/bin/env bash
# ==============================================================================
# DEPLOY api
# Projeto: bolinha-trader
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "${SCRIPT_DIR}/../common.sh"

init_logging "DEPLOY api" "api"
run_deploy api
