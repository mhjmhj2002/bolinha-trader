# Glossário

## Objetivo

Definir termos usados nos capítulos operacionais.

| Termo | Significado |
| --- | --- |
| Banca conceitual | caixa/posição controlados pelo ledger do projeto |
| Equity | caixa mais valor estimado da posição |
| P/L realizado / não realizado | resultado de posição fechada / variação de posição aberta |
| Order, fill, trade | solicitação à exchange, execução individual, registro contábil da operação |
| Position | BTC conceitual aberto pela experiência |
| Decision cycle | mercado → IA → risco → decisão |
| Operational check | verificação do scheduler, separada de decisão |
| Force close | tentativa de SELL integral no fechamento |
| Fallback | tentativa de modelo posterior após falha anterior |
| Reconciliation | conciliação de ordem Binance com ledger PostgreSQL |
| Testnet | ambiente Binance sem dinheiro real |
| minNotional/minQty/stepSize | filtros de valor mínimo, quantidade mínima e incremento de quantidade |
| Ledger | registro conceitual auditável do projeto |
| Heartbeat / stale | sinal de vida / sinal atrasado além do limite |
| Daily result | consolidação diária (`PENDING`, `OK` ou `ERROR`) |
| Session | janela diária persistida com fase e snapshot de configuração |
| Risk Engine | regras determinísticas que autorizam ou bloqueiam decisão |
