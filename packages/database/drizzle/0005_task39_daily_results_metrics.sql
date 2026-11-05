-- TASK-39: Metricas corretas em daily_results e metricas estendidas por posicao
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS net_return_pct numeric(20,8);
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS bypass_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS position_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS win_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS loss_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS avg_win_usdt numeric(20,8) NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS avg_loss_usdt numeric(20,8) NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS profit_factor numeric(20,8);
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS expectancy_usdt numeric(20,8) NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS fees_pct_of_gross numeric(20,8);

ALTER TABLE positions ADD COLUMN IF NOT EXISTS highest_price numeric(28,12);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS lowest_price numeric(28,12);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS mae_pct numeric(20,8);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS mfe_pct numeric(20,8);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS duration_seconds integer;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_reason text;
