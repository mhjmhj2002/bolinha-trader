# Configuração operacional

## Objetivo

Separar segredo de parâmetro de trading. Veja [API](12_API_HTTP.md) e [lifecycle](07_TRADING_LIFECYCLE.md).

`.env` contém `DATABASE_URL`, chaves Binance/OpenRouter, `BINANCE_ENV`, host/porta, modelos e kill switch `TRADING_LOOP_ENABLED`. A tabela `trading_configuration` guarda a configuração ativa:

| Campo | Significado |
| --- | --- |
| `timezone` | fuso IANA |
| `startTime` | início de `TRADING` |
| `stopNewPositionsTime` | bloqueio de novos BUY |
| `forceCloseTime` | início de force close |
| `endTime` | encerramento normal |
| `intervalSeconds` | slots do scheduler |
| `initialBankUsdt` | banca conceitual inicial |
| `maxPositionPercent` | teto do caixa por BUY |

Horários são estritamente ordenados; intervalo e banca são positivos; o limite vai de 0 a 100. A configuração é singleton (`id=1`); cada mudança cria versão em `trading_configuration_versions`, e a sessão recebe um snapshot em `trading_sessions`.

Use `/dashboard/configuration` ou `PUT /configuration`. Edição é bloqueada durante trading, com posição/ordem ambígua ou reconciliação inadequada; retorna HTTP 409 com motivo. `TRADING_LOOP_ENABLED=false` é independente e impede os ciclos agendados.
