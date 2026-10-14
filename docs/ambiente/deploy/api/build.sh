#!/usr/bin/env bash
# ==============================================================================
# BUILD api
# Projeto: bolinha-trader
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "${SCRIPT_DIR}/../common.sh"

init_logging "BUILD api" "api"
run_build api
