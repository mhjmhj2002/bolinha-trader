-- The operational row remains deliberately singleton (id = 1), while this
-- append-only table preserves every value that was in effect for a session.
CREATE TABLE IF NOT EXISTS trading_configuration_versions (
  id serial PRIMARY KEY,
  configuration_id integer NOT NULL REFERENCES trading_configuration(id),
  timezone varchar(64) NOT NULL,
  start_time time NOT NULL,
  stop_new_positions_time time NOT NULL,
  force_close_time time NOT NULL,
  end_time time NOT NULL,
  interval_seconds integer NOT NULL,
  initial_bank_usdt numeric(20,8) NOT NULL,
  max_position_percent numeric(5,2) NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  CHECK (start_time < stop_new_positions_time AND stop_new_positions_time < force_close_time AND force_close_time < end_time),
  CHECK (interval_seconds > 0),
  CHECK (initial_bank_usdt > 0),
  CHECK (max_position_percent > 0 AND max_position_percent <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS trading_configuration_versions_one_current
  ON trading_configuration_versions(configuration_id) WHERE valid_to IS NULL;

INSERT INTO trading_configuration_versions(
  configuration_id, timezone, start_time, stop_new_positions_time, force_close_time, end_time,
  interval_seconds, initial_bank_usdt, max_position_percent, valid_from
)
SELECT id, timezone, start_time, stop_new_positions_time, force_close_time, end_time,
  interval_seconds, initial_bank_usdt, max_position_percent, updated_at
FROM trading_configuration
WHERE NOT EXISTS (SELECT 1 FROM trading_configuration_versions);

ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS configuration_version_id integer
  REFERENCES trading_configuration_versions(id);

-- Sessions created before configuration versioning retain a pointer to the
-- only version that existed at migration time; future sessions are stamped by
-- the worker when they are first persisted.
UPDATE trading_sessions
SET configuration_version_id = (
  SELECT id FROM trading_configuration_versions
  WHERE configuration_id = 1
  ORDER BY id DESC LIMIT 1
)
WHERE configuration_version_id IS NULL;
