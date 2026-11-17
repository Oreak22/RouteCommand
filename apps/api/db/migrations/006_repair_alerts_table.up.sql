-- Migration 001 defines alerts as part of the canonical base schema. This
-- forward repair restores it in existing databases where that table drifted
-- out of sync after migration 001 had already been recorded.
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type alert_type NOT NULL,
  severity alert_severity NOT NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL,
  zone_id uuid REFERENCES zones(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status alert_status NOT NULL DEFAULT 'OPEN',
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (resolved_at IS NULL OR resolved_at >= created_at),
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'alerts_set_updated_at'
      AND tgrelid = 'public.alerts'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER alerts_set_updated_at
      BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS alerts_status_created_idx ON alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_driver_created_idx ON alerts(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_payload_gin_idx ON alerts USING gin(payload);
