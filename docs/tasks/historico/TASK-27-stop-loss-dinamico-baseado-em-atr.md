# TASK 27: Stop Loss Dinâmico Baseado na Volatilidade Real do Ativo (Stop ATR)

## Objetivo
Implementar o cálculo do indicador **ATR** (*Average True Range*) no pacote `@bolinha/market-data` e adaptar o motor de risco (`@bolinha/risk-engine`) para definir o Stop Loss inicial da operação calibrado dinamicamente pela volatilidade real da ação, em vez de depender exclusivamente de um percentual estático global.

---

## 1. Contexto e Problema
- Cada ação na B3 possui um comportamento e amplitude diária próprios:
  - Papéis defensivos como `ITUB4` ou `BBAS3` oscilam menos por candle de 5m (ex: 0,2% a 0,4%).
  - Papéis de commodities como `PETR4` ou `VALE3` frequentemente sofrem oscilações intradiárias de 1,0% a 1,5% em poucos minutos.
- Usar um Stop Loss fixo (ex: 1,2%) causa distorções:
  - Para `PETR4`, 1,2% pode ser muito curto, fazendo o robô ser "violinado" por ruído normal de mercado.
  - Para `ITUB4`, 1,2% pode ser excessivamente longo, tolerando perdas maiores que o necessário.
- A técnica do **Stop ATR** calcula a amplitude média real recente dos candles e posiciona o stop proporcional a essa volatilidade (ex: $2 \times \text{ATR}$ abaixo da entrada).

---

## 2. Requisitos de Engenharia

### A. Cálculo do ATR (`packages/market-data`)
- Implementar `calculateATR(candles: Candle[], period = 14): number`.
- Incluir o valor do ATR no snapshot de indicadores de cada ativo.

### B. Integração com Motor de Risco e Configuração (`packages/core` e `packages/risk-engine`)
- Configuração `STOP_LOSS_MODE`: `'STATIC'` ou `'ATR'` (com fallback seguro para estático).
- Configuração `ATR_MULTIPLIER`: Multiplicador do ATR (padrão `2.0`).
- No `applyB3Risk`, se o modo for ATR e o ATR for válido:
  - $\text{Stop Distance} = \text{ATR} \times \text{ATR\_MULTIPLIER}$;
  - O stop percentual é calculado por $\text{Stop Distance} / \text{Price}$, respeitando sempre o teto rígido de segurança (`MAX_STOP_LOSS_PCT`).

### C. Alinhamento de Prompt da IA (`packages/ai`)
- Informar no prompt à IA a volatilidade ATR da ação e o valor de stop em reais e percentual calculado especificamente para o ativo naquele momento.

### D. Testes e Qualidade
- Testes unitários do cálculo matemático de True Range e ATR.
- Testes no motor de risco garantindo que o stop ATR é respeitado e nunca fura `MAX_STOP_LOSS_PCT`.
- Manter suíte 100% verde (`pnpm test`, `pnpm typecheck`).
