# BUG-07: Sincronização e Amostragem Temporal Coerente entre Candles (1m, 5m e 15m)

## Status: to-do
**Data de Criação:** 2026-10-16  
**Prioridade:** Alta  
**Origem:** Auditoria Operacional de Gaps de Mercado e Execução B3 (16/10/2026)  
**Pacotes Afetados:** `@bolinha/exchange`, `@bolinha/market-data`

---

## 1. Contexto e Problema Observado

No simulador de mercado B3 ([`B3MarketDataService`](file:///home/mhj/git/bolinha-trader/packages/exchange/src/b3/market-data.ts)), a geração sintética de candles calcula cada tempo gráfico (`1m`, `5m` e `15m`) através de loops estocásticos completamente independentes.

No ciclo operacional do worker:
```typescript
const [one, five, fifteen] = await Promise.all([
  this.exchange.candles('1m'),
  this.exchange.candles('5m'),
  this.exchange.candles('15m'),
]);
```
Como cada chamada roda uma semente e uma série temporal separada de *Random Walk*, os preços de fechamento mais recentes de cada intervalo divergiram expressivamente no mesmo instante:
- No snapshot ID 381, por exemplo:
  - `1m.price`: **R$ 28,62**
  - `5m.price`: **R$ 28,30**
  - `15m.price`: **R$ 28,78**

### Impacto:
A IA recebe no mesmo momento cotações e médias móveis (EMA9/EMA21) com preços conflitantes para o mesmo ativo no exato mesmo segundo. Isso distorce a confluência técnica de múltiplos tempos gráficos (*multi-timeframe analysis*), levando a IA a registrar justificativas contraditórias e hesitações operacionais.

---

## 2. Requisitos de Implementação

1. **Amostragem / Agrupamento Temporal Derivado de 1m:**
   - Em vez de gerar candles de 5m e 15m de forma avulsa e independente, o `B3MarketDataService` deve derivar os tempos gráficos maiores agrupando as velas de 1m:
     - Cada candle de 5m deve agregar exatamente 5 candles consecutivos de 1m (`open` do primeiro, `high` máximo, `low` mínimo, `close` do último e soma dos volumes).
     - Cada candle de 15m deve agregar 15 candles de 1m.
2. **Preço Único de Mercado no Tempo Presente:**
   - O preço de fechamento (`close`) da vela mais recente de 1m, 5m e 15m deve ser rigorosamente o mesmo valor no momento do snapshot.
3. **Persistência do Histórico em Memória:**
   - Manter a continuidade temporal da série a cada novo ciclo de 3 minutos, adicionando as novas velas de 1m e atualizando dinamicamente as velas de 5m e 15m em formação.

---

## 3. Critérios de Aceite

- [ ] A chamada de candles para `1m`, `5m` e `15m` em um mesmo timestamp retorna o mesmo preço de fechamento atual (`close`).
- [ ] Os candles de 5m e 15m refletem fielmente a agregação OHLCV dos candles de 1m subjacentes.
- [ ] Testes unitários em `@bolinha/exchange` validando a agregação de velas e consistência de preços entre múltiplos tempos gráficos.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
