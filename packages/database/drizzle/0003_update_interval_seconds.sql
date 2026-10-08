-- TASK-04: Update default interval_seconds from 600s to 180s for active configurations
-- This updates existing configurations that still have the legacy default of 600 seconds.

DO $$
BEGIN
  -- Update singleton configuration if still set to legacy 600s
  UPDATE trading_configuration
  SET interval_seconds = 180, updated_at = now()
  WHERE id = 1 AND interval_seconds = 600;

  -- If the current version is 600s, close it and record version with 180s
  IF EXISTS (SELECT 1 FROM trading_configuration_versions WHERE configuration_id = 1 AND valid_to IS NULL AND interval_seconds = 600) THEN
    UPDATE trading_configuration_versions
    SET valid_to = now()
    WHERE configuration_id = 1 AND valid_to IS NULL;

    INSERT INTO trading_configuration_versions(
      configuration_id, timezone, start_time, stop_new_positions_time, force_close_time, end_time,
      interval_seconds, initial_bank_usdt, max_position_percent, valid_from
    )
    SELECT id, timezone, start_time, stop_new_positions_time, force_close_time, end_time,
      180, initial_bank_usdt, max_position_percent, now()
    FROM trading_configuration
    WHERE id = 1;
  END IF;
END $$;
