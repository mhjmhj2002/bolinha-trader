# Binance Testnet

## Objetivo

Delimitar mercado e execução. Veja [reconciliação](16_RECONCILIACAO_E_RECUPERACAO.md).

Dados públicos reais vêm de `api.binance.com` (`klines`, ticker e ping); ordens assinadas usam somente `https://testnet.binance.vision`. O core aceita exclusivamente `BINANCE_ENV=testnet`, recusando produção. Use chaves Spot Testnet em `.env`.

As ordens são `MARKET` com `newClientOrderId` UUID. Antes do envio, o projeto lê `MARKET_LOT_SIZE`/`LOT_SIZE` e `NOTIONAL`/`MIN_NOTIONAL` para respeitar `minQty`, `stepSize` e `minNotional`. Fills e taxas são persistidos. Query Order pelo client ID, mais `myTrades`, recupera execução após crash.

Saldo Testnet **não é banca conceitual**. Nunca atribua BTC total da conta à Bolinha: PostgreSQL delimita ordens e posição registradas pela experiência. Binance é autoridade sobre ordem enviada; o ledger é autoridade sobre o escopo conceitual.
