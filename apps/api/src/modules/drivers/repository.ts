import type { DriverStatus, VehicleType } from '@routecommand/shared'
import type { QueryResultRow } from 'pg'

import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'

export interface DriverRecord {
  id: string
  userId: string
  name: string
  email: string
  phone: string | null
  isActive: boolean
  licenseNo: string
  status: DriverStatus
  statusChangedAt: string
  rating: number | null
  vehicleId: string | null
  vehiclePlate: string | null
  vehicleType: VehicleType | null
  lng: number | null
  lat: number | null
  lastSeenAt: string | null
  distanceMeters?: number
}

interface DriverRow extends QueryResultRow {
  id: string
  user_id: string
  name: string
  email: string
  phone: string | null
  is_active: boolean
  license_no: string
  status: DriverStatus
  status_changed_at: Date
  rating: number | null
  vehicle_id: string | null
  vehicle_plate: string | null
  vehicle_type: VehicleType | null
  lng: number | null
  lat: number | null
  last_seen_at: Date | null
  distance_meters?: number
}

function mapDriver(row: DriverRow): DriverRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    isActive: row.is_active,
    licenseNo: row.license_no,
    status: row.status,
    statusChangedAt: row.status_changed_at.toISOString(),
    rating: row.rating === null ? null : Number(row.rating),
    vehicleId: row.vehicle_id,
    vehiclePlate: row.vehicle_plate,
    vehicleType: row.vehicle_type,
    lng: row.lng === null ? null : Number(row.lng),
    lat: row.lat === null ? null : Number(row.lat),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    ...(row.distance_meters === undefined ? {} : { distanceMeters: Number(row.distance_meters) }),
  }
}

const selectDriver = `
  SELECT d.id, d.user_id, u.name, u.email::text AS email, u.phone, u.is_active,
         d.license_no, d.status, d.status_changed_at, d.rating::float8 AS rating,
         d.vehicle_id, v.plate::text AS vehicle_plate, v.type AS vehicle_type,
         ST_X(d.last_known_location::geometry)::float8 AS lng,
         ST_Y(d.last_known_location::geometry)::float8 AS lat,
         d.last_seen_at
  FROM drivers d
  JOIN users u ON u.id = d.user_id
  LEFT JOIN vehicles v ON v.id = d.vehicle_id`

const selectNearbyDriver = selectDriver.replace(
  'SELECT d.id,',
  'SELECT ST_Distance(d.last_known_location, origin.point)::float8 AS distance_meters, d.id,',
)

export async function listDrivers(input: {
  search?: string | undefined
  status?: DriverStatus | undefined
  zoneId?: string | undefined
  vehicleType?: VehicleType | undefined
  limit: number
  offset: number
}): Promise<DriverRecord[]> {
  const result = await query<DriverRow>(
    `${selectDriver}
     WHERE u.is_active = true
       AND ($1::text IS NULL OR u.name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%'
            OR d.license_no ILIKE '%' || $1 || '%' OR v.plate::text ILIKE '%' || $1 || '%')
       AND ($2::driver_status IS NULL OR d.status = $2::driver_status)
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM zones z
         WHERE z.id = $3 AND z.is_active AND d.last_known_location IS NOT NULL
           AND ST_Covers(z.geom, d.last_known_location)
       ))
       AND ($4::vehicle_type IS NULL OR v.type = $4::vehicle_type)
     ORDER BY u.name, d.id
     LIMIT $5 OFFSET $6`,
    [
      input.search ?? null,
      input.status ?? null,
      input.zoneId ?? null,
      input.vehicleType ?? null,
      input.limit,
      input.offset,
    ],
  )
  return result.rows.map(mapDriver)
}

