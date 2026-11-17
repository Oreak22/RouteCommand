import type { TelemetryPointInput } from '@routecommand/shared'

import type { DatabaseExecutor } from '../../db/pool.js'

export interface PersistedTelemetryPoint {
  driverId: string
  point: TelemetryPointInput
  receivedAt: string
  source: 'DEVICE' | 'SIMULATOR'
  isFiltered: boolean
  filterReasons: string[]
}

export async function persistTelemetryBatch(
  points: PersistedTelemetryPoint[],
  executor: DatabaseExecutor,
): Promise<number> {
  if (!points.length) return 0
  const values: unknown[] = []
  const rows = points.map(({ driverId, point, receivedAt, source, isFiltered, filterReasons }) => {
    const offset = values.length
    values.push(
      driverId,
      point.lng,
      point.lat,
      point.accuracyM,
      point.speedMps ?? null,
      point.headingDeg ?? null,
      point.altitudeM ?? null,
      point.recordedAt,
      receivedAt,
      source,
      point.batteryPct ?? null,
      isFiltered,
      filterReasons,
    )
    return `($${offset + 1}, ST_SetSRID(ST_MakePoint($${offset + 2}, $${offset + 3}), 4326)::geography,
      $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8},
      $${offset + 9}, $${offset + 10}::telemetry_source, $${offset + 11}, $${offset + 12}, $${offset + 13})`
  })
  const result = await executor.query(
    `INSERT INTO telemetry_points (
       driver_id, location, accuracy_m, speed_mps, heading_deg, altitude_m, recorded_at,
       received_at, source, battery_pct, is_filtered, filter_reasons
     ) VALUES ${rows.join(', ')}
     ON CONFLICT (driver_id, recorded_at) DO NOTHING`,
    values,
  )
  return result.rowCount ?? 0
}

export async function updateDriverLatestPosition(
  driverId: string,
  point: TelemetryPointInput,
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query(
    `UPDATE drivers
     SET last_known_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         last_seen_at = now()
     WHERE id = $1`,
    [driverId, point.lng, point.lat],
  )
}
