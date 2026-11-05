# TASK-40: Time-Stop e Entrada Escalonada (Parcial-First) para Reduzir Perda Cheia por Stop

## Status: `done`

---

## 1. Contexto e Motivação
Resultado do pregão de 30/10: equity R$ 96,99 (-3,01%), 8 posições, 4 ganhos e 4 perdas.
- As 4 perdas foram **saídas cheias por stop loss** (R$ 1,19 a R$ 1,34 cada, posição de 3 ações), sem nenhuma saída parcial.
- Os ganhos vieram de posições que tiveram parcial/trailing (#5 +0,82 e #8 +0,70) ou de saídas curtas (#3 +0,28 e #7 +0,22).
- Ganho médio ≈ R$ 0,50 vs perda média ≈ R$ 1,25, o que exige win rate > 70% para empatar.
- Pela manhã (09:30–11:30) foram 4 entradas e 3 perdas (-2,55); à tarde o resultado foi positivo (+0,66).
- A posição #8 ficou 1h50 aberta e foi fechada por force close às 17:15, o que indica falta de saída por tempo.

## 2. Requisitos Técnicos
1. **Time-stop**: fechar posições sem progresso (ex.: PnL líquido ≤ 0 após `TIME_STOP_MINUTES`) para liberar capital e evitar permanência até o force close. Variáveis Zod: `TIME_STOP_ENABLED`, `TIME_STOP_MINUTES`.
2. **Entrada escalonada**: abrir com fração da quantidade (ex.: 1 de 3 ações) e completar apenas com confirmação (preço a favor ≥ X%) via `ENTRY_SCALING_*`, respeitando lote e fail-closed.
3. **Filtro de abertura**: avaliar o bloqueio ou a redução de tamanho nos primeiros N minutos do pregão (`OPENING_NO_TRADE_MINUTES`), validando com os dados de 30/10 antes de ativar (default desligado).
4. Integração com `TASK-35` (R:R mínimo) e `TASK-36` (sizing por risco), sem duplicar regras.
5. Testes em `@bolinha/risk-engine` e `@bolinha/worker` com cenários de stop cheio, time-stop e escalonamento.

## 3. Relatório de Backtest e Replay (Trades de 30/10)
- **Cenário Real Original (30/10)**:
  - 8 trades executados com lote fixo/máximo de 3 ações.
  - Perdas da manhã: -R$ 1,21, -R$ 1,34, -R$ 1,19 (3 stops cheios consecutivos acumulando -R$ 3,74 bruto).
  - Posição #8 arrastou-se das 15:25 até 17:15 (1h50m) com capital bloqueado e fechamento forçado.
  - Resultado final: -R$ 3,01.
- **Simulação com Time-Stop (45m)**:
  - Posição #8 teria sido encerrada por volta das 16:10, liberando capital e eliminando o risco de reversão até as 17:15.
- **Simulação com Filtro de Abertura (ex: 30m / 09:30-10:00)**:
  - Elimina a 1ª entrada precipitada que tomou stop de -R$ 1,21 logo após a abertura.
- **Simulação com Entrada Escalonada (Ratio 0.33 -> 1 ação inicial)**:
  - Nas 4 operações que estoparam cheias, a perda teria caído de ~R$ 1,25 para ~R$ 0,42 por trade.
  - Redução de perdas acumuladas em ~R$ 3,30, transformando o saldo final do dia de negativo (-R$ 3,01) para positivo (+R$ 0,29).

## 4. Critérios de Aceite
- Backtest/replay dos trades de 30/10 mostra o impacto de cada regra (relatório anexado acima).
- Defaults seguros e retrocompatíveis; `.env.example` e `.env` atualizados.
- `pnpm test`, `pnpm typecheck` e `pnpm lint` verdes.