export async function listNearbyDrivers(input: {
  lng: number
  lat: number
  radiusM: number
  status: DriverStatus
  limit: number
}): Promise<DriverRecord[]> {
  const result = await query<DriverRow>(
    `WITH origin AS (
       SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS point
     )
     ${selectNearbyDriver}
     CROSS JOIN origin
     WHERE u.is_active = true
       AND d.status = $3::driver_status
       AND d.last_known_location IS NOT NULL
       AND ST_DWithin(d.last_known_location, origin.point, $4)
     ORDER BY ST_Distance(d.last_known_location, origin.point), d.id
     LIMIT $5`,
    [input.lng, input.lat, input.status, input.radiusM, input.limit],
  )
  return result.rows.map(mapDriver)
}

export async function getDriver(id: string, executor = { query }): Promise<DriverRecord | null> {
  const result = await executor.query<DriverRow>(`${selectDriver} WHERE d.id = $1`, [id])
  return result.rows[0] ? mapDriver(result.rows[0]) : null
}

export async function getDriverByUserId(
  userId: string,
  executor = { query },
): Promise<DriverRecord | null> {
  const result = await executor.query<DriverRow>(`${selectDriver} WHERE d.user_id = $1`, [userId])
  return result.rows[0] ? mapDriver(result.rows[0]) : null
}

export async function getTelemetryIdentityByUserId(
  userId: string,
  executor = { query },
): Promise<{ driverId: string; vehicleType: VehicleType | null } | null> {
  const result = await executor.query<{ id: string; vehicle_type: VehicleType | null }>(
    `SELECT d.id, v.type AS vehicle_type
     FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.user_id = $1`,
    [userId],
  )
  const driver = result.rows[0]
  return driver ? { driverId: driver.id, vehicleType: driver.vehicle_type } : null
}

export async function lockDriver(id: string, executor: DatabaseExecutor) {
  const result = await executor.query<{
    id: string
    user_id: string
    status: DriverStatus
    vehicle_id: string | null
  }>('SELECT id, user_id, status, vehicle_id FROM drivers WHERE id = $1 FOR UPDATE', [id])
  return result.rows[0] ?? null
}

export async function countActiveShipments(driverId: string, executor: DatabaseExecutor) {
  const result = await executor.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM shipments
     WHERE driver_id = $1 AND status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY')`,
    [driverId],
  )
  return result.rows[0]?.count ?? 0
}

export async function hasOtherActiveVehicleAssignment(
  vehicleId: string,
  driverId: string,
  executor: DatabaseExecutor,
): Promise<boolean> {
  const result = await executor.query<{ assigned: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM drivers
       WHERE vehicle_id = $1 AND id <> $2 AND status <> 'OFFLINE'
     ) AS assigned`,
    [vehicleId, driverId],
  )
  return result.rows[0]?.assigned ?? false
}

export async function updateDriver(
  id: string,
  patch: { licenseNo?: string; status?: Exclude<DriverStatus, 'BUSY'> },
  executor: DatabaseExecutor,
): Promise<DriverRecord | null> {
  const values: unknown[] = [id]
  const sets: string[] = []
  if (patch.licenseNo !== undefined) {
    values.push(patch.licenseNo)
    sets.push(`license_no = $${values.length}`)
  }
  if (patch.status !== undefined) {
    values.push(patch.status)
    sets.push(`status = $${values.length}`, 'status_changed_at = now()')
  }
  if (sets.length) {
    await executor.query(`UPDATE drivers SET ${sets.join(', ')} WHERE id = $1`, values)
  }
  return getDriver(id, executor)
}

export async function updateDriverStatus(
  id: string,
  status: Exclude<DriverStatus, 'BUSY'>,
  executor: DatabaseExecutor,
): Promise<DriverRecord | null> {
  await executor.query('UPDATE drivers SET status = $2, status_changed_at = now() WHERE id = $1', [
    id,
    status,
  ])
  return getDriver(id, executor)
}

export async function assignVehicle(
  driverId: string,
  vehicleId: string | null,
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query('UPDATE drivers SET vehicle_id = $2 WHERE id = $1', [driverId, vehicleId])
}
