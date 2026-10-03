# Bolinha Trader

**Operação Bolinha de Gude** é um experimento de trading autônomo para `BTCUSDT`: dados públicos da Binance, sinais de IA via OpenRouter, risco determinístico, execução na Binance Spot Testnet e ledger conceitual em PostgreSQL.

> Nesta fase o projeto opera **somente Binance Spot Testnet**. Não há dinheiro real.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d --build
curl http://localhost:3000/health
```

Preencha as credenciais Testnet e OpenRouter antes de habilitar o loop. Veja o [setup completo](docs/04_SETUP_LOCAL.md).

## Documentação

1. [Visão geral](docs/01_VISAO_GERAL.md)
2. [Arquitetura](docs/02_ARQUITETURA.md)
3. [Stack tecnológica](docs/03_STACK_TECNOLOGICA.md)
4. [Setup local](docs/04_SETUP_LOCAL.md)
5. [Execução](docs/05_EXECUCAO_DO_PROJETO.md)
6. [Configuração operacional](docs/06_CONFIGURACAO_OPERACIONAL.md)
7. [Trading lifecycle](docs/07_TRADING_LIFECYCLE.md)
8. [Motor de risco](docs/08_MOTOR_DE_RISCO.md)
9. [IA e OpenRouter](docs/09_IA_E_OPENROUTER.md)
10. [Binance Testnet](docs/10_BINANCE_TESTNET.md)
11. [Persistência e banco](docs/11_PERSISTENCIA_E_BANCO.md)
12. [API HTTP](docs/12_API_HTTP.md)
13. [Dashboard](docs/13_DASHBOARD_E_PAGINAS_WEB.md)
14. [Relatórios](docs/14_RELATORIOS.md)
15. [Observabilidade](docs/15_OBSERVABILIDADE.md)
16. [Reconciliação](docs/16_RECONCILIACAO_E_RECUPERACAO.md)
17. [Segurança](docs/17_SEGURANCA.md)
18. [Testes](docs/18_TESTES.md)
19. [Troubleshooting](docs/19_TROUBLESHOOTING.md)
20. [Runbook operacional](docs/20_RUNBOOK_OPERACIONAL.md)
21. [Deploy e infraestrutura](docs/21_DEPLOY_E_INFRAESTRUTURA.md)
22. [Decisões arquiteturais](docs/22_DECISOES_ARQUITETURAIS.md)
23. [Glossário](docs/23_GLOSSARIO.md)

As tarefas em [`docs/tasks/`](docs/tasks/) são histórico de desenvolvimento, não referência operacional atual.
