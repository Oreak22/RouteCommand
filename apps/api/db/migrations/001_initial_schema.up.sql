CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role AS ENUM ('ADMIN', 'DISPATCHER', 'DRIVER', 'CUSTOMER');
CREATE TYPE driver_status AS ENUM ('OFFLINE', 'AVAILABLE', 'BUSY', 'ON_BREAK');
CREATE TYPE vehicle_type AS ENUM ('BIKE', 'CAR', 'VAN', 'TRUCK');
CREATE TYPE shipment_status AS ENUM (
  'CREATED',
  'ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED',
  'DELIVERED',
  'CANCELLED',
  'FAILED_DELIVERY',
  'RETURNED'
);
CREATE TYPE zone_type AS ENUM ('DELIVERY', 'RESTRICTED', 'DEPOT', 'CUSTOM');
CREATE TYPE alert_type AS ENUM (
  'ZONE_ENTER',
  'ZONE_EXIT',
  'RESTRICTED_ZONE_BREACH',
  'SIGNAL_LOST',
  'IDLE_TOO_LONG',
  'SPEEDING',
  'LOW_ACCURACY',
  'SHIPMENT_DELAYED',
  'OFF_ROUTE'
);
CREATE TYPE alert_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE alert_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE telemetry_source AS ENUM ('DEVICE', 'SIMULATOR');
CREATE TYPE navigation_session_status AS ENUM (
  'PLANNED',
  'ACTIVE',
  'OFF_ROUTE',
  'REROUTING',
  'ARRIVED',
  'CANCELLED'
);
CREATE TYPE email_log_status AS ENUM (
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'BOUNCED',
  'COMPLAINED',
  'SUPPRESSED'
);
CREATE TYPE email_suppression_reason AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'MANUAL');
CREATE TYPE notification_entity AS ENUM ('shipment', 'user', 'security_event');

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  password_hash text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text,
  role user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens(family_id);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate citext NOT NULL UNIQUE,
  type vehicle_type NOT NULL,
  capacity_kg numeric(8, 2) NOT NULL CHECK (capacity_kg > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  status driver_status NOT NULL DEFAULT 'OFFLINE',
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  license_no text NOT NULL UNIQUE,
  rating numeric(3, 2) CHECK (rating BETWEEN 0 AND 5),
  last_known_location geography(Point, 4326),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER drivers_set_updated_at
  BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX drivers_active_vehicle_unique_idx
  ON drivers(vehicle_id) WHERE vehicle_id IS NOT NULL AND status <> 'OFFLINE';
CREATE INDEX drivers_last_known_location_gist_idx
  ON drivers USING gist(last_known_location);
CREATE INDEX drivers_status_idx ON drivers(status);

CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type zone_type NOT NULL,
  geom geography(MultiPolygon, 4326) NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#168B91'
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, type)
);
CREATE TRIGGER zones_set_updated_at
  BEFORE UPDATE ON zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX zones_geom_gist_idx ON zones USING gist(geom);
CREATE INDEX zones_active_type_idx ON zones(type) WHERE is_active;

CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code text NOT NULL UNIQUE CHECK (length(tracking_code) BETWEEN 12 AND 64),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  status shipment_status NOT NULL DEFAULT 'CREATED',
  pickup_address text NOT NULL,
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_address text NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  weight_kg numeric(8, 2) NOT NULL CHECK (weight_kg >= 0),
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  notes text,
  scheduled_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  eta timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (picked_up_at IS NULL OR picked_up_at >= created_at),
  CHECK (delivered_at IS NULL OR picked_up_at IS NOT NULL),
  CHECK (delivered_at IS NULL OR delivered_at >= picked_up_at)
);
CREATE TRIGGER shipments_set_updated_at
  BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX shipments_status_idx ON shipments(status);
CREATE INDEX shipments_driver_status_idx ON shipments(driver_id, status);
CREATE INDEX shipments_customer_created_idx ON shipments(customer_id, created_at DESC);
CREATE INDEX shipments_pickup_location_gist_idx ON shipments USING gist(pickup_location);
CREATE INDEX shipments_dropoff_location_gist_idx ON shipments USING gist(dropoff_location);

