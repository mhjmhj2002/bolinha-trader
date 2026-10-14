# BUG-03: Colisão de Order ID na Reinicialização do Paper Broker e Dimensionamento de Banca Fracionada

## Contexto e Sintoma Observado
Durante a operação com paper broker na B3 com banca de R$ 100,00, foram observados os seguintes problemas críticos:
1. **Colisão de chave única em `orders_binance_order_id_unique` (`Key (broker_order_id)=(B3-ORD-1) already exists`)**:
   - Ao reiniciar o worker ou contêineres, o `orderCounter` em `B3PaperBroker` reiniciava em `0`.
   - Ao emitir a próxima ordem (`B3-ORD-1`), o banco de dados rejeitou com violação de unicidade da chave `broker_order_id`.
   - A ordem ficou em estado `PENDING` (id 4), travando todos os ciclos subsequentes com falha de reconciliação em loop.
2. **Dimensionamento de Compra Fracionada e Gestão de Banca**:
   - A IA tentou alocar R$ 30,65 (1 ação) quando o saldo em caixa era R$ 9,99 (pois R$ 89,88 estava em posição ou o caixa restante era insuficiente), ou comprou quase 100% da banca em uma única ordem de 3 ações.
   - O motor de risco B3 deve respeitar rigorosamente o saldo disponível em caixa e o teto percentual parametrizado (`maxPositionPercent`), sem permitir ordens que excedam a capacidade financeira disponível (`cashBrl`), além de orientar explicitamente o prompt da IA com o saldo exato e a quantidade máxima de ações que o caixa pode comprar.

## Critérios de Aceite
1. **Identificadores Únicos e Não Conflitantes no Paper Broker**:
   - O `orderId` e `tradeId` gerados pelo `B3PaperBroker` devem ser globalmente únicos (ex: timestamp + UUID/contador aleatório ou prefixo seguro), evitando colisões com execuções prévias após reinicializações.
2. **Recuperação e Resolução da Ordem Pendente Órfã**:
   - Criar mecanismo/migração para resolver ordens pendentes com falha ou garantir reconciliação segura sem travar o worker.
3. **Validação Rigorosa de Caixa no Motor de Risco (`applyB3Risk`)**:
   - Garantir que `amountBrl <= account.cashBrl` e `quantity * price <= account.cashBrl`.
   - O prompt da IA (`buildB3Prompt`) deve informar claramente a quantidade máxima de ações possíveis de comprar com o saldo em caixa atual (`Math.floor(cashBrl / currentPrice)`).
4. **Validação Completa**:
   - Testes unitários cobrindo id único no paper broker, dimensionamento de risco com caixa limitado e ausência de travamento por chave duplicada.
   - `pnpm test` e `pnpm typecheck` 100% verdes.
