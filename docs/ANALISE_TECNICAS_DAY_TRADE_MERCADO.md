# Análise Estratégica: Técnicas de Mercado e Gestão de Risco em Day Trade

Este documento apresenta um mapeamento detalhado de técnicas consagradas utilizadas no mercado profissional e plataformas de trading (ex: Profit Pro, MetaTrader 5, Bloomberg Terminal, TradeStation), comparando o que o **Bolinha Trader** já possui implementado e o que ainda **não possui** (gaps a implementar antes de ir para o mercado real com capital real).

---

## 1. O Ponto de Partida: A Técnica do Stop Móvel Escalonado (Trailing Stop com Teto / Cap)

### A Ideia do Usuário
> *"O stop loss aumenta proporcional ao lucro e para de aumentar quando atingir X% acima do valor de compra."*

### O que o Bolinha Trader já tem hoje:
- **Breakeven Automático:** Ao atingir **+0,8%** de ganho intradiário, o stop loss sai do prejuízo e sobe automaticamente para o preço de entrada cobrindo custos (`entryPrice * 1.0006`).
- **Trailing Stop Contínuo:** Quando o trade supera o breakeven, o stop de proteção sobe continuamente ficando a uma distância fixa da máxima atingida (`highestPrice * (1 - trailingStopPct)`).

### O que NÃO temos ainda (O Gap):
- **Teto Fixo de Trailing Stop (Cap / Lock-in):** No código atual, o Trailing Stop continua perseguindo a máxima indefinidamente até ser estopado na volta ou atingir o final da sessão. Não há um parâmetro que diga: *"Depois de garantir +1,5% de lucro, trave o stop ali e dê espaço livre para o papel oscilar sem ser estopado por uma volatilidade passageira"*.
- **Take Profit com Ordem OCO (One-Cancels-the-Other) na Corretora:** O robô só fecha no próximo ciclo de 3 minutos. No mundo real, a ordem de stop e take profit devem ficar apregoadas diretamente no livro da B3.

---

## 2. Matriz Comparativa: O Que o Bolinha Trader Já Tem vs. O Que Falta

| Categoria | Técnica Consagrada de Mercado | No Bolinha Trader? | Status / Prioridade |
|---|---|---|---|
| **Gestão de Stop** | Breakeven (Stop no 0 a 0) | ✅ Sim | Implementado no Motor de Risco |
| **Gestão de Stop** | Trailing Stop (Stop Móvel) | ✅ Sim | Implementado no Motor de Risco |
| **Gestão de Stop** | Teto de Trailing Stop (Lucro Travado) | ❌ Não | **Média** |
| **Gestão de Stop** | Stop ATR (Volatilidade Real do Ativo) | ❌ Não | **Alta** |
| **Execução** | Ordens Bracket / OCO no Broker (Stop + Gain na B3) | ❌ Não (só via ciclo) | **CRÍTICA para o Real** |
| **Execução** | Saída Parcial Automática (Scale-out) com Alvos Múltiplos | ⚠️ Parcial (IA decide) | **Alta** (deveria ser mecânica) |
| **Execução** | Prevenção de Slippage em Venda (Slippage Guard) | ✅ Sim | Implementado no Worker |
| **Risco / Capital** | Limite de Perda Diária Global (Daily Loss Limit / Circuit Breaker) | ❌ Não | **CRÍTICA para o Real** |
| **Risco / Capital** | Trava de Drawdown Máximo Acumulado | ❌ Não | **Alta** |
| **Risco / Capital** | Trava de Consecutivas Perdas (Streak Stopper) | ❌ Não | **Média** |
| **Horários / Sessão**| Janela de Fechamento Compulsório de Posição (Day Trade) | ✅ Sim | Implementado (`NO_NEW_POSITIONS`, `FORCE_CLOSE`) |
| **Horários / Sessão**| Filtro de Abertura e Notícias (Evitar 10:00 - 10:15 e PayRoll) | ❌ Não | **Alta** |
| **Análise Técnica** | Confluência Multi-Timeframe (1m, 5m, 15m) | ✅ Sim | Implementado (`EMA9 > EMA21` e `RSI < 70`) |
| **Análise Técnica** | VWAP Intradiária (Volume Weighted Average Price) | ❌ Não | **CRÍTICA para Ações B3** |
| **Análise Técnica** | Indicador de Volume / Agressão (OBV / Saldo de Agressão) | ❌ Não | **Alta** |
| **Seleção de Ativo**| Scanner Multi-Ativos com Ranking | ✅ Sim | Implementado na B3 |
| **Seleção de Ativo**| Filtro de Liquidez Mínima / Spread Bid-Ask | ⚠️ Parcial | **Alta** |

---

## 3. Detalhamento das Técnicas Críticas que Ainda NÃO Temos

### 1. Daily Loss Limit (Trava de Perda Diária Máxima / Circuit Breaker da Conta)
* **Como funciona no mundo real:**
  Se no decorrer do dia as operações acumularem uma perda líquida pré-definida (ex: -R$ 10,00 em uma banca de R$ 100,00, ou seja, -10%), o robô **encerra imediatamente as posições e trava qualquer nova operação pelo resto do dia**.
