# TASK_011 — Documentação completa e organizada do projeto Bolinha Trader

## Objetivo

Reorganizar e completar toda a documentação técnica e operacional do projeto `bolinha-trader`.

A documentação deve permitir que uma pessoa que nunca viu o projeto consiga:

1. entender o que é a Operação Bolinha de Gude;
2. entender a arquitetura;
3. entender a stack;
4. entender como os componentes conversam;
5. configurar o ambiente;
6. subir o projeto;
7. executar testes;
8. operar o sistema;
9. entender o dashboard;
10. entender os relatórios;
11. entender o fluxo de trading;
12. entender motor de risco;
13. entender persistência e banco;
14. entender OpenRouter/IA;
15. entender Binance Testnet;
16. entender observabilidade;
17. diagnosticar problemas;
18. entender decisões arquiteturais;
19. evoluir o projeto futuramente.

O README da raiz deve funcionar como o ÍNDICE DE UM LIVRO.

Os capítulos devem estar em `docs/`.

IMPORTANTE:

- usar o código atual como fonte de verdade;
- não documentar comportamento imaginado;
- não copiar documentação antiga sem validar contra o código;
- atualizar ou substituir documentação desatualizada;
- preservar informações históricas úteis;
- não incluir secrets;
- não habilitar Binance produção;
- não alterar comportamento funcional do projeto nesta task.

==================================================
1. PRINCÍPIO EDITORIAL
==================================================

A documentação deve ser escrita como um conjunto coerente de capítulos.

Evitar:

- documentos soltos sem relação;
- repetição da mesma informação em cinco arquivos;
- README gigantesco;
- documentação que apenas repete nomes de classes;
- exemplos que não funcionam;
- comandos antigos;
- caminhos inexistentes;
- descrição de features não implementadas.

Preferir:

README
→ índice

docs/
→ capítulos especializados

Cada documento deve ter:

- objetivo;
- contexto;
- conteúdo;
- links para documentos relacionados quando necessário.

Usar Português do Brasil.

Termos técnicos e nomes de código podem continuar em inglês.

==================================================
2. README COMO ÍNDICE DO LIVRO
==================================================

Reescrever o `README.md` da raiz.

Ele NÃO deve conter toda a documentação.

Deve funcionar como porta de entrada.

Estrutura sugerida:

# Bolinha Trader

Breve descrição:

Operação Bolinha de Gude é um experimento de trading autônomo baseado em:

- Binance Spot Testnet;
- IA via OpenRouter;
- motor de risco determinístico;
- PostgreSQL como ledger conceitual;
- worker autônomo;
- observabilidade;
- dashboard web;
- relatórios operacionais.

Deixar claramente destacado:

> O projeto opera somente em Binance Spot Testnet nesta fase.
> Não opera dinheiro real.

Depois criar uma seção:

## Documentação

Com links organizados para todos os capítulos.

Exemplo conceitual:

1. Visão geral
2. Arquitetura
3. Stack
4. Setup
5. Execução
6. Configuração
7. Trading lifecycle
8. Motor de risco
9. IA
10. Binance
11. Banco
12. Dashboard
13. Relatórios
14. Observabilidade
15. Segurança
16. Testes
17. Troubleshooting
18. Runbook
19. Deploy
20. Decisões arquiteturais

README deve também conter uma seção curta:

## Quick Start

Somente os comandos mínimos.

Detalhamento fica em docs.

==================================================
3. ESTRUTURA DOS DOCUMENTOS
==================================================

Organizar `docs/` com prefixos numéricos para facilitar leitura.

Criar ou reorganizar para algo próximo de:

docs/

  01_VISAO_GERAL.md

  02_ARQUITETURA.md

  03_STACK_TECNOLOGICA.md

  04_SETUP_LOCAL.md

  05_EXECUCAO_DO_PROJETO.md

  06_CONFIGURACAO_OPERACIONAL.md

  07_TRADING_LIFECYCLE.md

  08_MOTOR_DE_RISCO.md

  09_IA_E_OPENROUTER.md

  10_BINANCE_TESTNET.md

  11_PERSISTENCIA_E_BANCO.md

  12_API_HTTP.md

  13_DASHBOARD_E_PAGINAS_WEB.md

  14_RELATORIOS.md

  15_OBSERVABILIDADE.md

  16_RECONCILIACAO_E_RECUPERACAO.md

  17_SEGURANCA.md

  18_TESTES.md

  19_TROUBLESHOOTING.md

  20_RUNBOOK_OPERACIONAL.md

  21_DEPLOY_E_INFRAESTRUTURA.md

  22_DECISOES_ARQUITETURAIS.md

  23_GLOSSARIO.md

