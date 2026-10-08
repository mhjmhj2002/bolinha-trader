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

Preencha as credenciais Testnet e OpenRouter antes de habilitar o loop. Veja o [setup completo](docs/ambiente/04_SETUP_LOCAL.md).

## Documentação do Ambiente

1. [Visão geral](docs/ambiente/01_VISAO_GERAL.md)
2. [Arquitetura](docs/ambiente/02_ARQUITETURA.md)
3. [Stack tecnológica](docs/ambiente/03_STACK_TECNOLOGICA.md)
4. [Setup local](docs/ambiente/04_SETUP_LOCAL.md)
5. [Execução](docs/ambiente/05_EXECUCAO_DO_PROJETO.md)
6. [Configuração operacional](docs/ambiente/06_CONFIGURACAO_OPERACIONAL.md)
7. [Trading lifecycle](docs/ambiente/07_TRADING_LIFECYCLE.md)
8. [Motor de risco](docs/ambiente/08_MOTOR_DE_RISCO.md)
9. [IA e OpenRouter](docs/ambiente/09_IA_E_OPENROUTER.md)
10. [Binance Testnet](docs/ambiente/10_BINANCE_TESTNET.md)
11. [Persistência e banco](docs/ambiente/11_PERSISTENCIA_E_BANCO.md)
12. [API HTTP](docs/ambiente/12_API_HTTP.md)
13. [Dashboard](docs/ambiente/13_DASHBOARD_E_PAGINAS_WEB.md)
14. [Relatórios](docs/ambiente/14_RELATORIOS.md)
15. [Observabilidade](docs/ambiente/15_OBSERVABILIDADE.md)
16. [Reconciliação](docs/ambiente/16_RECONCILIACAO_E_RECUPERACAO.md)
17. [Segurança](docs/ambiente/17_SEGURANCA.md)
18. [Testes](docs/ambiente/18_TESTES.md)
19. [Troubleshooting](docs/ambiente/19_TROUBLESHOOTING.md)
20. [Runbook operacional](docs/ambiente/20_RUNBOOK_OPERACIONAL.md)
21. [Deploy e infraestrutura](docs/ambiente/21_DEPLOY_E_INFRAESTRUTURA.md)
22. [Decisões arquiteturais](docs/ambiente/22_DECISOES_ARQUITETURAIS.md)
23. [Glossário](docs/ambiente/23_GLOSSARIO.md)

As tarefas em [`docs/tasks/`](docs/tasks/) são histórico de desenvolvimento, não referência operacional atual.