* **Por que é vital:**
  Evita o chamado "dia de fúria" da IA ou uma sequência de stops em dia de mercado lateral/errático que quebre a banca.
* **Risco sem isso:** A IA pode tentar várias entradas e liquidar a banca em um único dia ruim.

---

### 2. VWAP Intradiária (O Indicador Rei do Day Trade Institucional na B3)
* **Como funciona no mundo real:**
  A **VWAP** (Volume Weighted Average Price) é o preço médio ponderado por volume desde a abertura do pregão. Os grandes players institucionais (fundos e bancos que movimentam a B3) operam referenciados na VWAP.
  - Regra clássica: **Nunca comprar** se o preço estiver abaixo da VWAP (tendência intraday desfavorável e fluxo vendedor institucional dominante).
  - Comprar somente quando o preço rompe ou se apoia na VWAP para cima.
* **Risco sem isso:** A IA compra papéis que estão abaixo da VWAP achando que estão em alta no gráfico de 1m, mas estão na verdade sendo vendidos em massa por institucionais.

---

### 3. Ordens Bracket / OCO Nativas no Broker (Proteção Sub-Segundo)
* **Como funciona no mundo real:**
  No envio da ordem de compra à B3, o sistema já anexa simultaneamente duas ordens filhas no servidor da corretora:
  1. Uma ordem de Stop Loss (ex: -1,2%);
  2. Uma ordem de Take Profit (ex: +2,0%).
  Se uma executar, a outra é cancelada automaticamente (OCO = *One Cancels the Other*).
* **Por que é vital:**
  Hoje o Bolinha Trader roda de 3 em 3 minutos. Se sair uma notícia de impacto ou um *flash crash* no minuto 1, o preço pode despencar 5% antes do próximo ciclo do robô rodar. A ordem OCO no broker protege a conta na velocidade de milissegundos.

---

### 4. Stop Baseado em Volatilidade Real (ATR - Average True Range)
* **Como funciona no mundo real:**
  Hoje usamos um percentual estático (ex: 1,2% ou 1,8%). Mas cada ação tem uma volatilidade diferente:
  - `ITUB4` oscila pouco por candle (ex: 0,3%). Um stop de 1,2% é amplo e seguro.
  - `PETR4` ou `VALE3` em dias voláteis oscilam 1,5% em apenas um candle de 5m.
  O **Stop ATR** calcula a amplitude média real dos últimos candles e posiciona o stop logo abaixo dessa oscilação normal (ex: $2 \times \text{ATR}$), impedindo de ser violinado por mera oscilação natural.

---

### 5. Filtro de Horários de Alta Volatilidade e Aberturas (Blackout Windows)
* **Como funciona no mundo real:**
  - **10:00 às 10:15:** Abertura do mercado à vista na B3 (alta turbulência, leilões atrasados e spreads largos). Plataformas profissionais não operam nos primeiros 10 a 15 minutos.
  - **10:30:** Abertura de Nova York (NYSE/Nasdaq) - gera gaps e solavancos imediatos nos papéis brasileiros.
  - **Dias de PayRoll e Super Quarta (FED / Copom):** Bloqueio de 10 minutos antes e depois da divulgação.

---

### 6. Parciais Mecânicas Automáticas (Scale-out com 2 Alvos Fixos)
* **Como funciona no mundo real:**
  Se o robô comprou 2 ou 4 ações:
  - Ao bater **+1,0%**: liquida automaticamente 50% da posição no book, embolsa o lucro e joga o stop do restante no zero a zero (breakeven).
  - O restante (os outros 50%) fica livre para tentar buscar o alvo maior (+2,5% ou +3,0%) sem nenhum estresse financeiro.
* **No Bolinha hoje:** A IA é avisada no prompt que pode vender parcial, mas a decisão ainda é delegada à subjetividade do modelo em vez de uma regra matemática dura.

---

### 7. Trava de Sequência de Perdas (Max Consecutive Losses)
* **Como funciona no mundo real:**
  Se o robô tomar 3 stops seguidos no mesmo dia, o mercado não está respeitando a estratégia naquele pregão. O sistema desliga e só volta no dia seguinte.

---

## 4. Roteiro Recomendado de Implementação (Roadmap para o Mundo Real)

Para levar o Bolinha Trader com segurança máxima para contas reais, a ordem lógica de implementação das proteções que faltam é:

1. **Fase 1 - Proteções Financeiras Globais (Circuit Breakers):**
   - Implementar `DAILY_MAX_LOSS_BRL` (limite diário de perda).
   - Implementar `MAX_CONSECUTIVE_LOSSES` (trava de 2 ou 3 stops no dia).
2. **Fase 2 - Refinamento Técnico Institucional:**
   - Adicionar o cálculo e filtro de **VWAP** no pacote `@bolinha/market-data`.
   - Adicionar o **Stop ATR** adaptativo para não tomar violinadas em papéis voláteis.
3. **Fase 3 - Gestão Avançada de Posição:**
   - Implementar a trava de ganho máximo do Trailing Stop (sua sugestão de teto).
   - Saídas parciais automáticas e mecânicas no motor de risco (50% no primeiro alvo).
4. **Fase 4 - Infraestrutura de Corretora Real:**
   - Ordens Bracket / OCO reais na B3 / corretora via gateway MT5/Profit.
