# Motor de risco

## Objetivo

Documentar as regras determinísticas que convertem sugestão em ordem ou HOLD. A IA não controla estas regras; veja [IA](09_IA_E_OPENROUTER.md).

O motor recebe decisão, preço, conta e posição conceituais, filtros Binance e `maxPositionPercent`. Ele pode transformar qualquer solicitação em `HOLD` com motivo persistido.

- Spot Testnet `BTCUSDT`, sem short ou leverage;
- uma posição conceitual: BUY com posição e SELL sem posição são bloqueados;
- ordem pendente/duplicada bloqueia;
- BUY exige valor positivo, limita-se ao caixa × limite e respeita `minNotional`;
- quantidade é arredondada para baixo no `stepSize` e precisa respeitar `minQty`/notional;
- SELL ignora valor da IA e fecha 100% da posição conceitual, somente se alinhada ao `stepSize`;
- cutoff bloqueia BUY novamente antes da submissão.

Filtros vêm de `exchangeInfo` da Testnet, não são fixos no projeto. Force close usa o mesmo motor e nunca vende BTC extra da conta Testnet.
