-- Development/demo data only. Every seeded account uses the documented local-only
-- password `RouteCommandDemo!2026`; the stored value is an Argon2id hash.
BEGIN;

INSERT INTO users (id, email, password_hash, name, role, email_verified_at)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'admin@routecommand.local',
    '$argon2id$v=19$m=65536,t=4,p=1$WkhWclFFdllqV3UxTEVxdw$g4su9kkcpFKtaxhQYS6QfOLUC58K9HYmqLvJAsdLU78',
    'RouteCommand Admin', 'ADMIN', now()
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'amara.okafor@routecommand.local',
    '$argon2id$v=19$m=65536,t=4,p=1$WkhWclFFdllqV3UxTEVxdw$g4su9kkcpFKtaxhQYS6QfOLUC58K9HYmqLvJAsdLU78',
    'Amara Okafor', 'DISPATCHER', now()
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'tunde.balogun@routecommand.local',
    '$argon2id$v=19$m=65536,t=4,p=1$WkhWclFFdllqV3UxTEVxdw$g4su9kkcpFKtaxhQYS6QfOLUC58K9HYmqLvJAsdLU78',
    'Tunde Balogun', 'DISPATCHER', now()
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  email_verified_at = EXCLUDED.email_verified_at,
  is_active = true;

INSERT INTO users (id, email, password_hash, name, role, email_verified_at)
SELECT
  md5('routecommand:customer:' || n)::uuid,
  'customer' || lpad(n::text, 2, '0') || '@routecommand.local',
  '$argon2id$v=19$m=65536,t=4,p=1$WkhWclFFdllqV3UxTEVxdw$g4su9kkcpFKtaxhQYS6QfOLUC58K9HYmqLvJAsdLU78',
  (ARRAY[
    'Ayo Adeyemi', 'Bisi Akinola', 'Chuka Okoro', 'Dara Balogun', 'Efe Ojo',
    'Fola Adebayo', 'Gbenga Lawal', 'Hauwa Musa', 'Ifeoma Eze', 'Jide Bello',
    'Kemi Nwosu', 'Lara Yusuf', 'Musa Ibrahim', 'Ngozi Obi', 'Ola Daniels',
    'Pelumi James', 'Ranti Cole', 'Sade George', 'Tomi Hassan', 'Uche Nnamdi'
  ])[n],
  'CUSTOMER'::user_role,
  now()
FROM generate_series(1, 20) AS n
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  email_verified_at = EXCLUDED.email_verified_at,
  is_active = true;

INSERT INTO vehicles (id, plate, type, capacity_kg, is_active)
SELECT
  md5('routecommand:vehicle:' || n)::uuid,
  'RC-' || lpad(n::text, 4, '0') || '-NG',
  CASE n % 4
    WHEN 0 THEN 'BIKE'::vehicle_type
    WHEN 1 THEN 'CAR'::vehicle_type
    WHEN 2 THEN 'VAN'::vehicle_type
    ELSE 'TRUCK'::vehicle_type
  END,
  CASE n % 4
    WHEN 0 THEN 25
    WHEN 1 THEN 350
    WHEN 2 THEN 1200
    ELSE 4500
  END,
  true
FROM generate_series(1, 35) AS n
ON CONFLICT (id) DO UPDATE SET
  plate = EXCLUDED.plate,
  type = EXCLUDED.type,
  capacity_kg = EXCLUDED.capacity_kg,
  is_active = true;

INSERT INTO users (id, email, password_hash, name, role, email_verified_at)
SELECT
  md5('routecommand:driver-user:' || n)::uuid,
  'driver' || lpad(n::text, 2, '0') || '@routecommand.local',
  '$argon2id$v=19$m=65536,t=4,p=1$WkhWclFFdllqV3UxTEVxdw$g4su9kkcpFKtaxhQYS6QfOLUC58K9HYmqLvJAsdLU78',
  (ARRAY[
    'Chidi Nwosu', 'Tomi Adebayo', 'Ifeoma Nwosu', 'Femi Ojo', 'Zainab Bello',
    'Kunle Akinyemi', 'Adaobi Eze', 'Seyi Lawal', 'Emeka Okafor', 'Rukayat Musa',
    'Bola Adekunle', 'Yusuf Abdullahi', 'Nneka Obi', 'Tayo George', 'Kola Balogun',
    'Mariam Hassan', 'Dayo Cole', 'Ibrahim Sani', 'Lekan James', 'Chisom Nnamdi',
    'Aisha Ibrahim', 'Segun Adeyemi', 'Ngozi Daniels', 'Babatunde Yusuf', 'Amaka Bello',
    'Faisal Okoro', 'Tosin Akinola', 'Damilola Ojo', 'Hassan Lawal', 'Precious Uche',
    'Yemi George', 'Bashir Musa', 'Nkiru Eze', 'Ibrahim Nwosu', 'Temi Adewale'
  ])[n],
  'DRIVER'::user_role,
  now()