CREATE TABLE shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status shipment_status NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  location geography(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_events_shipment_created_idx ON shipment_events(shipment_id, created_at);
CREATE INDEX shipment_events_location_gist_idx ON shipment_events USING gist(location);

CREATE TABLE telemetry_points (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL,
  location geography(Point, 4326) NOT NULL,
  accuracy_m numeric(8, 2) NOT NULL CHECK (accuracy_m >= 0),
  speed_mps numeric(8, 3) CHECK (speed_mps IS NULL OR speed_mps >= 0),
  heading_deg numeric(6, 2)
    CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360)),
  altitude_m numeric(9, 2),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source telemetry_source NOT NULL,
  battery_pct smallint CHECK (battery_pct IS NULL OR battery_pct BETWEEN 0 AND 100),
  is_filtered boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id, recorded_at),
  CHECK (
    ST_X(location::geometry) BETWEEN -180 AND 180
    AND ST_Y(location::geometry) BETWEEN -90 AND 90
  )
) PARTITION BY RANGE (recorded_at);
CREATE INDEX telemetry_points_driver_recorded_idx
  ON telemetry_points(driver_id, recorded_at DESC);
CREATE INDEX telemetry_points_location_gist_idx ON telemetry_points USING gist(location);
CREATE INDEX telemetry_points_recorded_brin_idx ON telemetry_points USING brin(recorded_at);

CREATE FUNCTION create_monthly_telemetry_partition(p_month date) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  month_start date := date_trunc('month', p_month)::date;
  month_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  partition_name text := 'telemetry_points_' || to_char(month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.telemetry_points FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    month_start,
    month_end
  );
END;
$$;
SELECT create_monthly_telemetry_partition(date_trunc('month', current_date)::date);
SELECT create_monthly_telemetry_partition((date_trunc('month', current_date) + interval '1 month')::date);
SELECT create_monthly_telemetry_partition((date_trunc('month', current_date) + interval '2 months')::date);

CREATE TABLE alerts (
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
CREATE TRIGGER alerts_set_updated_at
  BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX alerts_status_created_idx ON alerts(status, created_at DESC);
CREATE INDEX alerts_driver_created_idx ON alerts(driver_id, created_at DESC);
CREATE INDEX alerts_payload_gin_idx ON alerts USING gin(payload);

CREATE TABLE geofence_states (
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  is_inside boolean NOT NULL,
  since timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, zone_id)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(trim(action)) > 0),
  entity text NOT NULL CHECK (length(trim(entity)) > 0),
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_logs_entity_created_idx ON audit_logs(entity, entity_id, created_at DESC);
CREATE INDEX audit_logs_metadata_gin_idx ON audit_logs USING gin(metadata);

CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (length(trim(type)) > 0),
  entity notification_entity NOT NULL,
  entity_id uuid NOT NULL,
  dedupe_key text NOT NULL UNIQUE CHECK (length(trim(dedupe_key)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_events_entity_created_idx
  ON notification_events(entity, entity_id, created_at DESC);

CREATE TABLE email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_event_id uuid NOT NULL REFERENCES notification_events(id) ON DELETE RESTRICT,
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email citext NOT NULL,
  template text NOT NULL,
  subject text NOT NULL,
  status email_log_status NOT NULL DEFAULT 'QUEUED',
  provider text,
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK (sent_at IS NULL OR sent_at >= queued_at)
);
CREATE INDEX email_logs_event_idx ON email_logs(notification_event_id);
CREATE INDEX email_logs_status_queued_idx ON email_logs(status, queued_at);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (length(trim(type)) > 0),
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);
CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_suppressions (
  email citext PRIMARY KEY,
  reason email_suppression_reason NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (length(trim(type)) > 0),
  severity alert_severity NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ip inet,
  user_agent text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWED', 'DISMISSED')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER security_events_set_updated_at
  BEFORE UPDATE ON security_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX security_events_status_created_idx ON security_events(status, created_at DESC);
CREATE INDEX security_events_user_created_idx ON security_events(user_id, created_at DESC);

CREATE TABLE navigation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  status navigation_session_status NOT NULL DEFAULT 'PLANNED',
  route jsonb NOT NULL,
  waypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  distance_m numeric(12, 2) CHECK (distance_m IS NULL OR distance_m >= 0),
  duration_s integer CHECK (duration_s IS NULL OR duration_s >= 0),
  current_step_index integer NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  reroute_count integer NOT NULL DEFAULT 0 CHECK (reroute_count >= 0),
  provider text,
  provider_request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at))
);
CREATE TRIGGER navigation_sessions_set_updated_at
  BEFORE UPDATE ON navigation_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX navigation_sessions_driver_status_idx ON navigation_sessions(driver_id, status);
CREATE INDEX navigation_sessions_shipment_created_idx ON navigation_sessions(shipment_id, created_at DESC);
