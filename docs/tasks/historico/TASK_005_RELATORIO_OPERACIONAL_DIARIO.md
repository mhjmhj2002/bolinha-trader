# TASK_005 — Relatório operacional diário e diagnóstico

## Objetivo

Criar um relatório único e legível para avaliar um dia inteiro da Operação Bolinha de Gude.

Não criar frontend.

O relatório deve ser obtido por CLI e API.

## Comando

Criar:

pnpm trading:report:today

Saída humana, por exemplo:

Operação Bolinha de Gude — 2026-10-02

Sessão
09:00 → 18:00
Status: CONCLUÍDA

Banca
Inicial: 20.00000000 USDT
Final: 20.18430000 USDT
Resultado líquido: +0.18430000 USDT
Retorno: +0.9215%

Operações
BUY: 3
SELL: 3
HOLD: 41
Rejeitadas pelo risco: 2
Force close: não

IA
Chamadas: 47
Custo: US$ 0.0031
Fallbacks: 8

Modelos
Nemotron: 22
Qwen: 15
Laguna: 10

Infraestrutura
Ciclos esperados: 53
Ciclos executados: 53
Erros: 1
Reinícios do worker: 0
Maior intervalo sem ciclo: 10m14s

Estado final
Posição aberta: NÃO

Resultado operacional:
OK

## Diagnósticos automáticos

Detectar e destacar:

- ciclo perdido;
- ciclo muito atrasado;
- worker restart;
- erro Binance;
- erro OpenRouter;
- fallback;
- ordem rejeitada;
- posição aberta após horário;
- force-close necessário;
- inconsistência;
- pending order;
- reconciliação;
- P/L divergente;
- sessão incompleta.

## API

Adicionar:

GET /reports/daily/:date
GET /reports/today

Retornar JSON estruturado.

## Evidência

Relatório deve ser reproduzível usando somente dados persistidos.

Não depender de logs stdout.

## Testes

Cobrir relatório:

- dia sem trades;
- dia lucrativo;
- dia negativo;
- fallbacks;
- erros;
- restart;
- force-close;
- sessão incompleta.

## Não fazer

Não criar dashboard frontend.
Não habilitar produção.
Não habilitar loop automaticamente.

## Validação

pnpm lint
pnpm test
pnpm typecheck
pnpm build

Loop deve permanecer OFF.