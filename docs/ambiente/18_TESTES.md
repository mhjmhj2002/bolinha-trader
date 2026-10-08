# Testes

## Objetivo

Explicar a validação automatizada e a diferença para testes reais.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Vitest cobre core/scheduler/lifecycle, risk engine, dados de mercado, IA, fills e contabilidade, repositório/relatórios, reconciliação, configuração, dashboard e endpoints. Os testes usam mocks/doubles quando dependência externa não é necessária; alguns validam integração com PostgreSQL quando o ambiente de teste o disponibiliza.

`pnpm trading:smoke:testnet` não é teste unitário: envia BUY e SELL reais na Spot Testnet e persiste a evidência. Exige credenciais, caixa conceitual positivo e nenhuma posição aberta; pode falhar por filtros, rede ou Testnet. O teste diário autônomo é a operação do worker dentro da janela configurada; acompanhe com `pnpm trading:day-test:check` e o relatório, não o confunda com suíte automatizada.
