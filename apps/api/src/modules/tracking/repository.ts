import type { ShipmentStatus, VehicleType } from '@routecommand/shared'

import { NotFoundError } from '../../core/errors/app-error.js'
import { query } from '../../db/pool.js'

export interface TrackingRecord {
  driverId: string | null
  customerId: string
  trackingCode: string
  status: ShipmentStatus
  eta: Date | null
  dropoffLat: number
  dropoffLng: number
  dropoffAddress: string
  firstName: string | null
  vehicleType: VehicleType | null
  locationLat: number | null
  locationLng: number | null
  locationRecordedAt: Date | null
  updatedAt: Date
  events: Array<{ status: ShipmentStatus; occurredAt: string }>
}

export interface TrackingUpdateRecord {
  driverId: string
  trackingCode: string
  status: ShipmentStatus
  eta: Date | null
  locationLat: number | null
  locationLng: number | null
  locationRecordedAt: Date | null
  updatedAt: Date
}

interface TrackingRow {
  driver_id: string | null
  customer_id: string
  tracking_code: string
  status: ShipmentStatus
  eta: Date | null
  dropoff_lat: number
  dropoff_lng: number
  dropoff_address: string
  first_name: string | null
  vehicle_type: VehicleType | null
  location_lat: number | null
  location_lng: number | null
  location_recorded_at: Date | null
  updated_at: Date
  events: Array<{ status: ShipmentStatus; occurredAt: string }> | null
}

interface TrackingUpdateRow {
  driver_id: string
  tracking_code: string
  status: ShipmentStatus
  eta: Date | null
  location_lat: number | null
  location_lng: number | null
  location_recorded_at: Date | null
  updated_at: Date
}

const trackingSelect = `
  SELECT s.driver_id, s.customer_id, s.tracking_code, s.status::text AS status, s.eta,
         ST_Y(s.dropoff_location::geometry)::float8 AS dropoff_lat,
         ST_X(s.dropoff_location::geometry)::float8 AS dropoff_lng,
         s.dropoff_address,
         split_part(driver_user.name, ' ', 1) AS first_name,
         vehicle.type::text AS vehicle_type,
         position.lat AS location_lat, position.lng AS location_lng,
         position.recorded_at AS location_recorded_at, s.updated_at,
         COALESCE(event_list.events, '[]'::jsonb) AS events
  FROM shipments s
  LEFT JOIN drivers driver ON driver.id = s.driver_id
  LEFT JOIN users driver_user ON driver_user.id = driver.user_id
  LEFT JOIN vehicles vehicle ON vehicle.id = driver.vehicle_id
  LEFT JOIN LATERAL (
    SELECT ST_Y(point.location::geometry)::float8 AS lat,
           ST_X(point.location::geometry)::float8 AS lng,
           point.recorded_at
    FROM telemetry_points point
    WHERE point.driver_id = s.driver_id AND NOT point.is_filtered
    ORDER BY point.recorded_at DESC
    LIMIT 1
  ) position ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('status', recent.status::text,
                                        'occurredAt', recent.created_at)
                     ORDER BY recent.created_at) AS events
    FROM (
      SELECT status, created_at FROM shipment_events
      WHERE shipment_id = s.id
      ORDER BY created_at DESC LIMIT 30
    ) recent
  ) event_list ON true`

function mapRow(row: TrackingRow): TrackingRecord {
  return {
    driverId: row.driver_id,
    customerId: row.customer_id,
    trackingCode: row.tracking_code,
    status: row.status,
    eta: row.eta,
    dropoffLat: Number(row.dropoff_lat),
    dropoffLng: Number(row.dropoff_lng),
    dropoffAddress: row.dropoff_address,
    firstName: row.first_name,
    vehicleType: row.vehicle_type,
    locationLat: row.location_lat === null ? null : Number(row.location_lat),
    locationLng: row.location_lng === null ? null : Number(row.location_lng),
    locationRecordedAt: row.location_recorded_at,
    updatedAt: row.updated_at,
    events: row.events ?? [],
  }
}

export async function findTrackingRecord(trackingCode: string): Promise<TrackingRecord | null> {
  const result = await query<TrackingRow>(`${trackingSelect} WHERE s.tracking_code = $1`, [
    trackingCode,
  ])
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findCustomerTrackingRecord(
  trackingCode: string,
  customerId: string,
): Promise<TrackingRecord> {
  const result = await query<TrackingRow>(
    `${trackingSelect} WHERE s.tracking_code = $1 AND s.customer_id = $2`,
    [trackingCode, customerId],
  )
  if (!result.rows[0]) throw new NotFoundError('Shipment was not found.')
  return mapRow(result.rows[0])
}

export async function listDriverTrackingUpdateRecords(
  driverIds: string[],
): Promise<TrackingUpdateRecord[]> {
  if (!driverIds.length) return []
  const result = await query<TrackingUpdateRow>(
    `SELECT s.driver_id, s.tracking_code, s.status::text AS status, s.eta, s.updated_at,
            position.lat AS location_lat, position.lng AS location_lng,
            position.recorded_at AS location_recorded_at
     FROM shipments s
     LEFT JOIN LATERAL (
       SELECT ST_Y(point.location::geometry)::float8 AS lat,
              ST_X(point.location::geometry)::float8 AS lng,
              point.recorded_at
       FROM telemetry_points point
       WHERE point.driver_id = s.driver_id AND NOT point.is_filtered
       ORDER BY point.recorded_at DESC
       LIMIT 1
     ) position ON true
     WHERE s.driver_id = ANY($1::uuid[])
       AND s.status IN ('PICKED_UP', 'IN_TRANSIT', 'ARRIVED')`,
    [driverIds],
  )
  return result.rows.map((row) => ({
    driverId: row.driver_id,
    trackingCode: row.tracking_code,
    status: row.status,
    eta: row.eta,
    locationLat: row.location_lat === null ? null : Number(row.location_lat),
    locationLng: row.location_lng === null ? null : Number(row.location_lng),
    locationRecordedAt: row.location_recorded_at,
    updatedAt: row.updated_at,
  }))
}