Pode ajustar nomes se houver motivo claro.

Não criar arquivos vazios ou artificiais.

Se algum tema puder ser agrupado com outro sem perder clareza, agrupar.

==================================================
4. VISÃO GERAL
==================================================

`01_VISAO_GERAL.md`

Explicar:

- o problema que o projeto resolve;
- objetivo do experimento;
- conceito da Operação Bolinha de Gude;
- banca conceitual;
- autonomia do worker;
- Testnet;
- papel da IA;
- papel do motor de risco;
- papel do PostgreSQL;
- objetivo do dashboard;
- objetivo dos relatórios.

Explicar claramente a separação:

IA sugere.

Risk Engine autoriza ou bloqueia.

Exchange executa.

PostgreSQL registra.

Dashboard observa.

==================================================
5. ARQUITETURA
==================================================

`02_ARQUITETURA.md`

Documentar arquitetura real.

Componentes:

- API;
- Worker;
- PostgreSQL;
- Binance;
- OpenRouter;
- Risk Engine;
- Market Data;
- Database;
- Dashboard.

Adicionar diagrama Mermaid.

Exemplo conceitual:

Market Data
   ↓
Worker
   ↓
OpenRouter
   ↓
Risk Engine
   ↓
Binance Testnet
   ↓
PostgreSQL

API
   ↓
PostgreSQL
   ↓
Dashboard

Mas criar o diagrama conforme o código real.

Documentar:

- fluxo de dependências;
- limites entre packages/apps;
- monorepo;
- responsabilidades;
- processos separados API/worker;
- Docker Compose.

==================================================
6. STACK TECNOLÓGICA
==================================================

`03_STACK_TECNOLOGICA.md`

Documentar stack real:

- Node.js;
- TypeScript;
- pnpm;
- Fastify;
- PostgreSQL;
- Drizzle;
- Docker;
- Docker Compose;
- Vitest;
- Zod;
- Pino;
- Bootstrap;
- Chart.js;
- APIs externas;
- outras libs relevantes.

Para cada tecnologia explicar:

- onde é usada;
- por que existe no projeto;
- responsabilidade.

Não transformar em tutorial genérico da tecnologia.

==================================================
7. SETUP LOCAL
==================================================

`04_SETUP_LOCAL.md`

Criar um guia completo desde máquina limpa.

Incluir:

- requisitos;
- versões;
- clone;
- pnpm;
- Node;
- Docker;
- `.env`;
- chaves Binance Testnet;
- OpenRouter;
- banco;
- migrations;
- build;
- startup.

Comandos devem ser copiáveis.

Exemplo:

cp .env.example .env

pnpm install

docker compose up -d --build

Mas validar todos os comandos no projeto atual.

Explicar:

- o que precisa ser configurado;
- o que não precisa;
- onde ficam os secrets;
- como verificar se subiu corretamente.

==================================================
8. EXECUÇÃO DO PROJETO
==================================================

`05_EXECUCAO_DO_PROJETO.md`

Explicar os modos:

- API;
- worker;
- run once;
- loop;
- smoke test;
- reconciliation;
- force close;
- finalize today;
- report;
- status;
- day-test-check.

Documentar TODOS os scripts relevantes de `package.json`.

Para cada comando:

- objetivo;
- quando usar;
- risco;
- resultado esperado.

==================================================
9. CONFIGURAÇÃO OPERACIONAL
==================================================

`06_CONFIGURACAO_OPERACIONAL.md`

Documentar o modelo atual.

Explicar separação entre:

`.env`
e
`trading_configuration`.

Secrets ficam no `.env`.

Configuração operacional fica no PostgreSQL.

Documentar:

- timezone;
- startTime;
- stopNewPositionsTime;
- forceCloseTime;
- endTime;
- intervalSeconds;
- initialBankUsdt;
- maxPositionPercent.

Explicar:

- versionamento;
- configuração ativa;
- snapshot da sessão;
- CRUD;
- bloqueio durante trading;
- HTTP 409;
- kill switch `TRADING_LOOP_ENABLED`.

==================================================
10. TRADING LIFECYCLE
==================================================

`07_TRADING_LIFECYCLE.md`

Explicar do início ao fim.

Fases:

- BEFORE_START;
- TRADING;
- NO_NEW_POSITIONS;
- FORCE_CLOSE;
- FORCE_CLOSE_PENDING;
- FINISHED;
- outros estados existentes.

