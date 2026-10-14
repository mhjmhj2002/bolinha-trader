# TASK-07: Virada Definitiva para o Mercado de Ações da B3 (Worker, API, Dashboard e Limpeza de Cripto)

## Status: done
**Data de Criação:** 2026-10-13  
**Prioridade:** Crítica  
**Componentes:** `@bolinha/core`, `@bolinha/worker`, `@bolinha/api`, `@bolinha/exchange`, `@bolinha/risk-engine`, `@bolinha/ai`

---

## 1. Motivação e Objetivo
O objetivo do projeto é operar **Day Trade na B3 (Mercado de Ações Brasileiro)** em Reais (BRL).
Embora as fundações da B3 tenham sido criadas na TASK-05 e TASK-06 (`packages/exchange/src/b3`), os pontos de entrada do sistema (`apps/worker`, `apps/api`, `.env`, dashboard) ainda estavam apontando para o cliente Binance Testnet e par BTCUSDT.

Esta tarefa vira a chave definitiva de todo o sistema para a **B3 (Bolsa Brasileira)**:
- Ativo padrão: `PETR4` (Ações Petrobras) com suporte a lote padrão (100) e mercado fracionário (`PETR4F`).
- Moeda: **R$ (BRL)**.
- Broker de execução: `B3PaperBroker` / `MT5BridgeClient` da B3.
- Motor de risco e prompt: `applyB3Risk` e `buildB3Prompt` com targets de Take Profit (+1% a +2%) e Stop Loss (-0,5% a -0,8%).
- Dashboard e API: Exibição e monitoramento do pregão da B3 em Reais.

---

## 2. Escopo de Mudanças

1. **Configuração e Core (`@bolinha/core`)**:
   - Ajustar variáveis padrão e tipos para suportar `SYMBOL=PETR4` e moeda base BRL.
   - Atualizar `.env` e `.env.example` para referenciar o ambiente B3.

2. **Worker (`apps/worker`)**:
   - Inicializar o `B3PaperBroker` como gateway de execução do serviço.
   - Utilizar `buildB3Prompt` para o raciocínio da IA em ações.
   - Utilizar `applyB3Risk` com as regras de lote da B3 (mínimo 1 lote / 1 ação fracionária) e zeragem de day trade.

3. **API e Dashboard (`apps/api`)**:
   - Substituir verificação de saúde da Binance pelo provedor B3 (`pingPublic`/`price`).
   - Ajustar labels do dashboard para BRL (R$) e Ticker B3 em vez de BTC / USDT / Binance.

4. **Validação**:
   - Executar suíte de testes do monorepo (`pnpm test` e `pnpm typecheck`).