FROM generate_series(1, 35) AS n
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  email_verified_at = EXCLUDED.email_verified_at,
  is_active = true;

INSERT INTO drivers (id, user_id, status, vehicle_id, license_no, rating, last_known_location, last_seen_at)
SELECT
  md5('routecommand:driver:' || n)::uuid,
  md5('routecommand:driver-user:' || n)::uuid,
  CASE n % 4
    WHEN 0 THEN 'OFFLINE'::driver_status
    WHEN 1 THEN 'AVAILABLE'::driver_status
    WHEN 2 THEN 'BUSY'::driver_status
    ELSE 'ON_BREAK'::driver_status
  END,
  md5('routecommand:vehicle:' || n)::uuid,
  'RC-DL-' || lpad(n::text, 4, '0'),
  round((4.0 + ((n * 7) % 10) / 10.0)::numeric, 2),
  ST_SetSRID(ST_MakePoint(3.30 + ((n - 1) % 7) * 0.025, 6.45 + ((n - 1) / 7) * 0.018), 4326)::geography,
  now() - ((n % 18) || ' minutes')::interval
FROM generate_series(1, 35) AS n
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  status = EXCLUDED.status,
  vehicle_id = EXCLUDED.vehicle_id,
  license_no = EXCLUDED.license_no,
  rating = EXCLUDED.rating,
  last_known_location = EXCLUDED.last_known_location,
  last_seen_at = EXCLUDED.last_seen_at;

INSERT INTO zones (id, name, type, geom, color, is_active, created_by)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Victoria Island', 'DELIVERY',
    ST_Multi(ST_GeomFromText('POLYGON((3.37 6.41,3.44 6.41,3.44 6.47,3.37 6.47,3.37 6.41))',4326))::geography,
    '#168B91', true, '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Lekki Phase 1', 'DELIVERY',
    ST_Multi(ST_GeomFromText('POLYGON((3.44 6.42,3.52 6.42,3.52 6.48,3.44 6.48,3.44 6.42))',4326))::geography,
    '#168B91', true, '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'Ikeja Central', 'DELIVERY',
    ST_Multi(ST_GeomFromText('POLYGON((3.30 6.58,3.38 6.58,3.38 6.64,3.30 6.64,3.30 6.58))',4326))::geography,
    '#168B91', true, '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000004', 'Yaba District', 'DELIVERY',
    ST_Multi(ST_GeomFromText('POLYGON((3.36 6.49,3.43 6.49,3.43 6.55,3.36 6.55,3.36 6.49))',4326))::geography,
    '#168B91', true, '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000005', 'Apapa Port Exclusion', 'RESTRICTED',
    ST_Multi(ST_GeomFromText('POLYGON((3.18 6.43,3.25 6.43,3.25 6.49,3.18 6.49,3.18 6.43))',4326))::geography,
    '#B84B3B', true, '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000006', 'Ikeja Dispatch Depot', 'DEPOT',
    ST_Multi(ST_GeomFromText('POLYGON((3.32 6.62,3.35 6.62,3.35 6.64,3.32 6.64,3.32 6.62))',4326))::geography,
    '#5374A5', true, '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  geom = EXCLUDED.geom,
  color = EXCLUDED.color,
  is_active = EXCLUDED.is_active,
  created_by = EXCLUDED.created_by;

