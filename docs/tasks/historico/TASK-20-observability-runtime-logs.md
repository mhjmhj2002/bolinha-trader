# TASK-20: Observabilidade de Runtime nos Logs de Deploy e Delimitação de Ruído de Testes

## Status: done
**Data de Criação:** 2026-10-22  
**Prioridade:** Média  
**Origem:** Auditoria de observabilidade — log de deploy sem saída de runtime e fixtures de teste confundidas com falhas de produção  
**Pacotes Afetados:** `docs/ambiente/deploy/` (scripts `build.sh`, `deploy.sh`, `run-all.sh`, `common.sh`)

---

## 1. Contexto e Problema Observado

Nenhuma alteração de código de aplicação é necessária nesta tarefa: o escopo é exclusivamente a camada de scripts de build/deploy em `docs/ambiente/deploy/`.

### 1.1 Log de deploy sem saída de runtime
O arquivo `docs/ambiente/deploy/logs/2026-10-22-08-58-45-all-log.txt` contém **apenas** saída de build/deploy e termina cerca de **3 segundos** após o worker iniciar a operação. O log de runtime real existe somente em `docker logs bolinha-trader-worker-1`, fora do artefato de deploy. Isso torna impossível auditar post-mortem o que o robô decidiu/executou em uma sessão.

### 1.2 Ruído de testes confundido com erro de produção
O mesmo log de deploy embute a **saída completa do vitest** (linhas 25-160). Suas linhas `ERROR` — por exemplo `temporary B3 outage`, `dashboard writer unavailable`, `B3 Testnet HTTP 400` — são **fixtures de teste** simulando falhas e já foram interpretadas como falhas reais de produção durante a análise do log.

---

## 2. Requisitos de Implementação

1. **Coleta de Logs de Runtime:**
   - Após o deploy, fazer streaming e/ou append dos logs dos containers em um **arquivo de log de runtime por serviço**, claramente distinto do log de build/deploy (ex: `<timestamp>-worker-runtime-log.txt`, `<timestamp>-api-runtime-log.txt`), ou documentar explicitamente o comando exato (`docker logs ...`) e onde consultá-lo.
2. **Delimitação Visível do Bloco de Testes:**
   - A saída de testes deve ser envolvida por banner/marcador explícito (início e fim) no log de deploy, de modo que linhas `ERROR` de fixtures jamais sejam confundidas com eventos de produção.
3. **Sem Alteração de Código de Aplicação:**
   - Restringir as mudanças a `docs/ambiente/deploy/` (scripts e documentação associada).

---

## 3. Critérios de Aceite

- [ ] O script de deploy grava uma seção de testes claramente separada e, em seguida, faz stream/append dos logs de runtime do container em arquivo de log de runtime por serviço (ou documenta o comando exato de `docker logs`).
- [ ] A saída de testes está visivelmente delimitada por banner/marcador, impedindo que fixtures (`temporary B3 outage`, `dashboard writer unavailable`, `B3 Testnet HTTP 400`) sejam lidas como falhas de produção.
- [ ] O log de deploy passa a conter/indicar a localização da saída real de runtime do worker e da API.
- [ ] Nenhum arquivo de código de aplicação (`packages/*`, `apps/*`) é modificado por esta tarefa.
- [ ] Scripts validados com `shellcheck`/execução de smoke do script, sem quebrar o fluxo de build/deploy existente.
