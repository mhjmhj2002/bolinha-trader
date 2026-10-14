#!/usr/bin/env bash
# ==============================================================================
# BUILD postgres
# Projeto: bolinha-trader
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "${SCRIPT_DIR}/../common.sh"

init_logging "BUILD postgres" "postgres"
run_build postgres
