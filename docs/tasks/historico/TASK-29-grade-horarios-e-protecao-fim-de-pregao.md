# TASK-29: Ajuste de Grade de Horários Operacionais e Proteção de Fim de Pregão (EOD Unwind)

## Contexto e Motivação
Em operações intradiárias na B3 (Day Trade de ações), compras executadas após as 16:45 ficam sem tempo hábil para maturação e sofrem com a pressão vendedora em massa (zeragens compulsórias de corretoras, leilão de fechamento a partir das 17:55 e fechamento de posições de traders).
Na sessão recente, novas compras ocorreram até as 17:00:02, o trade chegou a valorizar fortemente (+R$ 0,65), mas ao invés de realizar lucro ou proteger a posição, a operação foi carregada até as 17:55:00, quando o `FORCE_CLOSE` compulsório liquidou a mercado na baixa a R$ 30,07 com prejuízo de -R$ 0,26.

## Objetivos
1. **Grade Operacional Padrão e Segura:**
   - `stopNewPositions`: Mudar padrão de `17:50` para **`16:45`** (nenhuma compra nova permitida após as 16:45).
   - `forceClose`: Mudar padrão de `17:55` para **`17:15`** (encerramento forçado antecipado para garantir liquidez e evitar zeragens caóticas e call de fechamento).
   - Atualizar banco de dados / defaults operacionais e esquemas.
2. **Modo Proteção de Fim de Sessão (EOD Unwind / Tightening):**
   - Durante a janela de `NO_NEW_POSITIONS` (após as 16:45 até `forceClose` 17:15):
     - Se a posição estiver com lucro positivo acima dos custos operacionais (`gainPct > 0.001` ou cobrindo taxas), o motor de risco intervém e aciona `SELL` antecipado para colocar o lucro no bolso em vez de arriscar devolução em HOLD até o force close.
     - Redução do gatilho de Take Profit e trailing stop mais agressivo no final do dia.
3. **Testes e Validação:**
   - Atualizar testes de unidade (`pnpm test`) e tipagem (`pnpm typecheck`).
