# Dashboard e páginas web

## Objetivo

Explicar as duas páginas entregues pela API e seus dados. A API correspondente está em [API HTTP](12_API_HTTP.md).

`/dashboard` é o painel operacional. Mostra faixa de saúde, banca, P/L, posição, trades, custo/tokens de IA e erros/fallbacks. Seus gráficos exibem evolução da banca, distribuição de decisões, P/L acumulado e modelos; as tabelas mostram trades, decisões e eventos. A timeline resume a sessão e a consolidação. Filtro de data permite leitura histórica sem consultar integrações externas: para uma data passada, `/dashboard/data` usa apenas PostgreSQL e marca saúde como `HISTORICAL`.

`/dashboard/configuration` edita fuso, janela, intervalo, banca e limite de posição. Informa fase, loop e atualização. Campos e botão ficam indisponíveis quando a API disser que não é editável; o motivo vem do mesmo endpoint de configuração e uma corrida de estado ainda recebe 409 no salvamento.

As páginas são HTML/JS estáticos com Bootstrap e Chart.js via CDN. O JavaScript consulta `/dashboard/data`; a atualização automática e a seleção de data acontecem no navegador. Não há SPA, login ou edição de trading na interface.
