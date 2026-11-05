# TASK 24: Limite Diário de Perda (Daily Loss Limit / Circuit Breaker da Conta)

## Objetivo
Implementar um mecanismo de proteção financeira global (*Circuit Breaker*) que monitora o PnL líquido realizado acumulado no dia e bloqueia novas operações ou força o encerramento da posição se a perda diária ultrapassar um teto percentual ou financeiro estipulado, protegendo a banca contra sequências negativas intradiárias.

---

## 1. Contexto e Problema
- Atualmente, o robô possui controle de risco por ordem (Stop Loss intradiário de ~1,2% a 1,8% por operação).
- No entanto, se o mercado estiver errático ou lateralizado, o robô pode realizar sucessivas compras e vendas ao longo do dia, acumulando múltiplos stops e dilapidando o capital da banca sem nenhum freio diário global.
- No trading profissional, é mandatório haver um **Daily Loss Limit**: atingido o limite de perda (ex: 5% a 10% da banca diária), o robô cessa qualquer nova entrada até o próximo dia útil.

---

## 2. Requisitos de Engenharia

### A. Configuração Centralizada e Tipada (`packages/core`)
- Adicionar no schema Zod de configuração as variáveis:
  - `DAILY_MAX_LOSS_PCT`: Limite percentual de perda máxima diária permitida (ex: 0.05 para 5% da banca inicial).
  - `DAILY_MAX_LOSS_BRL`: Limite financeiro em R$ (ex: R$ 10,00 para banca de R$ 100,00). Se fornecido, sobrepõe ou atua em conjunto com o percentual.
- Refletir em `.env.example` com valores padrão conservadores.

### B. Motor de Risco (`packages/risk-engine`)
- Expandir `applyB3Risk` para receber o `dailyRealizedPnlBrl` e a banca inicial.
- Se o PnL líquido do dia for inferior ao limite tolerado (`realizedPnlBrl <= -maxDailyLoss`):
  - Qualquer tentativa de `BUY` é convertida para `HOLD` com motivo explícito: `BUY rejected: Daily loss limit reached (-R$ X.XX / limit -R$ Y.YY)`.
  - Se houver posição aberta, avaliar política (forçar saída ou gerenciar a posição aberta até o stop da ordem sem permitir novos aumentos).

### C. Worker e Ciclo de Sessão (`apps/worker`)
- No início de cada ciclo em `runOnceLocked`:
  - Consultar o PnL do dia corrente na tabela `daily_results` ou `trading_account`.
  - Se o limite diário estiver estourado, registrar evento de aviso `WARN (daily_loss_limit_triggered)` e encerrar o ciclo em `HOLD`.

### D. Testes e Qualidade
- Testes unitários no `@bolinha/risk-engine` e `@bolinha/worker` cobrindo o bloqueio por perda diária.
- Manter suíte 100% verde (`pnpm test`, `pnpm typecheck`).