Criar diagrama Mermaid de estados.

Explicar:

- início;
- decision cycle;
- fechamento;
- restart;
- sessão diária;
- consolidação.

==================================================
11. MOTOR DE RISCO
==================================================

`08_MOTOR_DE_RISCO.md`

Documentar regras atuais.

Exemplos:

- Spot only;
- sem leverage;
- sem short;
- uma posição por vez;
- BUY proibido com posição;
- SELL proibido sem posição;
- SELL fecha posição inteira;
- minNotional;
- minQty;
- stepSize;
- banca;
- maxPositionPercent;
- pending orders;
- HOLD seguro;
- cutoff de novas posições.

Explicar:

IA NÃO controla essas regras.

==================================================
12. IA E OPENROUTER
==================================================

`09_IA_E_OPENROUTER.md`

Explicar:

- papel da IA;
- dados recebidos;
- campos normalizados;
- formato BUY/SELL/HOLD;
- confiança;
- motivo;
- fallback;
- timeout;
- custo;
- tokens;
- modelos;
- erro -> HOLD seguro.

Documentar comportamento atual do OpenRouter.

Explicar diferença:

modelo solicitado
vs
modelo efetivamente utilizado.

Não colocar API key.

==================================================
13. BINANCE TESTNET
==================================================

`10_BINANCE_TESTNET.md`

Explicar:

- dados públicos reais;
- execução Testnet;
- API key;
- Spot Testnet;
- clientOrderId;
- filters;
- minNotional;
- minQty;
- stepSize;
- Query Order;
- reconciliação.

Deixar explícito:

saldo Binance Testnet NÃO é a banca conceitual.

PostgreSQL controla a banca da experiência.

Nunca assumir que BTC total da conta pertence à Bolinha.

==================================================
14. PERSISTÊNCIA E BANCO
==================================================

`11_PERSISTENCIA_E_BANCO.md`

Documentar tabelas reais.

Exemplo:

- trading_account;
- positions;
- orders;
- order_fills;
- trades;
- trade_fees;
- ai_decisions;
- ai_usage;
- market_snapshots;
- account_snapshots;
- daily_results;
- trading_sessions;
- system_events;
- worker_heartbeats;
- reconciliation_state;
- trading_configuration;
- versões de configuração;
- outras existentes.

Para cada tabela explicar:

- finalidade;
- dados principais;
- relações.

Criar diagrama Mermaid ER simplificado.

Não copiar schema linha por linha.

Explicar conceitos:

- ledger conceitual;
- idempotência;
- JSONB;
- timestamps UTC;
- configuração por sessão.

==================================================
15. API HTTP
==================================================

`12_API_HTTP.md`

Documentar endpoints existentes.

Por exemplo:

/health
/status
/positions
/trades
/decisions
/performance
/performance/daily
/system/events
/configuration
/dashboard/data
/reports/...
etc.

Usar código atual como fonte.

Para cada endpoint:

- método;
- path;
- objetivo;
- resposta resumida;
- possíveis erros relevantes.

Não inventar endpoint.

==================================================
16. DASHBOARD E PÁGINAS WEB
==================================================

`13_DASHBOARD_E_PAGINAS_WEB.md`

Documentar todas as páginas existentes.

Exemplo:

/dashboard

/dashboard/configuration

Outras páginas existentes.

Explicar o que cada card/gráfico mostra.

Dashboard principal:

- status;
- banca;
- P/L;
- posição;
- trades;
- custo IA;
- erros;
- evolução da banca;
- P/L;
- decisões;
- modelos;
- trades;
- eventos;
- timeline da sessão.

Página de configuração:

- campos;
- editabilidade;
- motivos de bloqueio;
- versionamento.

Documentar atualização automática.

Explicar origem de dados.

==================================================
17. RELATÓRIOS
==================================================

`14_RELATORIOS.md`

Esse documento precisa ser especialmente claro.

Explicar:

`pnpm trading:report:today`

e endpoints equivalentes.

Documentar exatamente o significado de:

Sessão

Banca

Resultado líquido

Retorno

BUY

SELL

HOLD

Rejeitadas pelo risco

Chamadas IA

Fallbacks

Modelos

Tokens

Custos

Decision cycles esperados

Decision cycles executados

Decision cycles perdidos

Operational checks

Force-close attempts

Reconciliações

Erros

Reinícios

Maior intervalo sem ciclo

Estado final

Daily result

Resultado operacional

Explicar critérios:

