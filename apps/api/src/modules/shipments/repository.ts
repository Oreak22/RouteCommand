import type {
  CreateShipmentInput,
  ListShipmentsQuery,
  ShipmentPriority,
  ShipmentStatus,
  UpdateShipmentInput,
  UserRole,
} from '@routecommand/shared'
import type { QueryResultRow } from 'pg'

import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'

export interface ShipmentRecord {
  id: string
  trackingCode: string
  customerId: string
  customerName: string
  driverId: string | null
  driverUserId: string | null
  driverName: string | null
  driverStatus: string | null
  status: ShipmentStatus
  pickupAddress: string
  pickup: { lat: number; lng: number }
  dropoffAddress: string
  dropoff: { lat: number; lng: number }
  weightKg: number
  priority: ShipmentPriority
  notes: string | null
  scheduledAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  eta: string | null
  createdAt: string
  updatedAt: string
}

export interface ShipmentEventRecord {
  id: string
  shipmentId: string
  status: ShipmentStatus
  actorId: string | null
  actorName: string | null
  note: string | null
  location: { lat: number; lng: number } | null
  createdAt: string
}

export interface ShipmentCustomerOption {
  id: string
  name: string
  email: string
}

export interface DispatchCandidate {
  driverId: string
  name: string
  vehicleType: string
  capacityKg: number
  distanceM: number
  etaSeconds: number
  lastSeenAt: string
  workload: number
  zoneMatch: boolean
  score: number
}

interface ShipmentRow extends QueryResultRow {
  id: string
  tracking_code: string
  customer_id: string
  customer_name: string
  driver_id: string | null
  driver_user_id: string | null
  driver_name: string | null
  driver_status: string | null
  status: ShipmentStatus
  pickup_address: string
  pickup_lat: number
  pickup_lng: number
  dropoff_address: string
  dropoff_lat: number
  dropoff_lng: number
  weight_kg: number
  priority: ShipmentPriority
  notes: string | null
  scheduled_at: Date | null
  picked_up_at: Date | null
  delivered_at: Date | null
  eta: Date | null
  created_at: Date
  updated_at: Date
}

const selectShipment = `
  SELECT s.id, s.tracking_code, s.customer_id, customer.name AS customer_name,
         s.driver_id, driver.user_id AS driver_user_id,
         driver_user.name AS driver_name, driver.status::text AS driver_status, s.status,
         s.pickup_address,
         ST_Y(s.pickup_location::geometry)::float8 AS pickup_lat,
         ST_X(s.pickup_location::geometry)::float8 AS pickup_lng,
         s.dropoff_address,
         ST_Y(s.dropoff_location::geometry)::float8 AS dropoff_lat,
         ST_X(s.dropoff_location::geometry)::float8 AS dropoff_lng,
         s.weight_kg::float8 AS weight_kg, s.priority, s.notes, s.scheduled_at,
         s.picked_up_at, s.delivered_at, s.eta, s.created_at, s.updated_at
  FROM shipments s
  JOIN users customer ON customer.id = s.customer_id
  LEFT JOIN drivers driver ON driver.id = s.driver_id
  LEFT JOIN users driver_user ON driver_user.id = driver.user_id`

