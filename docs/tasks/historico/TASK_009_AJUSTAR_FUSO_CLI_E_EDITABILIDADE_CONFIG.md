# TASK_009 — Ajustar fuso horário no CLI e regra de editabilidade da configuração

## Contexto

O projeto `bolinha-trader` já possui:

- configuração operacional persistida em PostgreSQL;
- CRUD Bootstrap para edição;
- bloqueio de edição durante operação;
- worker autônomo;
- dashboard;
- timezone oficial `America/Sao_Paulo`.

No teste de hoje apareceram dois problemas de UX/regra.

## 1. CLI exibindo UTC

O comando:

`pnpm trading:day-test:check`

mostra corretamente:

Time: 09:47:36 America/Sao_Paulo

mas mostra:

Last cycle: Sat Oct 03 2026 12:47:30 GMT+0000
Next cycle: Sat Oct 03 2026 12:50:00 GMT+0000

Isso gera confusão.

### Correção

Todo horário exibido para operador humano no CLI deve usar:

`America/Sao_Paulo`

ou o timezone operacional persistido para a sessão.

Exemplo esperado:

Last cycle: 03/10/2026 09:47:30
Next cycle: 03/10/2026 09:50:00

Não alterar timestamps persistidos no banco.
Banco continua usando UTC/timestamptz.

A correção é somente de apresentação.

Aplicar também onde fizer sentido em:

- `trading:status`
- `trading:day-test:check`
- `trading:report:today`
- outros CLIs operacionais

## 2. CRUD bloqueado com loop OFF

Foi observado:

- horário atual dentro da janela TRADING;
- `sessionPhase = TRADING`;
- `TRADING_LOOP_ENABLED = false`;
- nenhuma posição aberta;
- nenhuma ordem pendente;
- reconciliação OK;
- nenhum ciclo em execução.

Mesmo assim, o CRUD apresentou:

"Trading em execução. Escolha um horário fora da janela de execução para atualizar estes dados."

Isso está incorreto.

### Regra nova

`sessionPhase = TRADING` sozinho NÃO significa que existe trading em execução.

Permitir edição da configuração quando:

- loopEnabled = false;
- nenhuma posição aberta;
- nenhuma ordem pendente;
- reconciliationStatus = OK;
- nenhum ciclo operacional está em execução;
- nenhum force close está em andamento.

Mesmo que o relógio esteja dentro da janela configurada.

### Bloquear edição quando

Bloquear quando qualquer condição operacional real ocorrer:

- loopEnabled = true E sessão ativa;
- ciclo em execução;
- posição aberta;
- ordem PENDING;
- FORCE_CLOSE em andamento;
- FORCE_CLOSE_PENDING;
- reconciliação diferente de OK;
- inconsistência de estado.

### Concorrência

A validação deve continuar ocorrendo no backend no momento do PUT/POST.

Exemplo:

1. usuário abre tela com loop OFF;
2. tela está editável;
3. outro processo ativa o loop;
4. usuário tenta salvar;
5. backend deve retornar HTTP 409.

Não confiar apenas no frontend.

## 3. Mensagem de bloqueio

Melhorar a mensagem conforme o motivo real.

Exemplos:

Loop ativo:
"Trading em execução. A configuração não pode ser alterada durante a sessão ativa."

Posição aberta:
"Existe uma posição aberta. Feche a posição antes de alterar a configuração."

Ordem pendente:
"Existe uma ordem pendente de reconciliação."

Reconciliação:
"A configuração está bloqueada enquanto a reconciliação não estiver OK."

Evitar sempre usar a mensagem genérica de horário.

## 4. API

O endpoint de configuração/editabilidade deve retornar algo como:

{
  "editable": false,
  "reason": "LOOP_ACTIVE",
  "message": "Trading em execução. A configuração não pode ser alterada durante a sessão ativa."
}

Possíveis reasons:

- LOOP_ACTIVE
- OPEN_POSITION
- PENDING_ORDER
- RECONCILIATION_NOT_OK
- CYCLE_RUNNING
- FORCE_CLOSE_RUNNING

Quando loop estiver OFF e não houver bloqueios reais:

{
  "editable": true,
  "reason": null,
  "message": null
}

## 5. Testes

Adicionar testes para:

- dentro da janela + loop OFF + estado limpo -> editável;
- dentro da janela + loop ON -> bloqueado;
- fora da janela + posição aberta -> bloqueado;
- loop OFF + ordem pendente -> bloqueado;
- loop OFF + reconciliação ERROR -> bloqueado;
- tela aberta editável e PUT ocorre depois de loop ativado -> HTTP 409;
- CLI exibe lastCycle/nextCycle em America/Sao_Paulo;
- timestamps persistidos continuam UTC/timestamptz.

## 6. Não fazer

Não:
- alterar timestamps do banco;
- mudar timezone persistido;
- alterar estratégia;
- habilitar Binance produção;
- ligar/desligar loop automaticamente;
- mudar os horários atuais do teste.

## 7. Validação

Executar:

pnpm lint
pnpm test
pnpm typecheck
pnpm build

Todos devem ficar verdes.

## 8. Entrega

Informar:

1. regra final de editabilidade;
2. motivos de bloqueio suportados;
3. CLIs ajustados para timezone operacional;
4. testes adicionados;
5. total de testes passando;
6. confirmação de que banco continua armazenando timestamps em UTC.