# TASK 26: Trailing Stop com Teto de Lucro Travado (Cap / Lock-in de Stop Móvel)

## Objetivo
Implementar a funcionalidade de **Teto de Trailing Stop** (`trailingStopMaxFloorPct`), permitindo que o stop móvel aumente proporcionalmente aos ganhos até atingir uma margem percentual pré-definida de lucro garantido (ex: +1,5%), estacionando nesse patamar para dar fôlego ao trade sem ser estopado por oscilações menores de mercado.

---

## 1. Contexto e Problema
- O robô atualmente sobe o stop continuamente a cada nova máxima (`highestPrice * (1 - trailingStopPct)`).
- Em altas prolongadas, se a ação sobe de +0,8% para +3,0%, o trailing stop sobe junto muito perto do preço (ex: 0,6% abaixo da máxima).
- Frequentemente, oscilações normais de 1 ou 2 candles acionam o trailing stop e liquidam a posição precocemente, impedindo o trader de capturar tendências maiores do dia.
- A técnica de **Teto de Trailing Stop**:
  1. Acompanha a valorização e sobe o stop para travar um lucro mínimo desejado.
  2. Ao atingir o teto de proteção configurado (ex: +1,5%), o piso de stop estaciona nesse nível garantido.
  3. A partir daí, a ação pode oscilar com mais amplitude acima desse patamar sem ser estopada, a menos que perca o piso do lucro protegido ou atinja o Take Profit total.

---

## 2. Requisitos de Engenharia

### A. Configurações (`packages/core`)
- Adicionar no schema Zod e em `TradingConfiguration`:
  - `TRAILING_STOP_CAP_PCT`: Percentual máximo de proteção do stop móvel (ex: 0.015 para +1,5%).
- Valores opcionais ou configuráveis via painel/banco de dados.

### B. Motor de Risco (`packages/risk-engine`)
- Em `applyB3Risk`:
  - Calcular o piso protegido do trailing stop:
    ```typescript
    let protectedFloor = highest * (1 - trailingStopPct);
    if (typeof trailingStopCapPct === 'number' && trailingStopCapPct > 0) {
      const capPrice = entryPrice * (1 + trailingStopCapPct);
      protectedFloor = Math.min(protectedFloor, capPrice);
    }
    protectedFloor = Math.max(breakevenPrice, protectedFloor);
    ```
  - Garantir que `protectedFloor` nunca seja inferior ao breakeven (`entryPrice * 1.0006`).

### C. Alinhamento de Prompt da IA (`packages/ai`)
- Informar no prompt à IA que o Stop Móvel possui um teto de lucro travado em R$ X.XX (+Y.Y%), orientando o modelo sobre a proteção já garantida da posição.

### D. Testes e Qualidade
- Testes unitários no `@bolinha/risk-engine` cobrindo cenários com preços oscilando acima do teto sem acionar stop prematuro.
- Executar `pnpm test` e `pnpm typecheck`.
