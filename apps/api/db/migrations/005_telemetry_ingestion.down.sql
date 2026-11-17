ALTER TABLE telemetry_points
  DROP CONSTRAINT IF EXISTS telemetry_points_driver_recorded_key,
  DROP COLUMN IF EXISTS filter_reasons;
