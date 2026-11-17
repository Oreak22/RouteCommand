import type { TelemetryPointsQuery, TelemetryTrackQuery } from '@routecommand/shared'

import { NotFoundError, ValidationError } from '../../core/errors/app-error.js'
import { query } from '../../db/pool.js'

export async function getDriverTrack(driverId: string, filters: TelemetryTrackQuery) {
  const exists = await query('SELECT 1 FROM drivers WHERE id = $1', [driverId])
  if (!exists.rowCount) throw new NotFoundError('Driver not found.')
  const values: unknown[] = [driverId]
  const conditions = ['driver_id = $1']
  if (filters.from) {
    values.push(filters.from)
    conditions.push(`recorded_at >= $${values.length}`)
  }
  if (filters.to) {
    values.push(filters.to)
    conditions.push(`recorded_at <= $${values.length}`)
  }
  values.push(filters.simplifyM)
  const result = await query<{
    geojson: { type: 'LineString'; coordinates: [number, number][] } | null
    point_count: number
    distance_m: number
    duration_s: number
    average_speed_mps: number | null
    maximum_speed_mps: number | null
    first_recorded_at: Date | null
    last_recorded_at: Date | null
  }>(
    `WITH fixes AS (
       SELECT recorded_at, location::geometry AS geom, speed_mps,
              LAG(location::geometry) OVER (ORDER BY recorded_at) AS previous_geom
       FROM telemetry_points
       WHERE ${conditions.join(' AND ')}
     ), track AS (
       SELECT count(*)::int AS point_count,
              coalesce(sum(ST_Distance(geom::geography, previous_geom::geography)), 0) AS distance_m,
              coalesce(max(recorded_at) - min(recorded_at), interval '0') AS duration,
              avg(speed_mps) AS average_speed_mps,
              max(speed_mps) AS maximum_speed_mps,
              min(recorded_at) AS first_recorded_at,
              max(recorded_at) AS last_recorded_at,
              ST_MakeLine(geom ORDER BY recorded_at) AS line
       FROM fixes
     )
     SELECT CASE WHEN line IS NULL THEN NULL
                 ELSE ST_AsGeoJSON(CASE WHEN $${values.length} > 0
                   THEN ST_SimplifyPreserveTopology(line, $${values.length}) ELSE line END)::json
            END AS geojson,
            point_count, distance_m, extract(epoch FROM duration)::float8 AS duration_s,
            average_speed_mps, maximum_speed_mps, first_recorded_at, last_recorded_at
     FROM track`,
    values,
  )
  const row = result.rows[0]!
  return {
    type: 'Feature' as const,
    geometry: row.geojson,
    properties: {
      pointCount: row.point_count,
      distanceM: Number(row.distance_m),
      durationSeconds: Number(row.duration_s),
      averageSpeedMps: row.average_speed_mps === null ? null : Number(row.average_speed_mps),
      maximumSpeedMps: row.maximum_speed_mps === null ? null : Number(row.maximum_speed_mps),
      from: row.first_recorded_at?.toISOString() ?? null,
      to: row.last_recorded_at?.toISOString() ?? null,
    },
  }
}

function decodeCursor(cursor: string | undefined): Date | null {
  if (!cursor) return null
  try {
    const value = Buffer.from(cursor, 'base64url').toString('utf8')
    const date = new Date(value)
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error()
    return date
  } catch {
    throw new ValidationError({ cursor: ['Invalid telemetry cursor.'] })
  }
}

export async function getDriverTelemetryPoints(driverId: string, filters: TelemetryPointsQuery) {
  const exists = await query('SELECT 1 FROM drivers WHERE id = $1', [driverId])
  if (!exists.rowCount) throw new NotFoundError('Driver not found.')
  const cursor = decodeCursor(filters.cursor)
  const result = await query<{
    lat: number
    lng: number
    accuracy_m: number
    altitude_m: number | null
    speed_mps: number | null
    heading_deg: number | null
    battery_pct: number | null
    recorded_at: Date
    received_at: Date
    is_filtered: boolean
    filter_reasons: string[]
  }>(
    `SELECT ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng,
            accuracy_m::float8, altitude_m::float8, speed_mps::float8, heading_deg::float8,
            battery_pct, recorded_at, received_at, is_filtered, filter_reasons
     FROM telemetry_points
     WHERE driver_id = $1 AND ($2::timestamptz IS NULL OR recorded_at < $2)
     ORDER BY recorded_at DESC
     LIMIT $3`,
    [driverId, cursor, filters.limit + 1],
  )
  const hasMore = result.rows.length > filters.limit
  const rows = result.rows.slice(0, filters.limit)
  const last = rows.at(-1)
  return {
    data: rows.map((row) => ({
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracyM: Number(row.accuracy_m),
      altitudeM: row.altitude_m === null ? null : Number(row.altitude_m),
      speedMps: row.speed_mps === null ? null : Number(row.speed_mps),
      headingDeg: row.heading_deg === null ? null : Number(row.heading_deg),
      batteryPct: row.battery_pct,
      recordedAt: row.recorded_at.toISOString(),
      receivedAt: row.received_at.toISOString(),
      isFiltered: row.is_filtered,
      filterReasons: row.filter_reasons,
    })),
    nextCursor:
      hasMore && last ? Buffer.from(last.recorded_at.toISOString()).toString('base64url') : null,
  }
}