OK
ATENÇÃO
CRÍTICO

Explicar o que NÃO conta como erro crítico.

Explicar como o relatório respeita a janela real da sessão.

==================================================
18. OBSERVABILIDADE
==================================================

`15_OBSERVABILIDADE.md`

Explicar:

- Pino;
- logs estruturados;
- system_events;
- heartbeat;
- health;
- stale cycles;
- dashboard;
- daily report;
- métricas de IA;
- erros externos;
- fallback;
- eventos de reconciliação.

Criar pequena tabela:

evento
significado
severidade
ação esperada

Documentar como acompanhar:

docker compose logs worker

e outros comandos úteis.

==================================================
19. RECONCILIAÇÃO E RECUPERAÇÃO
==================================================

`16_RECONCILIACAO_E_RECUPERACAO.md`

Explicar cenários:

- crash depois de BUY;
- crash depois de SELL;
- ordem PENDING;
- Query Order;
- FILLED;
- ordem não encontrada;
- Binance indisponível;
- restart;
- idempotência;
- duplicate execution;
- ledger.

Explicar:

PostgreSQL = ledger conceitual.

Binance = autoridade sobre ordens enviadas.

Reconciliação conecta os dois.

==================================================
20. SEGURANÇA
==================================================

`17_SEGURANCA.md`

Documentar:

- Testnet-only;
- secrets;
- `.env`;
- gitignore;
- API local;
- kill switch;
- bloqueio de produção;
- risk-engine;
- configuração bloqueada durante trading;
- ausência de endpoints BUY/SELL arbitrários;
- idempotência;
- reconciliação;
- fechamento obrigatório.

Explicar limitações atuais.

==================================================
21. TESTES
==================================================

`18_TESTES.md`

Explicar:

- Vitest;
- unitários;
- integração;
- PostgreSQL;
- mocks;
- smoke test Testnet;
- testes de lifecycle;
- risk engine;
- reconciliation;
- configuração;
- relatórios;
- dashboard/API.

Comandos:

pnpm test
pnpm lint
pnpm typecheck
pnpm build

Documentar a diferença entre:

teste automatizado
smoke test
teste diário autônomo.

==================================================
22. TROUBLESHOOTING
==================================================

`19_TROUBLESHOOTING.md`

Criar guia baseado em problemas reais já encontrados.

Incluir, se ainda aplicável:

- ECONNREFUSED PostgreSQL;
- Docker;
- worker UP mas sem ciclo;
- cycle stale;
- OpenRouter 429;
- timeout;
- fallback;
- Binance NOTIONAL;
- filtros Binance;
- PENDING order;
- reconciliation ERROR;
- dashboard sem dados;
- daily_result null;
- configuração bloqueada;
- loop OFF;
- sessão FINISHED;
- migrations.

Para cada problema:

Sintoma
Causa provável
Como diagnosticar
Como corrigir

==================================================
23. RUNBOOK OPERACIONAL
==================================================

`20_RUNBOOK_OPERACIONAL.md`

Esse é o manual do operador.

Criar procedimentos objetivos:

### Iniciar operação

### Verificar health

### Verificar status

### Acompanhar dashboard

### Parar loop

### Force close

### Reconciliar

### Finalizar sessão

### Gerar relatório

### Investigar erro

### Reiniciar worker

### Reiniciar Docker

### Atualizar configuração

### Recuperar após crash

### Confirmar ausência de posição

Os comandos devem estar prontos para copiar.

==================================================
24. DEPLOY E INFRAESTRUTURA
==================================================

`21_DEPLOY_E_INFRAESTRUTURA.md`

Documentar ambiente atual:

Docker Compose.

Documentar arquitetura alvo de VPS já prevista no projeto, se ainda válida:

- Akamai/Linode;
- Node;
- PostgreSQL;
- API;
- Worker;
- reverse proxy/Caddy;
- monitoramento.

Separar claramente:

IMPLEMENTADO HOJE

de

PLANEJADO.

Não escrever recurso futuro como se já existisse.

==================================================
25. DECISÕES ARQUITETURAIS
==================================================

`22_DECISOES_ARQUITETURAIS.md`

Registrar decisões importantes e motivos.

Exemplos:

- Node/TypeScript em vez de Python para produto;
- PostgreSQL como ledger;
- Binance Testnet;
- OpenRouter;
- API/Worker separados;
- Docker Compose;
- sem Redis;
- sem Kafka;
- sem Kubernetes;
- Bootstrap sem framework frontend pesado;
- risk-engine determinístico;
- IA não controla segurança;
- configuração operacional no banco;
- kill switch no ambiente;
- uma posição por vez;
- SELL integral.

