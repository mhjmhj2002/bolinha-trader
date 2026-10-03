# Relatórios

## Objetivo

Interpretar o relatório diário produzido por `pnpm trading:report:today`, `GET /reports/today` ou `GET /reports/daily/:date`.

O relatório delimita sessão por `trading_sessions.started_at` e `finished_at`; decisões, IA, ordens, trades e eventos fora dessa janela não entram. **Banca** é inicial/final conceitual; resultado líquido é P/L líquido persistido e retorno é sua variação sobre a banca inicial. BUY, SELL, HOLD e rejeitadas pelo risco contam decisões; chamadas, fallbacks, modelos, tokens e custos são uso da IA.

Decision cycles esperados consideram a ativação real e slots até `stopNewPositionsTime`; executados contam mercado → IA → risco → decisão; perdidos são a diferença. Operational checks, force-close attempts e reconciliações são contadores distintos. Também aparecem erros, reinícios do worker, maior intervalo entre ciclos, estado final da posição e `daily result` (`PENDING`, `OK` ou `ERROR`).

`CONCLUÍDA` exige sessão `FINISHED`, resultado `OK`, banca final e ausência de posição; do contrário é `EM ANDAMENTO` ou `INCOMPLETA`. Resultado operacional é **OK** sem diagnósticos, **ATENÇÃO** com warnings (por exemplo fallback, ciclo perdido, reinício, rejeição de risco) e **CRÍTICO** com erro: posição após fim, ordem pendente, inconsistência, P/L divergente, erro Binance ou consolidação impossível. Um HOLD seguro por erro OpenRouter gera evidência/atenção, não erro crítico por si só.
