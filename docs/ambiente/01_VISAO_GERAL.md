# Visão geral

## Objetivo

Apresentar a Operação Bolinha de Gude sem exigir leitura do código. Para preparar o ambiente, siga o [setup](04_SETUP_LOCAL.md); para a rotina diária, use o [runbook](20_RUNBOOK_OPERACIONAL.md).

O projeto testa um fluxo autônomo de trading de `BTCUSDT` em Spot Testnet. A banca é **conceitual**: o PostgreSQL registra caixa, posição, P/L e custos de IA próprios da experiência. Ela não é o saldo total da conta Binance.

- a IA sugere `BUY`, `SELL` ou `HOLD`;
- o Risk Engine autoriza ou bloqueia;
- a Binance Testnet executa a ordem autorizada;
- o PostgreSQL registra o ledger e a auditoria;
- API e dashboard observam o estado.

Não há alavancagem, short, produção Binance ou operação em dinheiro real. O dashboard mostra saúde, banca, P/L, posição, decisões e eventos. O relatório diário consolida evidências da janela real da sessão. A [arquitetura](02_ARQUITETURA.md) detalha as fronteiras.
