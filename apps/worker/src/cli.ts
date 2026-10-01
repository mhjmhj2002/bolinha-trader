import { TradingService } from './service.js';
import { config, localTime, sessionPhase } from '@bolinha/core';
import { TradingRepository } from '@bolinha/database';
const service = new TradingService();
const command = process.argv[2];
const money = (value: number) => value.toFixed(8);
if (command === 'once') console.log(JSON.stringify(await service.runOnce()));
else if (command === 'force-close') console.log(JSON.stringify(await service.forceClosePosition()));
else if (command === 'status' || command === 'day-test-check') {
  const repo = new TradingRepository(); await repo.ensureAccount(config.INITIAL_BANK_USDT);
  const [account, position, state, daily] = await Promise.all([repo.account(), repo.openPosition(), repo.session(), repo.dailyResult()]);
  const output = { loopEnabled: config.TRADING_LOOP_ENABLED, phase: sessionPhase(), time: `${localTime()} ${config.TRADING_TIMEZONE}`, lastCycleAt: state?.last_cycle_at ?? null, nextCycleAt: state?.next_cycle_at ?? null, bank: account.cashUsdt, position, pnlToday: account.realizedPnlUsdt, aiCostToday: daily?.ai_cost_usd ?? 0, errorsToday: daily?.error_count ?? 0 };
  if (command === 'status') console.log(JSON.stringify(output, null, 2));
  else console.log(`Operação Bolinha de Gude\nLoop: ${output.loopEnabled ? 'ON' : 'OFF'}\nPhase: ${output.phase}\nTime: ${output.time}\nLast cycle: ${output.lastCycleAt ?? '—'}\nNext cycle: ${output.nextCycleAt ?? '—'}\nBank: ${output.bank.toFixed(2)} USDT\nPosition: ${output.position ? `BTC ${output.position.quantity}` : 'none'}\nP/L today: ${output.pnlToday.toFixed(2)}\nAI cost today: ${output.aiCostToday}\nErrors today: ${output.errorsToday}`);
}
else if (command === 'smoke-testnet') {
  const result = await service.smokeTestTestnet();
  console.log(
    `SMOKE TESTNET\nInitial cash: ${money(result.initialCashUsdt)} USDT\n\nBUY\nrequested: ${money(result.requestedUsdt)} USDT\nexecuted BTC: ${result.buyQuantity}\ncost: ${money(result.buyCostUsdt)} USDT\ncash after buy: ${money(result.cashAfterBuy)} USDT\nposition persisted: OK\n\nSELL\nBTC sold: ${result.sellQuantity}\nreceived: ${money(result.sellReceivedUsdt)} USDT\ntrade P/L: ${money(result.tradePnlUsdt)} USDT\ncash after sell: ${money(result.cashAfterSell)} USDT\nposition closed: OK\n\nDatabase: OK\nEvents: OK\nSMOKE TEST PASSED`,
  );
} else throw new Error('Use: once | force-close | smoke-testnet | status | day-test-check');
