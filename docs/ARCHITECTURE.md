# Arquitetura

API e worker são processos independentes. O worker grava primeiro snapshot, decisão e ordem pendente; somente então chama a Testnet. O PostgreSQL contém a conta conceitual e todo o histórico. Uma operação é reconciliada pelo `clientOrderId` caso a resposta da Binance seja ambígua.

Não há produção Binance, alavancagem, short, Redis, Kafka ou infraestrutura cloud nesta versão. Futuramente o alvo é Akamai Cloud/Linode São Paulo (1 vCPU, ~2 GB RAM, ~50 GB, ~2 TB; referência observada US$3,50/mês), com Docker Compose, PostgreSQL, API, worker, Caddy e monitoramento externo. Isso não é automação de deploy.
