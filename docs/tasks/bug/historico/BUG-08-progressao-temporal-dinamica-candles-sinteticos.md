# BUG-08: Progressão Temporal Dinâmica e Janela Deslizante de Candles Sintéticos no Market Data

## Status: to-do
**Data de Criação:** 2026-10-19  
**Prioridade:** Alta  
**Origem:** Auditoria Operacional de Execução Contínua B3 ([`RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md`](file:///home/mhj/git/bolinha-trader/docs/tasks/bug/RELATORIO-AUDITORIA-BUGS-OPERACIONAIS.md))  
**Pacotes Afetados:** `@bolinha/exchange`, `@bolinha/market-data`

---

## 1. Contexto e Problema Observado

No simulador de mercado B3 ([`B3MarketDataService`](file:///home/mhj/git/bolinha-trader/packages/exchange/src/b3/market-data.ts)), a série temporal base de candles de 1m é gerada sinteticamente na primeira inicialização do container e armazenada em cache de memória (`candlesStore`):

```typescript
const existingSeries = this.candlesStore.get(symbol) ?? { '1m': [], '5m': [], '15m': [] };
const now = Date.now();
const required1mCount = Math.max(limit * 15, 1500);

let series1m = existingSeries['1m'];
if (series1m.length < required1mCount) {
  series1m = this.generateSynthetic1m(symbol, required1mCount, now);
  existingSeries['1m'] = series1m;
  this.candlesStore.set(symbol, existingSeries);
}
```

### Mecanismo da Falha:
1. No primeiro ciclo do dia (às 09:00 / 12:00 UTC), `series1m` é populada com 1500 candles terminando no horário daquele instante (preço de fechamento gerado: R$ 29,88).
2. Nos ciclos subsequentes do worker (executados a cada 3 minutos, ex: 09:03, 09:06, ..., 15:20), `series1m.length` já atinge 1500. A checagem `if (series1m.length < required1mCount)` avalia como **falsa**.
3. **Não há rotina que verifique a diferença entre `now` e o `closeTime` do último candle**, nem inserção incremental de novas velas de 1m transcorridas no tempo.
4. O cache de memória permanece congelado no primeiro instante da manhã por horas.

### Impacto:
- Em 19/10/2026, todos os 128 ciclos após a abertura receberam exatamente o mesmo snapshot congelado com preço cravado em **R$ 29,88**, volume em **2081** e RSI em **34,48**.
- A IA foi acionada 128 vezes via OpenRouter (com custo financeiro em tokens), mas como o mercado simulado não oscila nem 1 centavo, o modelo respondeu invariavelmente `HOLD`.
- O robô não opera e a simulação perde todo o sentido operacional dinâmico.

---

## 2. Requisitos de Implementação

1. **Avanço Temporal Incremental de Velas (Janela Deslizante):**
   - Ao invocar `candles(ticker, interval, limit)` ou `price(ticker)`, verificar o timestamp do último candle armazenado (`lastCandle.closeTime`).
   - Se `now >= lastCandle.closeTime + 60_000`, calcular quantos minutos (`elapsedMinutes = Math.floor((now - lastCandle.closeTime) / 60_000)`) se passaram desde a última atualização.
   - Gerar sequencialmente os `elapsedMinutes` candles novos a partir do preço de fechamento anterior (`lastCandle.close`), aplicando volatilidade estocástica e reversão à média realistas.
   - Anexar as novas velas ao final da série de 1m e descartar as velas mais antigas para manter o tamanho fixo (ex: mantendo os últimos 1500 ou 2000 candles de 1m).
2. **Atualização Imediata das Agregações:**
   - Garantir que as agregações de 5m e 15m agreguem as novas velas de 1m e reflitam o novo preço corrente e volume.
3. **Sincronização com `price()` e `currentPrices`:**
   - Garantir que `price()` sempre atualize a cotação com a vela mais recente gerada para o momento `now`.

---

## 3. Critérios de Aceite

- [ ] Simular avanço no tempo (ex: avançar 5 ou 10 minutos após a geração inicial) e verificar que novas velas de 1m são adicionadas com timestamps corretos e preços contínuos.
- [ ] A série de candles de 1m mantém seu tamanho delimitado (sem vazamento de memória / crescimento infinito).
- [ ] O preço de mercado e os indicadores de snapshot oscilam naturalmente entre ciclos consecutivos com intervalo de 3 minutos.
- [ ] Testes unitários comprovando o avanço temporal dinâmico em `packages/exchange/src/b3/market-data.ts`.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
