ALTER TABLE geofence_states
  ADD COLUMN pending_inside boolean,
  ADD COLUMN pending_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT geofence_states_pending_count_nonnegative CHECK (pending_count >= 0),
  ADD CONSTRAINT geofence_states_pending_consistent CHECK (
    (pending_inside IS NULL AND pending_count = 0) OR
    (pending_inside IS NOT NULL AND pending_count > 0)
  );

WITH duplicate_alerts AS (
  SELECT id, row_number() OVER (
    PARTITION BY type, driver_id, zone_id, shipment_id ORDER BY created_at, id
  ) AS position
  FROM alerts
  WHERE status <> 'RESOLVED' AND driver_id IS NOT NULL
)
UPDATE alerts a
SET status = 'RESOLVED', resolved_at = now(),
    payload = a.payload || jsonb_build_object('resolutionReason', 'Deduplicated during alert index migration.')
FROM duplicate_alerts d
WHERE a.id = d.id AND d.position > 1;

CREATE UNIQUE INDEX alerts_one_open_driver_zone_type_idx
  ON alerts(type, driver_id, zone_id)
  WHERE status <> 'RESOLVED' AND driver_id IS NOT NULL AND zone_id IS NOT NULL;

CREATE UNIQUE INDEX alerts_one_open_driver_global_type_idx
  ON alerts(type, driver_id)
  WHERE status <> 'RESOLVED' AND driver_id IS NOT NULL AND zone_id IS NULL;

CREATE UNIQUE INDEX alerts_one_open_shipment_type_idx
  ON alerts(type, shipment_id)
  WHERE status <> 'RESOLVED' AND shipment_id IS NOT NULL;