function mapShipment(row: ShipmentRow): ShipmentRecord {
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    customerId: row.customer_id,
    customerName: row.customer_name,
    driverId: row.driver_id,
    driverUserId: row.driver_user_id,
    driverName: row.driver_name,
    driverStatus: row.driver_status,
    status: row.status,
    pickupAddress: row.pickup_address,
    pickup: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
    dropoffAddress: row.dropoff_address,
    dropoff: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
    weightKg: Number(row.weight_kg),
    priority: row.priority,
    notes: row.notes,
    scheduledAt: row.scheduled_at?.toISOString() ?? null,
    pickedUpAt: row.picked_up_at?.toISOString() ?? null,
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    eta: row.eta?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function getShipment(
  shipmentId: string,
  executor: DatabaseExecutor = { query },
): Promise<ShipmentRecord | null> {
  const result = await executor.query<ShipmentRow>(`${selectShipment} WHERE s.id = $1`, [
    shipmentId,
  ])
  return result.rows[0] ? mapShipment(result.rows[0]) : null
}

export async function listDispatchCandidates(input: {
  shipmentId: string
  radiusM: number
  signalStaleSeconds: number
  maxAccuracyM: number
  workloadPenaltyM: number
  freshnessPenaltyMPerMinute: number
  zoneMatchBonusM: number
}): Promise<DispatchCandidate[]> {
  const result = await query<{
    driver_id: string
    name: string
    vehicle_type: string
    capacity_kg: number
    distance_m: number
    eta_seconds: number
    last_seen_at: Date
    workload: number
    zone_match: boolean
    score: number
  }>(
    `SELECT d.id AS driver_id, u.name, v.type::text AS vehicle_type,
       v.capacity_kg::float8 AS capacity_kg,
       ST_Distance(d.last_known_location, s.pickup_location)::float8 AS distance_m,
       ceil(ST_Distance(d.last_known_location, s.pickup_location) / 8.0)::int AS eta_seconds,
       d.last_seen_at,
       (SELECT count(*)::int FROM shipments active
        WHERE active.driver_id = d.id
          AND active.status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY')) AS workload,
       EXISTS (
         SELECT 1 FROM zones z
         WHERE z.is_active AND z.type = 'DELIVERY'
           AND ST_Covers(z.geom, s.pickup_location)
           AND ST_Covers(z.geom, d.last_known_location)
       ) AS zone_match,
       (ST_Distance(d.last_known_location, s.pickup_location)
         + (SELECT count(*)::float8 * $5 FROM shipments active
            WHERE active.driver_id = d.id
              AND active.status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY'))
         + (extract(epoch FROM now() - d.last_seen_at) / 60.0 * $6)
         - CASE WHEN EXISTS (
             SELECT 1 FROM zones z
             WHERE z.is_active AND z.type = 'DELIVERY'
               AND ST_Covers(z.geom, s.pickup_location)
               AND ST_Covers(z.geom, d.last_known_location)
           ) THEN $7 ELSE 0 END)::float8 AS score
     FROM shipments s
     JOIN drivers d ON d.status = 'AVAILABLE' AND d.last_known_location IS NOT NULL
     JOIN users u ON u.id = d.user_id AND u.is_active
     JOIN vehicles v ON v.id = d.vehicle_id AND v.is_active AND v.capacity_kg >= s.weight_kg
     WHERE s.id = $1 AND s.status = 'CREATED'
       AND d.last_seen_at >= now() - ($2::int * interval '1 second')
       AND ST_DWithin(d.last_known_location, s.pickup_location, $3::double precision)
       AND EXISTS (
         SELECT 1 FROM telemetry_points point
         WHERE point.driver_id = d.id AND point.is_filtered = false
           AND point.recorded_at >= now() - ($2::int * interval '1 second')
           AND point.accuracy_m <= $4
           AND point.recorded_at = (
             SELECT max(latest.recorded_at) FROM telemetry_points latest WHERE latest.driver_id = d.id
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM alerts a
         WHERE a.driver_id = d.id AND a.type = 'SIGNAL_LOST' AND a.status <> 'RESOLVED'
       )
       AND NOT EXISTS (
         SELECT 1 FROM shipments active
         WHERE active.driver_id = d.id
           AND active.status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY')
       )
     ORDER BY score, distance_m, d.id
     LIMIT 50`,
    [
      input.shipmentId,
      input.signalStaleSeconds,
      input.radiusM,
      input.maxAccuracyM,
      input.workloadPenaltyM,
      input.freshnessPenaltyMPerMinute,
      input.zoneMatchBonusM,
    ],
  )
  return result.rows.map((row) => ({
    driverId: row.driver_id,
    name: row.name,
    vehicleType: row.vehicle_type,
    capacityKg: Number(row.capacity_kg),
    distanceM: Number(row.distance_m),
    etaSeconds: row.eta_seconds,
    lastSeenAt: row.last_seen_at.toISOString(),
    workload: row.workload,
    zoneMatch: row.zone_match,
    score: Number(row.score),
  }))
}

export async function isDriverDispatchEligible(
  shipmentId: string,
  driverId: string,
  input: { radiusM: number; signalStaleSeconds: number; maxAccuracyM: number },
  executor: DatabaseExecutor,
): Promise<boolean> {
  const result = await executor.query<{ eligible: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM shipments s
       JOIN drivers d ON d.id = $2 AND d.status = 'AVAILABLE'
       JOIN users u ON u.id = d.user_id AND u.is_active
       JOIN vehicles v ON v.id = d.vehicle_id AND v.is_active AND v.capacity_kg >= s.weight_kg
       JOIN LATERAL (
         SELECT point.accuracy_m, point.recorded_at, point.is_filtered
         FROM telemetry_points point WHERE point.driver_id = d.id
         ORDER BY point.recorded_at DESC LIMIT 1
       ) latest ON true
       WHERE s.id = $1 AND s.status = 'CREATED'
         AND d.last_known_location IS NOT NULL
         AND d.last_seen_at >= now() - ($3::int * interval '1 second')
         AND latest.is_filtered = false AND latest.accuracy_m <= $4
         AND latest.recorded_at >= now() - ($3::int * interval '1 second')
         AND ST_DWithin(d.last_known_location, s.pickup_location, $5::double precision)
         AND NOT EXISTS (
           SELECT 1 FROM alerts a WHERE a.driver_id = d.id
             AND a.type = 'SIGNAL_LOST' AND a.status <> 'RESOLVED'
         )
         AND NOT EXISTS (
           SELECT 1 FROM shipments active WHERE active.driver_id = d.id
             AND active.status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY')
         )
     ) AS eligible`,
    [shipmentId, driverId, input.signalStaleSeconds, input.maxAccuracyM, input.radiusM],
  )
  return Boolean(result.rows[0]?.eligible)
}

export async function hasPublicTrackingCode(trackingCode: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM shipments WHERE tracking_code = $1) AS exists',
    [trackingCode],
  )
  return Boolean(result.rows[0]?.exists)
}

export async function lockShipment(shipmentId: string, executor: DatabaseExecutor) {
  const result = await executor.query<{
    id: string
    customer_id: string
    driver_id: string | null
    status: ShipmentStatus
    pickup_location: unknown
  }>(
    `SELECT id, customer_id, driver_id, status, pickup_location
     FROM shipments WHERE id = $1 FOR UPDATE`,
    [shipmentId],
  )
  return result.rows[0] ?? null
}

export async function lockTimedOutAssignments(
  timeoutSeconds: number,
  limit: number,
  executor: DatabaseExecutor,
  shipmentId?: string,
): Promise<Array<{ id: string; driver_id: string }>> {
  const result = await executor.query<{ id: string; driver_id: string }>(
    `SELECT s.id, s.driver_id
     FROM shipments s
     JOIN LATERAL (
       SELECT event.status, event.created_at
       FROM shipment_events event WHERE event.shipment_id = s.id
       ORDER BY event.created_at DESC, event.id DESC LIMIT 1
     ) latest ON true
     WHERE s.status = 'ASSIGNED' AND s.driver_id IS NOT NULL
       AND latest.status = 'ASSIGNED'
       AND latest.created_at <= now() - ($1::int * interval '1 second')
       AND ($3::uuid IS NULL OR s.id = $3)
     ORDER BY latest.created_at, s.id
     LIMIT $2
     FOR UPDATE OF s SKIP LOCKED`,
    [timeoutSeconds, limit, shipmentId ?? null],
  )
  return result.rows
}

export async function listShipments(
  input: ListShipmentsQuery,
  user: { id: string; role: UserRole },
): Promise<ShipmentRecord[]> {
  const values: unknown[] = []
  const filters: string[] = []
  const add = (value: unknown, expression: (position: number) => string) => {
    values.push(value)
    filters.push(expression(values.length))
  }

  if (user.role === 'CUSTOMER') add(user.id, (i) => `s.customer_id = $${i}`)
  else if (user.role === 'DRIVER') add(user.id, (i) => `driver.user_id = $${i}`)
  else if (input.customerId) add(input.customerId, (i) => `s.customer_id = $${i}`)

  if (input.status) add(input.status, (i) => `s.status = $${i}::shipment_status`)
  if (input.driverId) add(input.driverId, (i) => `s.driver_id = $${i}`)
  if (input.priority) add(input.priority, (i) => `s.priority = $${i}`)
  if (input.from) add(input.from, (i) => `s.created_at >= $${i}::timestamptz`)
  if (input.to) add(input.to, (i) => `s.created_at <= $${i}::timestamptz`)
  if (input.search) {
    values.push(input.search)
    const index = values.length
    filters.push(
      `(s.tracking_code ILIKE '%' || $${index} || '%' OR s.pickup_address ILIKE '%' || $${index} || '%' OR s.dropoff_address ILIKE '%' || $${index} || '%' OR customer.name ILIKE '%' || $${index} || '%')`,
    )
  }
  if (input.zoneId) {
    add(
      input.zoneId,
      (i) => `EXISTS (
      SELECT 1 FROM zones z WHERE z.id = $${i} AND z.is_active
        AND (ST_Covers(z.geom, s.pickup_location) OR ST_Covers(z.geom, s.dropoff_location))
    )`,
    )
  }

  values.push(input.limit)
  const limitIndex = values.length
  values.push(input.offset)
  const offsetIndex = values.length
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const result = await query<ShipmentRow>(
    `${selectShipment} ${where}
     ORDER BY s.created_at DESC, s.id
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  )
  return result.rows.map(mapShipment)
}

