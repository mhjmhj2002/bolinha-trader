#!/usr/bin/env bash
# ==============================================================================
# reset-trades.sh - Limpa trades/ordens/decisões/snapshots e zera o caixa para
# R$ 100,00 para um novo teste. Preserva a configuração operacional.
# Duplo clique: bolinha-trader-reset.desktop
# ==============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
export PATH="/snap/bin:${HOME}/.local/bin:${PATH}"
cd "${REPO_ROOT}"

CAIXA_INICIAL="${CAIXA_INICIAL:-100}"

pause_on_finish() {
  local code=$?
  echo ""
  echo "========================================================================"
  if [ "${code}" -eq 0 ]; then
    echo "✅ Ambiente limpo. Caixa = R$ ${CAIXA_INICIAL}. Pronto para novo teste."
  else
    echo "⚠️  Falha ao limpar o ambiente (código: ${code}). Nada foi alterado parcialmente (transação)."
  fi
  echo "========================================================================"
  echo -n "Pressione [ENTER] para fechar..."
  read -r _ < /dev/tty 2>/dev/null || read -r _ || true
  exit "${code}"
}
trap pause_on_finish EXIT

echo "⚠️  Isto APAGA trades, ordens, posições, decisões de IA, snapshots, eventos e sessões."
echo "    A configuração operacional é mantida. Caixa/banco inicial será R$ ${CAIXA_INICIAL}."
echo -n "Digite 'sim' para continuar: "
read -r CONFIRM < /dev/tty 2>/dev/null || read -r CONFIRM
[ "${CONFIRM}" = "sim" ] || { echo "Cancelado."; exit 1; }

echo "Parando worker (evita gravar durante a limpeza)..."
docker compose stop worker >/dev/null 2>&1 || true

echo "Limpando tabelas..."
docker compose up -d postgres >/dev/null
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U bolinha -d bolinha <<SQL
BEGIN;
TRUNCATE TABLE trade_fees, order_fills, trades, orders, positions, ai_usage, ai_decisions,
  market_snapshots, account_snapshots, daily_results, trading_sessions,
  system_events, worker_heartbeats RESTART IDENTITY CASCADE;
DELETE FROM trading_account;
INSERT INTO trading_account (initial_bank_usdt, cash_usdt, realized_pnl_usdt, ai_cost_usd)
  VALUES (${CAIXA_INICIAL}, ${CAIXA_INICIAL}, 0, 0);
COMMIT;
SQL

echo "Reiniciando worker..."
docker compose up -d worker >/dev/null 2>&1 || true
