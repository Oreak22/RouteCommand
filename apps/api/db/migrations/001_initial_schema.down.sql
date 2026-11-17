DROP FUNCTION IF EXISTS create_monthly_telemetry_partition(date);

DROP TABLE IF EXISTS navigation_sessions;
DROP TABLE IF EXISTS security_events;
DROP TABLE IF EXISTS email_suppressions;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS email_logs;
DROP TABLE IF EXISTS notification_events;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS geofence_states;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS telemetry_points;
DROP TABLE IF EXISTS shipment_events;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS zones;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS notification_entity;
DROP TYPE IF EXISTS email_suppression_reason;
DROP TYPE IF EXISTS email_log_status;
DROP TYPE IF EXISTS navigation_session_status;
DROP TYPE IF EXISTS telemetry_source;
DROP TYPE IF EXISTS alert_status;
DROP TYPE IF EXISTS alert_severity;
DROP TYPE IF EXISTS alert_type;
DROP TYPE IF EXISTS zone_type;
DROP TYPE IF EXISTS shipment_status;
DROP TYPE IF EXISTS vehicle_type;
DROP TYPE IF EXISTS driver_status;
DROP TYPE IF EXISTS user_role;

-- Extensions are intentionally retained because they may be shared by other schemas.
