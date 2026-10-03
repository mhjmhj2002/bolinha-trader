# TASK_008 — CRUD seguro da configuração operacional

## Objetivo

Criar uma tela administrativa simples para visualizar e editar a configuração operacional da Operação Bolinha de Gude.

A tabela `trading_configuration` já deve existir e ser a fonte de verdade dos horários e parâmetros operacionais.

Agora precisamos permitir manutenção desses dados pelo dashboard, sem editar `.env` e sem reiniciar containers.

IMPORTANTE:
- NÃO permitir alteração enquanto houver trading em execução;
- NÃO permitir alteração durante sessão ativa;
- NÃO permitir alteração se houver posição aberta;
- NÃO permitir alteração se houver ordem pendente/reconciliação em andamento;
- manter Binance somente Testnet;
- não mexer em secrets.

## 1. Tela

Criar:

GET /dashboard/configuration

ou rota equivalente acessível pelo dashboard principal.

Usar Bootstrap 5.

Campos:

- timezone
- startTime
- stopNewPositionsTime
- forceCloseTime
- endTime
- intervalSeconds
- initialBankUsdt
- maxPositionPercent

Mostrar também:

- updatedAt
- configuração atual em uso
- status da sessão
- loop ON/OFF

## 2. Estado bloqueado durante execução

Ao abrir a tela, a API deve informar se a configuração está editável.

Exemplo:

editable: false
blockedReason: "TRADING_SESSION_ACTIVE"

Se trading estiver em execução, TODOS os campos devem aparecer:

- disabled;
- botão Salvar desabilitado;
- botão Excluir desabilitado;
- criação de nova configuração desabilitada.

Exibir mensagem clara:

"Trading em execução. Escolha um horário fora da janela de execução para atualizar estes dados."

Também bloquear edição quando:

- sessionPhase = TRADING
- sessionPhase = NO_NEW_POSITIONS
- sessionPhase = FORCE_CLOSE
- sessionPhase = FORCE_CLOSE_PENDING
- existir posição aberta
- existir ordem PENDING
- reconciliationStatus != OK

Não confiar apenas no frontend.

A API deve repetir a validação no backend.

## 3. Regra de edição

Permitir edição apenas quando:

- sessão não está em execução;
- nenhuma posição aberta;
- nenhuma ordem pendente;
- reconciliação OK.

Estados permitidos em princípio:

- BEFORE_START
- FINISHED

Mas ainda assim validar posição/pending/reconciliação.

## 4. CRUD

Criar endpoints:

GET /configuration
GET /configuration/:id
POST /configuration
PUT /configuration/:id
DELETE /configuration/:id

Se a arquitetura atual mantiver apenas uma configuração ativa, pode simplificar para:

GET /configuration
PUT /configuration

Mas preparar o modelo para histórico/versionamento.

Preferência:
não apagar fisicamente configuração já utilizada em sessão histórica.

Em vez de DELETE real, considerar:

- active=false
ou
- soft delete

Se optar por uma única configuração ativa, documentar a decisão.

## 5. Validação backend

Regras obrigatórias:

startTime < stopNewPositionsTime
stopNewPositionsTime < forceCloseTime
forceCloseTime < endTime

intervalSeconds > 0
initialBankUsdt > 0
maxPositionPercent > 0
maxPositionPercent <= 100
timezone válida

Rejeitar configuração inválida com HTTP 400.

## 6. Concorrência

Mesmo que a tela tenha sido aberta antes da sessão começar, o backend deve revalidar no instante do PUT/POST/DELETE.

Exemplo:

08:59 usuário abre tela.
09:00 sessão começa.
09:01 usuário tenta salvar.

Resultado:
HTTP 409 Conflict

Mensagem:

"Trading em execução. Configuração operacional não pode ser alterada agora."

## 7. Lock / atomicidade

Atualização da configuração deve ser transacional.

Evitar cenário em que metade dos campos é atualizada.

Se houver mecanismo de lock operacional existente, reutilizar quando fizer sentido.

## 8. Auditoria

Registrar eventos:

configuration_viewed
configuration_update_attempted
configuration_updated
configuration_update_blocked
configuration_created
configuration_deleted_or_deactivated

Metadata segura:

- configuração anterior
- configuração nova
- horário
- motivo de bloqueio

Nunca persistir secrets.

## 9. Histórico

Toda alteração deve preservar histórico.

Opção recomendada:

trading_configuration_versions

ou versionamento na própria tabela com:

- version
- active
- valid_from
- valid_to

Sessões antigas devem continuar apontando para a configuração usada naquele dia.

Não sobrescrever evidência histórica.

## 10. UX

Na tela:

Título:
Configuração operacional

Mostrar alerta amarelo/azul quando editável.

Mostrar alerta vermelho quando bloqueado:

"Trading em execução. Escolha um horário fora da execução para atualizar estes dados."

Campos bloqueados visualmente.

Botão:

Salvar alterações

Mostrar confirmação antes de salvar:

"Esta alteração afetará as próximas sessões de trading."

## 11. Dashboard principal

Adicionar link/menu:

Configuração

No dashboard principal mostrar pequena indicação:

Configuração:
18:30 → 21:30
Intervalo: 10 min

Clicar abre CRUD.

## 12. API de estado de edição

Criar algo como:

GET /configuration/editability

Resposta:

{
  "editable": false,
  "reason": "TRADING_SESSION_ACTIVE",
  "message": "Trading em execução. Escolha um horário fora da execução para atualizar estes dados."
}

Ou incluir isso em GET /configuration.

## 13. Testes

Cobrir:

- editar em BEFORE_START;
- editar em FINISHED;
- bloquear durante TRADING;
- bloquear durante NO_NEW_POSITIONS;
- bloquear durante FORCE_CLOSE;
- bloquear durante FORCE_CLOSE_PENDING;
- bloquear com posição aberta;
- bloquear com ordem PENDING;
- bloquear com reconciliationStatus ERROR;
- corrida: tela aberta antes, PUT durante trading -> 409;
- configuração inválida -> 400;
- atualização válida -> 200;
- sessão histórica mantém configuração anterior;
- frontend mostra campos disabled quando bloqueado;
- backend bloqueia mesmo se frontend for burlado.

## 14. Segurança

Não retornar nem editar:

- BINANCE_API_KEY
- BINANCE_API_SECRET
- OPENROUTER_API_KEY
- DATABASE_URL

TRADING_LOOP_ENABLED continua fora deste CRUD por enquanto.

Ele permanece como kill switch operacional separado.

## 15. Não fazer

Não:
- habilitar Binance produção;
- expor configuração publicamente;
- colocar secrets no banco;
- permitir alteração durante trading;
- reiniciar containers após alteração;
- alterar estratégia de trading nesta task.

## 16. Validação final

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build

Todos devem ficar verdes.

Validar manualmente:

1. fora da janela -> formulário editável;
2. dentro da janela -> tudo bloqueado;
3. tentativa direta de PUT durante trading -> HTTP 409;
4. alteração válida fora da janela -> próxima sessão usa nova configuração;
5. histórico antigo permanece intacto.

## 17. Entrega

Informar:

- tela criada;
- endpoints;
- regra de bloqueio;
- modelo de versionamento/histórico;
- testes;
- resultado das validações;
- confirmação de que secrets não fazem parte do CRUD;
- confirmação de que TRADING_LOOP_ENABLED continua separado.