export async function listShipmentCustomers(input: {
  search?: string
  limit: number
}): Promise<ShipmentCustomerOption[]> {
  const result = await query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email::text AS email FROM users
     WHERE role = 'CUSTOMER' AND is_active
       AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email::text ILIKE '%' || $1 || '%')
     ORDER BY name, id LIMIT $2`,
    [input.search ?? null, input.limit],
  )
  return result.rows
}

export async function insertShipment(
  input: {
    trackingCode: string
    customerId: string
    payload: CreateShipmentInput
    eta: Date
  },
  executor: DatabaseExecutor,
): Promise<string> {
  const result = await executor.query<{ id: string }>(
    `INSERT INTO shipments (
       tracking_code, customer_id, status, pickup_address, pickup_location,
       dropoff_address, dropoff_location, weight_kg, priority, notes, scheduled_at, eta
     ) VALUES (
       $1, $2, 'CREATED', $3,
       ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
       $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
       $9, $10, $11, $12, $13
     ) RETURNING id`,
    [
      input.trackingCode,
      input.customerId,
      input.payload.pickupAddress,
      input.payload.pickup.lng,
      input.payload.pickup.lat,
      input.payload.dropoffAddress,
      input.payload.dropoff.lng,
      input.payload.dropoff.lat,
      input.payload.weightKg,
      input.payload.priority,
      input.payload.notes ?? null,
      input.payload.scheduledAt ?? null,
      input.eta,
    ],
  )
  return result.rows[0]!.id
}

export async function patchShipment(
  shipmentId: string,
  input: UpdateShipmentInput,
  executor: DatabaseExecutor,
  eta?: Date,
): Promise<void> {
  const values: unknown[] = [shipmentId]
  const sets: string[] = []
  const add = (value: unknown, expression: (position: number) => string) => {
    values.push(value)
    sets.push(expression(values.length))
  }
  if (input.customerId !== undefined) add(input.customerId, (i) => `customer_id = $${i}`)
  if (input.driverId !== undefined) add(input.driverId, (i) => `driver_id = $${i}`)
  if (input.pickupAddress !== undefined) add(input.pickupAddress, (i) => `pickup_address = $${i}`)
  if (input.pickup !== undefined) {
    values.push(input.pickup.lng, input.pickup.lat)
    sets.push(
      `pickup_location = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)::geography`,
    )
  }
  if (input.dropoffAddress !== undefined)
    add(input.dropoffAddress, (i) => `dropoff_address = $${i}`)
  if (input.dropoff !== undefined) {
    values.push(input.dropoff.lng, input.dropoff.lat)
    sets.push(
      `dropoff_location = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)::geography`,
    )
  }
  if (input.weightKg !== undefined) add(input.weightKg, (i) => `weight_kg = $${i}`)
  if (input.priority !== undefined) add(input.priority, (i) => `priority = $${i}`)
  if (input.notes !== undefined) add(input.notes, (i) => `notes = $${i}`)
  if (input.scheduledAt !== undefined) add(input.scheduledAt, (i) => `scheduled_at = $${i}`)
  if (eta) add(eta, (i) => `eta = $${i}`)
  if (sets.length)
    await executor.query(`UPDATE shipments SET ${sets.join(', ')} WHERE id = $1`, values)
}

export async function setShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus,
  executor: DatabaseExecutor,
  clearDriver = false,
): Promise<void> {
  await executor.query(
    `UPDATE shipments SET status = $2::shipment_status,
       driver_id = CASE WHEN $3 THEN NULL ELSE driver_id END,
       picked_up_at = CASE WHEN $2::shipment_status = 'PICKED_UP' THEN now() WHEN $2::shipment_status = 'CREATED' THEN NULL ELSE picked_up_at END,
       delivered_at = CASE WHEN $2::shipment_status = 'DELIVERED' THEN now() WHEN $2::shipment_status IN ('FAILED_DELIVERY', 'IN_TRANSIT', 'CREATED') THEN NULL ELSE delivered_at END
     WHERE id = $1`,
    [shipmentId, status, clearDriver],
  )
}

export async function insertShipmentEvent(
  input: {
    shipmentId: string
    status: ShipmentStatus
    actorId: string | null
    note: string | null
    location: { lat: number; lng: number } | null
  },
  executor: DatabaseExecutor,
): Promise<ShipmentEventRecord> {
  const result = await executor.query<{
    id: string
    shipment_id: string
    status: ShipmentStatus
    actor_id: string | null
    actor_name: string | null
    note: string | null
    lat: number | null
    lng: number | null
    created_at: Date
  }>(
    `INSERT INTO shipment_events (shipment_id, status, actor_id, note, location)
     VALUES ($1, $2, $3, $4,
       CASE WHEN $5::float8 IS NULL OR $6::float8 IS NULL THEN NULL
         ELSE ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography END
     )
     RETURNING id, shipment_id, status, actor_id, note,
       NULL::text AS actor_name,
       ST_Y(location::geometry)::float8 AS lat,
       ST_X(location::geometry)::float8 AS lng,
       created_at`,
    [
      input.shipmentId,
      input.status,
      input.actorId,
      input.note,
      input.location?.lat ?? null,
      input.location?.lng ?? null,
    ],
  )
  const row = result.rows[0]!
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    status: row.status,
    actorId: row.actor_id,
    actorName: row.actor_name,
    note: row.note,
    location:
      row.lat === null || row.lng === null ? null : { lat: Number(row.lat), lng: Number(row.lng) },
    createdAt: row.created_at.toISOString(),
  }
}

export async function listShipmentEvents(
  shipmentId: string,
  executor: DatabaseExecutor = { query },
): Promise<ShipmentEventRecord[]> {
  const result = await executor.query<{
    id: string
    shipment_id: string
    status: ShipmentStatus
    actor_id: string | null
    actor_name: string | null
    note: string | null
    lat: number | null
    lng: number | null
    created_at: Date
  }>(
    `SELECT event.id, event.shipment_id, event.status, event.actor_id, user_record.name AS actor_name,
       event.note, ST_Y(event.location::geometry)::float8 AS lat,
       ST_X(event.location::geometry)::float8 AS lng, event.created_at
     FROM shipment_events event LEFT JOIN users user_record ON user_record.id = event.actor_id
     WHERE event.shipment_id = $1 ORDER BY event.created_at, event.id`,
    [shipmentId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    shipmentId: row.shipment_id,
    status: row.status,
    actorId: row.actor_id,
    actorName: row.actor_name,
    note: row.note,
    location:
      row.lat === null || row.lng === null ? null : { lat: Number(row.lat), lng: Number(row.lng) },
    createdAt: row.created_at.toISOString(),
  }))
}

export async function lockDriverForShipment(driverId: string, executor: DatabaseExecutor) {
  const result = await executor.query<{
    id: string
    user_id: string
    status: string
    is_active: boolean
    lat: number | null
    lng: number | null
    accuracy_m: number | null
    capacity_kg: number | null
    vehicle_active: boolean
  }>(
    `SELECT d.id, d.user_id, d.status::text AS status, u.is_active,
       ST_Y(d.last_known_location::geometry)::float8 AS lat,
       ST_X(d.last_known_location::geometry)::float8 AS lng,
       (SELECT point.accuracy_m::float8 FROM telemetry_points point
         WHERE point.driver_id = d.id ORDER BY point.recorded_at DESC LIMIT 1) AS accuracy_m,
       v.capacity_kg::float8 AS capacity_kg, v.is_active AS vehicle_active
     FROM drivers d JOIN users u ON u.id = d.user_id
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.id = $1 FOR UPDATE OF d`,
    [driverId],
  )
  return result.rows[0] ?? null
}

export async function countOtherActiveShipments(
  driverId: string,
  excludedShipmentId: string,
  executor: DatabaseExecutor,
): Promise<number> {
  const result = await executor.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM shipments
     WHERE driver_id = $1 AND id <> $2
       AND status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY')`,
    [driverId, excludedShipmentId],
  )
  return result.rows[0]?.count ?? 0
}