Usar formato leve:

Decisão
Motivo
Consequência

==================================================
26. GLOSSÁRIO
==================================================

`23_GLOSSARIO.md`

Explicar termos usados no projeto:

- banca conceitual;
- equity;
- P/L;
- P/L realizado;
- P/L não realizado;
- fill;
- order;
- position;
- decision cycle;
- operational check;
- force close;
- fallback;
- reconciliation;
- Testnet;
- minNotional;
- stepSize;
- ledger;
- heartbeat;
- stale;
- daily result;
- session;
- risk engine.

==================================================
27. DOCUMENTAÇÃO ANTIGA
==================================================

Revisar todos os arquivos já existentes em `docs/`.

Classificar:

A) ainda válido;
B) válido parcialmente;
C) obsoleto;
D) duplicado.

Não simplesmente apagar conteúdo histórico útil.

Quando um documento novo substituir totalmente o antigo:

- remover duplicação;
- mover informação útil;
- atualizar links.

Se houver documentos que representam histórico do desenvolvimento e não documentação atual, considerar:

docs/history/

ou diretório equivalente.

Não deixar documentos contraditórios na raiz de `docs/`.

==================================================
28. LINKS INTERNOS
==================================================

Todos os links do README e dos docs devem funcionar.

Preferir links relativos.

Exemplo:

[Arquitetura](docs/02_ARQUITETURA.md)

Documentos também podem apontar entre si.

No final executar uma verificação simples de links locais, se possível.

==================================================
29. DIAGRAMAS
==================================================

Usar Mermaid quando realmente ajudar.

Criar pelo menos:

- arquitetura geral;
- lifecycle da sessão;
- fluxo de decisão/trade;
- banco simplificado;
- reconciliação.

Não exagerar em diagramas decorativos.

==================================================
30. EXEMPLOS
==================================================

Comandos apresentados devem refletir scripts reais.

Não colocar exemplo:

pnpm foo

se `foo` não existir.

Consultar:

- package.json raiz;
- package.json das apps;
- docker-compose.yml;
- .env.example;
- código.

==================================================
31. SECRETS

Realizar busca antes de finalizar.

Garantir que documentação NÃO contém:

- Binance API key;
- Binance secret;
- OpenRouter key;
- DATABASE_URL com senha real;
- qualquer credencial real.

Usar placeholders:

SUA_CHAVE
SEU_SECRET

==================================================
32. FONTE DE VERDADE

Antes de escrever cada capítulo, consultar o código.

Não assumir que documentação antiga está correta.

Prioridade:

1. código atual;
2. migrations/schema;
3. testes;
4. configuração;
5. docs existentes.

Se documentação antiga divergir do código:

corrigir documentação.

Não alterar código só para fazer documentação antiga ficar correta.

==================================================
33. NÃO ALTERAR COMPORTAMENTO DO SISTEMA

Esta é uma task de documentação.

Não mudar:

- estratégia;
- risk-engine;
- scheduler;
- banco;
- APIs;
- OpenRouter;
- Binance;
- configuração;
- dashboard funcional.

Mudanças permitidas:

- documentação;
- comentários mínimos caso sejam necessários para clareza;
- organização de docs.

==================================================
34. VALIDAÇÃO

Ao finalizar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build

A documentação não pode quebrar o projeto.

Validar:

- links do README;
- links entre docs;
- nomes dos comandos;
- nomes das páginas;
- nomes dos endpoints;
- nomes das tabelas;
- nomes das variáveis.

==================================================
35. RESULTADO ESPERADO

Ao abrir o repositório, uma pessoa deve conseguir começar pelo:

README.md

e navegar pela documentação como um livro.

Fluxo esperado:

README
↓
Visão Geral
↓
Arquitetura
↓
Stack
↓
Setup
↓
Execução
↓
Configuração
↓
Trading
↓
Operação
↓
Diagnóstico

Sem precisar ler código para entender o projeto.

==================================================
36. ENTREGA FINAL

Ao terminar, responder somente:

1. estrutura final de `docs/`;
2. documentos criados;
3. documentos antigos movidos/removidos/mesclados;
4. principais decisões editoriais;
5. quantidade de links internos validados;
6. resultado de lint;
7. resultado de testes;
8. resultado de typecheck;
9. resultado de build;
10. confirmação de que nenhum secret foi incluído;
11. eventuais lacunas de documentação que dependam de trabalho futuro.