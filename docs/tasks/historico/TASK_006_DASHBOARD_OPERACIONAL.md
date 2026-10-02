# TASK_006 — Dashboard operacional da Operação Bolinha de Gude

## Objetivo

Criar um dashboard web simples, bonito e funcional para acompanhar a
Operação Bolinha de Gude.

O dashboard deve usar exclusivamente evidências persistidas pela aplicação
e os endpoints da API.

Não consultar PostgreSQL diretamente pelo browser.

Não criar SPA complexa.
Não usar React/Vue/Angular nesta fase.

Stack desejada:

- Bootstrap 5
- Chart.js
- HTML/CSS/TypeScript ou JavaScript simples
- servido pela própria aplicação Fastify

Objetivo principal:

Abrir:

http://localhost:3000/dashboard

e entender em poucos segundos:

- se o sistema está funcionando;
- se o loop está ativo;
- fase atual da sessão;
- banca;
- posição;
- lucro/prejuízo;
- decisões da IA;
- operações;
- modelos utilizados;
- erros/fallbacks;
- comportamento ao longo do dia.

==================================================
1. PÁGINA PRINCIPAL
==================================================

Criar:

GET /dashboard

Dashboard responsivo e utilizável em:

- notebook;
- tablet;
- celular.

Usar Bootstrap.

Visual limpo, estilo painel operacional.

Não exagerar em animações ou componentes.

==================================================
2. CABEÇALHO / STATUS
==================================================

No topo mostrar:

Operação Bolinha de Gude

Data da sessão.

Badge geral:

- RUNNING
- WAITING
- FORCE CLOSE
- FINISHED
- DEGRADED
- ERROR

Mostrar também:

- horário atual America/Sao_Paulo;
- loop ON/OFF;
- fase da sessão;
- último ciclo;
- próximo ciclo;
- worker UP/DOWN/STALE;
- Binance UP/DOWN;
- OpenRouter UP/DOWN;
- PostgreSQL UP/DOWN;
- estado da reconciliação.

Usar cores Bootstrap semanticamente:

success
warning
danger
secondary

==================================================
3. CARDS PRINCIPAIS
==================================================

Primeira linha com cards grandes:

BANCA ATUAL
ex:
20.34 USDT

RESULTADO DO DIA
ex:
+0.34 USDT
+1.70%

POSIÇÃO
ex:
BTC 0.000071
ou
SEM POSIÇÃO

TRADES
ex:
6

CUSTO IA
ex:
US$ 0.0021

ERROS
ex:
0

Quando possível mostrar também pequeno comparativo:

Banca inicial: 20.00

==================================================
4. GRÁFICO PRINCIPAL — EVOLUÇÃO DA BANCA
==================================================

Criar gráfico de linha:

Patrimônio ao longo do dia.

Eixo X:
horário.

Eixo Y:
USDT.

Usar dados persistidos de account_snapshots / snapshots equivalentes.

Mostrar:

- patrimônio;
- opcionalmente caixa.

Se ainda não houver snapshots financeiros suficientes, implementar a captura
necessária sem criar polling excessivo.

Cada ciclo do worker pode persistir o patrimônio daquele instante.

==================================================
5. GRÁFICO DE P/L
==================================================

Gráfico mostrando evolução acumulada do P/L durante a sessão.

Pode ser linha.

Mostrar:

- P/L realizado;
- P/L total quando houver posição.

==================================================
6. DECISÕES DA IA
==================================================

Criar gráfico de distribuição:

BUY
SELL
HOLD

Pode usar doughnut/pie Chart.js.

Mostrar quantidade e percentual.

Também mostrar:

Decisões rejeitadas pelo motor de risco.

==================================================
7. MODELOS DE IA
==================================================

Mostrar uso por modelo.

Exemplo:

Nemotron      20 chamadas
Qwen          12
Laguna         8
Gemma          3

Mostrar também:

- quantidade de fallbacks;
- tokens;
- custo por modelo quando disponível.

Criar gráfico de barras.

Usar `model_returned` como modelo realmente responsável pela decisão.

==================================================
8. TRADES
==================================================

Tabela dos trades do dia.

Colunas:

- horário;
- lado BUY/SELL;
- quantidade BTC;
- preço médio;
- valor USDT;
- taxa;
- P/L quando aplicável;
- ordem Binance.

BUY com badge verde/azul.

SELL com badge apropriado.

Não exibir secrets.

==================================================
9. DECISÕES RECENTES
==================================================

Tabela das últimas decisões.

Colunas:

- horário;
- modelo;
- ação solicitada;
- ação após risk-engine;
- valor;
- confiança;
- motivo;
- rejeição quando houver.

Destacar visualmente quando:

IA pediu BUY
mas risk-engine virou HOLD.

Isso é importante para auditoria.

==================================================
10. EVENTOS / INCIDENTES
==================================================

Criar painel "Eventos".

Mostrar prioritariamente:

ERROR
WARN

Exemplos:

- Binance indisponível;
- OpenRouter 429;
- fallback;
- reconciliação;
- ordem rejeitada;
- worker restart;
- force close;
- ciclo perdido;
- posição inconsistente.

Permitir visualizar INFO opcionalmente.

==================================================
11. SAÚDE DO SISTEMA
==================================================

Criar seção:

Sistema

Exemplo:

