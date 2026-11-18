DROP INDEX IF EXISTS alerts_one_open_driver_zone_type_idx;
DROP INDEX IF EXISTS alerts_one_open_driver_global_type_idx;
DROP INDEX IF EXISTS alerts_one_open_shipment_type_idx;
ALTER TABLE geofence_states
  DROP CONSTRAINT IF EXISTS geofence_states_pending_consistent,
  DROP CONSTRAINT IF EXISTS geofence_states_pending_count_nonnegative,
  DROP COLUMN IF EXISTS pending_count,
  DROP COLUMN IF EXISTS pending_inside;
