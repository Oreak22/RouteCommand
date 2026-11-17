SELECT create_monthly_telemetry_partition(
  (date_trunc('month', current_date) - interval '1 month')::date
);

ALTER TABLE telemetry_points
  ADD CONSTRAINT telemetry_points_driver_recorded_key UNIQUE (driver_id, recorded_at),
  ADD COLUMN filter_reasons text[] NOT NULL DEFAULT '{}';