Worker             UP
PostgreSQL         UP
Binance            UP
OpenRouter         UP
Reconciliação      OK
Pending orders     0
Último heartbeat   10s atrás
Último ciclo       3m atrás
Próximo ciclo      7m

Se algo estiver degradado, ficar visualmente evidente.

==================================================
12. SESSÃO DO DIA
==================================================

Mostrar timeline simples:

09:00
START

17:50
STOP BUY

17:55
FORCE CLOSE

18:00
END

Destacar em qual fase estamos.

Usar America/Sao_Paulo.

==================================================
13. RESULTADO DO DIA
==================================================

Quando sessão estiver FINISHED mostrar uma área de resumo:

RESULTADO FINAL

Banca inicial
Banca final
Resultado líquido
Retorno %
Trades
BUY
SELL
HOLD
Taxas
Custo IA
Fallbacks
Erros
Force close ocorreu?
Posição final aberta?

Resultado operacional:

OK
ATENÇÃO
ERRO

Usar dados do daily_results / relatório operacional.

==================================================
14. ATUALIZAÇÃO AUTOMÁTICA
==================================================

Dashboard deve se atualizar automaticamente.

Sugestão:

a cada 30 segundos.

Não recarregar a página inteira.

Buscar JSON via API e atualizar cards/gráficos/tabelas.

Exibir:

Última atualização: HH:mm:ss

Se API parar de responder:

mostrar claramente:

CONEXÃO PERDIDA

Não continuar exibindo silenciosamente dados antigos como se fossem atuais.

==================================================
15. FILTRO DE DATA
==================================================

Permitir escolher:

Hoje

ou uma data anterior.

Quando selecionar dia passado:

dashboard vira histórico daquele dia.

Não precisa auto-refresh para dias históricos.

O histórico deve vir exclusivamente do PostgreSQL.

==================================================
16. ENDPOINTS PARA DASHBOARD
==================================================

Preferir reutilizar endpoints existentes.

Criar endpoints adicionais somente quando necessário.

Pode ser criado um agregador:

GET /dashboard/data?date=YYYY-MM-DD

Resposta sugerida:

{
  "health": {...},
  "session": {...},
  "account": {...},
  "performance": {...},
  "position": {...},
  "decisions": [...],
  "trades": [...],
  "aiUsage": {...},
  "events": [...],
  "equityHistory": [...]
}

Isso reduz quantidade de requests do browser.

Separar DTO do banco.

Não retornar raw_response gigantesco no dashboard principal.

==================================================
17. SEGURANÇA
==================================================

Neste momento o dashboard será local.

Continuar bind:

127.0.0.1

Não expor publicamente.

Não criar autenticação ainda.

Preparar arquitetura para adicionar autenticação quando for para o VPS.

Nunca retornar:

- BINANCE_API_SECRET;
- BINANCE_API_KEY;
- OPENROUTER_API_KEY;
- DATABASE_URL.

Não incluir secrets em HTML, JS ou responses.

==================================================
18. ORGANIZAÇÃO DO FRONTEND
==================================================

Manter simples.

Sugestão:

apps/api/public/dashboard/
  index.html
  dashboard.js
  dashboard.css

ou estrutura equivalente.

Não criar pipeline frontend enorme.

Bootstrap e Chart.js podem ser instalados via dependência ou assets adequados.

Preferir solução que continue funcionando de forma previsível no VPS.

==================================================
19. RESPONSIVIDADE
==================================================

No celular:

cards devem empilhar.

Gráficos devem ajustar largura.

Tabelas devem permitir scroll horizontal.

Dashboard precisa continuar utilizável pelo navegador do celular.

Isso será importante quando a aplicação estiver no VPS.

==================================================
20. TESTES
==================================================

Adicionar testes pelo menos para:

- endpoint dashboard/data;
- dia sem operações;
- dia com posição;
- dia finalizado;
- eventos de erro;
- agregação BUY/SELL/HOLD;
- modelos utilizados;
- P/L;
- ausência de secrets no payload.

Não precisa teste visual pixel-perfect.

==================================================
21. DOCUMENTAÇÃO
==================================================

Atualizar README.

Adicionar:

docs/DASHBOARD.md

Explicar:

- como acessar;
- origem de cada indicador;
- frequência de atualização;
- interpretação dos status;
- histórico;
- limitações atuais.

==================================================
22. NÃO FAZER

Não:

- usar React;
- usar Vue;
- usar Angular;
- adicionar Next.js;
- criar autenticação complexa agora;
- provisionar VPS;
- expor dashboard na internet;
- habilitar Binance produção;
- alterar estratégia de trading;
- habilitar loop automaticamente.

Manter:

TRADING_LOOP_ENABLED=false

ao finalizar a task.

==================================================
23. VALIDAÇÃO

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build

docker compose up -d --build

Validar:

http://localhost:3000/dashboard

e:

GET /dashboard/data

Confirmar:

- dashboard renderiza;
- banco alimenta gráficos;
- nenhuma chave aparece;
- atualização automática funciona;
- histórico funciona;
- layout celular funciona razoavelmente;
- loop continua OFF.

==================================================
24. ENTREGA FINAL

Informar:

1. estrutura criada;
2. URL do dashboard;
3. endpoints adicionados;
4. gráficos criados;
5. cards criados;
6. histórico disponível;
7. atualização automática;
8. testes executados;
9. confirmação de ausência de secrets;
10. confirmação de loop OFF.