INSERT INTO shipments (
  id, tracking_code, customer_id, driver_id, status,
  pickup_address, pickup_location, dropoff_address, dropoff_location,
  weight_kg, priority, scheduled_at, picked_up_at, delivered_at, eta, notes, created_at
)
SELECT
  md5('routecommand:shipment:' || n)::uuid,
  'RC-NG-2026-' || lpad(n::text, 6, '0'),
  md5('routecommand:customer:' || (((n - 1) % 20) + 1))::uuid,
  CASE
    WHEN n % 10 IN (0, 7) THEN NULL
    -- Seed a few in-progress shipments onto BUSY drivers only, leaving
    -- AVAILABLE drivers genuinely free for dispatcher assignment checks.
    WHEN n % 10 IN (1, 2, 3, 4, 5, 8) AND n <= 35 AND n % 4 = 2
      THEN md5('routecommand:driver:' || n)::uuid
    WHEN n % 10 IN (6, 9)
      THEN md5('routecommand:driver:' || (((n - 1) % 35) + 1))::uuid
    ELSE NULL
  END,
  CASE n % 10
    WHEN 0 THEN 'CREATED'::shipment_status
    WHEN 1 THEN 'ASSIGNED'::shipment_status
    WHEN 2 THEN 'ACCEPTED'::shipment_status
    WHEN 3 THEN 'PICKED_UP'::shipment_status
    WHEN 4 THEN 'IN_TRANSIT'::shipment_status
    WHEN 5 THEN 'ARRIVED'::shipment_status
    WHEN 6 THEN 'DELIVERED'::shipment_status
    WHEN 7 THEN 'CANCELLED'::shipment_status
    WHEN 8 THEN 'FAILED_DELIVERY'::shipment_status
    ELSE 'RETURNED'::shipment_status
  END,
  (ARRAY['14 Ahmadu Bello Way, Victoria Island', '22 Admiralty Way, Lekki', '8 Oba Akran Avenue, Ikeja'])[1 + ((n - 1) % 3)],
  ST_SetSRID(ST_MakePoint(3.32 + ((n - 1) % 9) * 0.018, 6.43 + ((n - 1) % 8) * 0.017), 4326)::geography,
  (ARRAY['5 Kofo Abayomi Street, Victoria Island', '19 Admiralty Way, Lekki', '2 Allen Avenue, Ikeja'])[1 + ((n - 1) % 3)],
  ST_SetSRID(ST_MakePoint(3.34 + ((n - 1) % 8) * 0.019, 6.45 + ((n - 1) % 7) * 0.018), 4326)::geography,
  (0.5 + (n % 28) * 0.75)::numeric(8,2),
  CASE n % 4 WHEN 0 THEN 'HIGH' WHEN 1 THEN 'NORMAL' WHEN 2 THEN 'LOW' ELSE 'URGENT' END,
  now() - ((n % 16) || ' hours')::interval,
  CASE WHEN n % 10 IN (3, 4, 5, 6, 8, 9) THEN now() - ((n % 10) || ' hours')::interval END,
  CASE WHEN n % 10 IN (6, 9) THEN now() - interval '30 minutes' END,
  CASE WHEN n % 10 IN (6, 7, 9) THEN NULL ELSE now() + ((n % 8) || ' hours')::interval END,
  CASE WHEN n % 11 = 0 THEN 'Call on arrival; reception is on the east entrance.' END,
  now() - ((20 + (n % 16)) || ' hours')::interval
FROM generate_series(1, 100) AS n
ON CONFLICT (id) DO UPDATE SET
  tracking_code = EXCLUDED.tracking_code,
  customer_id = EXCLUDED.customer_id,
  driver_id = EXCLUDED.driver_id,
  status = EXCLUDED.status,
  pickup_address = EXCLUDED.pickup_address,
  pickup_location = EXCLUDED.pickup_location,
  dropoff_address = EXCLUDED.dropoff_address,
  dropoff_location = EXCLUDED.dropoff_location,
  weight_kg = EXCLUDED.weight_kg,
  priority = EXCLUDED.priority,
  scheduled_at = EXCLUDED.scheduled_at,
  picked_up_at = EXCLUDED.picked_up_at,
  delivered_at = EXCLUDED.delivered_at,
  eta = EXCLUDED.eta,
  notes = EXCLUDED.notes,
  created_at = EXCLUDED.created_at;

INSERT INTO shipment_events (shipment_id, status, actor_id, note, location, created_at)
SELECT
  s.id,
  s.status,
  CASE WHEN s.status = 'CREATED' THEN s.customer_id ELSE '00000000-0000-4000-8000-000000000002'::uuid END,
  'Initial seeded shipment state',
  s.pickup_location,
  s.created_at
FROM shipments s
WHERE s.tracking_code LIKE 'RC-NG-2026-%'
  AND NOT EXISTS (
    SELECT 1 FROM shipment_events e
    WHERE e.shipment_id = s.id AND e.note = 'Initial seeded shipment state'
  );

COMMIT;