export async function updateLockedDriverStatus(
  driverId: string,
  status: 'AVAILABLE' | 'BUSY',
  executor: DatabaseExecutor,
): Promise<{ id: string; user_id: string; status: string }> {
  const result = await executor.query<{ id: string; user_id: string; status: string }>(
    `UPDATE drivers SET status = $2, status_changed_at = now()
     WHERE id = $1 AND status <> $2 RETURNING id, user_id, status::text AS status`,
    [driverId, status],
  )
  if (result.rows[0]) return result.rows[0]
  const current = await executor.query<{ id: string; user_id: string; status: string }>(
    'SELECT id, user_id, status::text AS status FROM drivers WHERE id = $1',
    [driverId],
  )
  return current.rows[0]!
}

export async function getPickupDistance(
  driverId: string,
  shipmentId: string,
  executor: DatabaseExecutor,
): Promise<{ distanceM: number; accuracyM: number | null; recordedAt: Date | null } | null> {
  const result = await executor.query<{
    distance_m: number
    accuracy_m: number | null
    recorded_at: Date | null
  }>(
    `SELECT ST_Distance(driver.last_known_location, shipment.pickup_location)::float8 AS distance_m,
       (SELECT point.accuracy_m::float8 FROM telemetry_points point
         WHERE point.driver_id = driver.id ORDER BY point.recorded_at DESC LIMIT 1) AS accuracy_m,
       driver.last_seen_at AS recorded_at
     FROM drivers driver JOIN shipments shipment ON shipment.id = $2
     WHERE driver.id = $1 AND driver.last_known_location IS NOT NULL`,
    [driverId, shipmentId],
  )
  const row = result.rows[0]
  return row
    ? {
        distanceM: Number(row.distance_m),
        accuracyM: row.accuracy_m === null ? null : Number(row.accuracy_m),
        recordedAt: row.recorded_at,
      }
    : null
}

export async function saveIdempotentResponse(
  shipmentId: string,
  key: string,
  requestHash: string,
  response: unknown,
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query(
    `INSERT INTO shipment_transition_idempotency (shipment_id, idempotency_key, request_hash, response)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [shipmentId, key, requestHash, JSON.stringify(response)],
  )
}

export async function getIdempotentResponse(
  shipmentId: string,
  key: string,
  executor: DatabaseExecutor,
): Promise<{ requestHash: string; response: unknown } | null> {
  const result = await executor.query<{ request_hash: string; response: unknown }>(
    `SELECT request_hash, response FROM shipment_transition_idempotency
     WHERE shipment_id = $1 AND idempotency_key = $2`,
    [shipmentId, key],
  )
  return result.rows[0]
    ? { requestHash: result.rows[0].request_hash, response: result.rows[0].response }
    : null
}
