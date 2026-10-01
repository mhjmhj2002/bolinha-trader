# Ciclo de trading

1. Garante conta conceitual e heartbeat.
2. Busca candles 1m, 5m e 15m; calcula indicadores e normalizações localmente.
3. Persiste snapshot, monta prompt limitado e tenta OpenRouter com fallback.
4. Persiste decisão e uso de IA; aplica risco.
5. Para HOLD, encerra. Para operação, persiste ordem PENDING, envia à Testnet e grava trade/posição atomically.
6. `forceClosePosition()` só vende a quantidade armazenada na posição conceitual, nunca o BTC extra da Testnet.
