# Decisões arquiteturais

## Objetivo

Registrar decisões observáveis no código e suas consequências.

| Decisão | Motivo | Consequência |
| --- | --- | --- |
| Node/TypeScript e pnpm | uma stack tipada para apps e packages | build único por project references |
| PostgreSQL como ledger | histórico transacional/auditável | conta é conceitual, não saldo da exchange |
| Binance Spot Testnet | experimentar sem produção | código recusa ambiente produtivo |
| API e worker separados | observação não deve depender do scheduler | dois processos compartilham banco |
| Risk Engine determinístico | IA não controla segurança | sugestões podem virar HOLD |
| uma posição e SELL integral | reduzir complexidade/escopo | sem short, múltiplas posições ou venda parcial |
| configuração no banco/versionada | operação alterável e auditável | sessão conserva snapshot |
| Compose, sem Redis/Kafka/Kubernetes | escopo operacional pequeno | menos componentes, sem alta disponibilidade |
| Bootstrap/JS estático | dashboard simples | sem SPA/framework frontend |
| kill switch em ambiente | parar automação rapidamente | exige recriar processo após alteração |
