# TASK-11: Calibração Dinâmica de Stop Loss e Banda de Tolerância ao Ruído Intradiário

## Status: to-do
**Data de Criação:** 2026-10-16  
**Prioridade:** Alta  
**Origem:** Auditoria Operacional de Gaps de Mercado e Execução B3 (16/10/2026)  
**Pacotes Afetados:** `@bolinha/ai`, `@bolinha/risk-engine`, `@bolinha/core`

---

## 1. Contexto e Problema Observado

Na sessão operacional do dia 16/10/2026, 3 de 4 operações foram encerradas na rodada imediatamente seguinte à compra (3 minutos de permanência).
A causa identificada foi a imposição estrita de um Stop Loss mandatório fixo em **-0,8%** no prompt da IA, combinada com o ciclo operacional de **3 minutos** e a volatilidade média dos candles.

### Mecanismo do Problema:
- Com preço de R$ 29,00, uma margem de -0,8% representa apenas **R$ 0,23**.
- Em qualquer ativo ou simulador com volatilidade intradiária típica (~0,2% por vela de 1 minuto), 3 candles normais facilmente acumulam uma oscilação de -0,8%, disparando o stop mandatório da IA antes mesmo que o movimento técnico se desenhe.
- Isso gera o fenômeno de **chicote de mercado (*whipsaw*)**: o robô compra no rompimento, toma ruído na vela seguinte, estopa na mínima e perde a recuperação subsequente.

---

## 2. Requisitos de Implementação

1. **Ajuste da Faixa Base de Stop Loss no Prompt B3 (`buildB3Prompt`):**
   - Recalibrar o Stop Loss inicial padrão de **-0,8%** para uma faixa mais adequada ao ciclo de 3 minutos, entre **-1,2% e -1,5%** (ou cálculo dinâmico baseado na volatilidade recente/ATR da janela de 1m).
   - Manter a regra anti-HOLD infinito: se o preço violar o novo patamar calibrado, a saída continua obrigatória.
2. **Harmonização com o Motor de Risco (`applyB3Risk`):**
   - Garantir alinhamento entre o Stop Loss anunciado no prompt e o `maxStopLossPct` do motor de risco (ex: prompt com stop de -1,2% a -1,5% e trava rígida de segurança no motor de risco em -1,8% a -2,0%).
3. **Parametrização Configurável:**
   - Permitir parametrização do percentual de stop loss através das configurações operacionais ou variáveis de ambiente com defaults seguros e tipados via Zod em `@bolinha/core`.

---

## 3. Critérios de Aceite

- [ ] Prompt B3 calcula e expõe nível de Stop Loss calibrado de forma compatível com ciclos de 3 minutos (evitando disparos prematuros por ruído de 1 único ciclo).
- [ ] O motor de risco `@bolinha/risk-engine` mantém proteção de corte rígido coerente com a nova calibragem.
- [ ] Testes unitários em `@bolinha/ai` e `@bolinha/risk-engine` cobrindo os novos cenários de stop.
- [ ] `pnpm test` e `pnpm typecheck` 100% aprovados.
