-- TASK-38: Adiciona métrica de rate limit (HTTP 429) em daily_results
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS rate_limit_429_count integer NOT NULL DEFAULT 0;
