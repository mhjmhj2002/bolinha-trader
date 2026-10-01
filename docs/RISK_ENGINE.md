# Motor de risco

É determinístico e não pode ser modificado pelo modelo. Só aceita Spot Testnet, uma posição BTC, sem short. BUY com posição, SELL sem posição, ordem pendente/duplicada, valor inválido ou abaixo de `minNotional`/`minQty` são HOLD com motivo persistido. O valor é limitado pelo caixa conceitual e `MAX_POSITION_PERCENT`; nunca é aumentado. Quantidade é arredondada para baixo pelo `stepSize` da Binance.
