CREATE TABLE IF NOT EXISTS trading_configuration (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone varchar(64) NOT NULL,
  start_time time NOT NULL,
  stop_new_positions_time time NOT NULL,
  force_close_time time NOT NULL,
  end_time time NOT NULL,
  interval_seconds integer NOT NULL,
  initial_bank_usdt numeric(20,8) NOT NULL,
  max_position_percent numeric(5,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_time < stop_new_positions_time AND stop_new_positions_time < force_close_time AND force_close_time < end_time),
  CHECK (interval_seconds > 0),
  CHECK (initial_bank_usdt > 0),
  CHECK (max_position_percent > 0 AND max_position_percent <= 100)
);

-- A single active row is sufficient for the current product. The INSERT is
-- idempotent so existing deployments keep their explicitly saved schedule.
INSERT INTO trading_configuration(id,timezone,start_time,stop_new_positions_time,force_close_time,end_time,interval_seconds,initial_bank_usdt,max_position_percent)
SELECT 1,'America/Sao_Paulo','09:00','17:50','17:55','18:00',600,20,100
WHERE NOT EXISTS (SELECT 1 FROM trading_configuration);

CREATE OR REPLACE FUNCTION set_trading_configuration_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trading_configuration_updated_at ON trading_configuration;
CREATE TRIGGER trading_configuration_updated_at
BEFORE UPDATE ON trading_configuration
FOR EACH ROW EXECUTE FUNCTION set_trading_configuration_updated_at();

ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS stop_new_positions_time time;
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS force_close_time time;
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS interval_seconds integer;
