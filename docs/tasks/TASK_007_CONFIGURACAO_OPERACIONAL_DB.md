# TASK_007 — Configuração operacional persistida

## Objetivo

Mover configurações operacionais da sessão de trading do `.env`
para PostgreSQL.

Hoje horários dependem de variáveis de ambiente e o dashboard possui
horários hardcoded, causando divergência entre:

- worker;
- dashboard;
- testes;
- configuração efetivamente usada.

PostgreSQL deve se tornar a fonte de verdade da configuração operacional.

Não alterar secrets nem infraestrutura.

## 1. Criar tabela

Criar tabela `trading_configuration`.

Por enquanto haverá uma configuração ativa.

Campos:

- id
- timezone
- start_time
- stop_new_positions_time
- force_close_time
- end_time
- interval_seconds
- initial_bank_usdt
- max_position_percent
- created_at
- updated_at

Tipos adequados:
- horários preferencialmente `time`;
- timezone texto/varchar;
- valores financeiros numeric.

Criar migration idempotente.

## 2. Seed/default

Na ausência de configuração, criar automaticamente:

timezone = America/Sao_Paulo
start_time = 09:00
stop_new_positions_time = 17:50
force_close_time = 17:55
end_time = 18:00
interval_seconds = 600
initial_bank_usdt = 20
max_position_percent = 100

Esses valores são defaults de bootstrap.

Depois da criação, PostgreSQL é a fonte de verdade.

## 3. Remover dependência operacional do .env

Worker NÃO deve usar diretamente:

TRADING_START_TIME
TRADING_STOP_NEW_POSITIONS_TIME
FORCE_CLOSE_TIME
TRADING_END_TIME
TRADING_INTERVAL_SECONDS

para comportamento operacional.

Buscar configuração no PostgreSQL.

Manter por enquanto no `.env`:

TRADING_LOOP_ENABLED

como kill switch de segurança.

Secrets continuam exclusivamente no `.env`.

## 4. Cache

Não consultar banco dezenas de vezes durante o mesmo ciclo.

Criar serviço/repository de configuração.

Pode carregar configuração:
- no início do ciclo;
- ou usar cache pequeno com invalidação simples.

Alterações no banco devem ser percebidas sem restart do container.

## 5. Scheduler

Scheduler deve usar configuração persistida para:

- start;
- stop new positions;
- force close;
- end;
- intervalo;
- timezone.

Se configuração mudar durante o dia, comportamento futuro deve usar
a nova configuração sem precisar rebuild/restart.

Nunca alterar retroativamente operações já executadas.

## 6. Sessão deve guardar snapshot da configuração

Ao iniciar uma sessão diária, persistir em `trading_sessions` os horários
efetivamente utilizados naquela sessão.

Adicionar, se necessário:

- start_time
- stop_new_positions_time
- force_close_time
- end_time
- interval_seconds

Motivo:

histórico não pode mudar quando configuração futura for alterada.

Exemplo:

02/10 rodou 18:30–21:30.

03/10 voltou para 09:00–18:00.

Ao consultar 02/10, dashboard deve continuar mostrando 18:30–21:30.

## 7. Dashboard

REMOVER horários hardcoded do JavaScript.

Hoje existe algo equivalente a:

START 09:00
STOP BUY 17:50
FORCE CLOSE 17:55
END 18:00

Isso não pode existir como regra fixa no frontend.

`GET /dashboard/data` deve retornar:

schedule: {
  timezone,
  startTime,
  stopNewPositionsTime,
  forceCloseTime,
  endTime,
  intervalSeconds
}

Para sessão atual:
usar configuração/snapshot efetivo.

Para dia histórico:
usar horários persistidos naquela `trading_session`.

Frontend apenas renderiza o que a API devolver.

## 8. Status

`GET /status` deve retornar configuração efetivamente utilizada:

configuration: {
  timezone,
  startTime,
  stopNewPositionsTime,
  forceCloseTime,
  endTime,
  intervalSeconds
}

Mostrar também:

configurationUpdatedAt

## 9. API de configuração

Criar:

GET /configuration

Não criar alteração pública insegura ainda.

Se implementar alteração:

PUT /configuration

deve ser permitido SOMENTE localmente e validado rigorosamente.

Pode deixar PUT para task futura se aumentar escopo.

## 10. Validações

Configuração inválida deve ser recusada.

Garantir:

start < stopNewPositions
stopNewPositions < forceClose
forceClose < end

intervalSeconds > 0

initialBankUsdt > 0

maxPositionPercent > 0 e <= 100

timezone válida.

Nunca iniciar trading com configuração inválida.

## 11. Testes

Os testes NÃO podem depender do `.env` da máquina.

Criar fixtures explícitas de configuração.

Cobrir:

09:00 / 17:50 / 17:55 / 18:00

e também:

18:30 / 21:20 / 21:25 / 21:30

Testar:

- dashboard recebe horários corretos;
- alteração da configuração não exige restart;
- sessão histórica preserva horário antigo;
- configuração inválida é rejeitada;
- worker usa configuração do banco;
- frontend não contém horários operacionais hardcoded.

## 12. Configuração atual do teste

Como estamos testando hoje com:

18:30
21:20
21:25
21:30

NÃO altere o teste que já está em andamento.

Faça migration/implantação somente de forma segura após a sessão atual,
ou preserve explicitamente a configuração vigente.

Não interromper operação atual.

## 13. Segurança

Continuar no `.env`:

BINANCE_API_KEY
BINANCE_API_SECRET
OPENROUTER_API_KEY
DATABASE_URL
BINANCE_ENV
TRADING_LOOP_ENABLED

Não mover secrets para essa tabela.

## 14. Validação final

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build

Todos devem ficar verdes.

Confirmar que dashboard não possui mais:

09:00
17:50
17:55
18:00

hardcoded como regra operacional.

## Entrega

Informar:

- migration criada;
- configuração persistida;
- fonte de verdade usada pelo worker;
- snapshot da sessão;
- alteração feita no dashboard;
- quantidade de testes;
- resultado lint/test/typecheck/build;
- confirmação de que secrets continuam fora do banco.