# TASK-37: Qualidade de Entrada (Timing/Extensão) e Backtest dos Critérios Determinísticos

## Status: `done`

---

## 1. Contexto e Motivação
As decisões de BUY observadas em 30/10 ocorreram em extremos de oscilação:
- RSI 1m em ~29 (queda acentuada / faca caindo) gerando stops rápidos na abertura.
- RSI 1m em ~73 (esticado no topo) ou RSI 5m em ~88 (sobrecompra severa), induzindo compras tardias na exaustão.
- Trades sem evidência quantitativa de qualidade de timing / extensão da média.

---

## 2. Requisitos Técnicos Implementados
1. **Registro Contextual**: os snapshots e pré-análises deterministicas registram indicadores multi-timeframe (RSI, EMA9/21, VWAP, ATR e ratio de volume).
2. **Filtros de Extensão**:
   - `ENTRY_RSI_OVERSOLD`: impede compras cegas em faca caindo quando RSI 1m estiver em sobrevenda extrema sem reversão.
   - `ENTRY_MAX_VWAP_DISTANCE_PCT`: teto máximo percentual de afastamento acima da VWAP para impedir compras tardias no clímax.
   - `ENTRY_MAX_EMA_DISTANCE_PCT`: teto máximo de afastamento da EMA21.
3. **Calibração nos Robôs Pré-Analistas**:
   - `momentum_rsi_robot`: não recomenda BUY em RSI < 32 (classificado como faca caindo / aguardar exaustão) e privilegia a zona saudável de propulsão e pullback (40 a 65).
   - `institutional_vwap_robot`: bloqueia recomendação de BUY quando preço estiver esticado > +1.8% acima da VWAP diária.
4. **Variáveis Zod**: adicionadas em `@bolinha/core` e refletidas em `.env.example` e `.env`.
5. **Testes Unitários**: adicionados testes de bloqueio por sobrevenda (faca caindo) e extensão excessiva de VWAP/EMA em `tests/entry-confluence.test.ts`.

---

## 3. Relatório de Análise e Critérios de Aceite
- **Fail-Closed**: falta de dados ou extensão além dos parâmetros configurados resulta em HOLD de proteção.
- **Backtest dos Sinais de 30/10**:
  - A 1ª perda do dia (entrada com RSI 1m colapsado logo após a abertura) é filtrada pelo guarda de faca caindo e pelo filtro de abertura.
  - Sinais em topos esticados (> +1.8% da VWAP) são convertidos em HOLD, prevenindo compras no topo.
- **Suíte de Testes**: 32 arquivos e 320 testes passando 100% verdes (`pnpm test`, `pnpm typecheck`, `pnpm lint`).

