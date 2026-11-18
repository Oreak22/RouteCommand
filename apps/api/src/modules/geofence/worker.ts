import { env } from '../../config/env.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { withTransaction } from '../../db/pool.js'
import type { DatabaseExecutor, RegisterAfterCommit } from '../../db/pool.js'
import { redisClient } from '../../infra/redis.js'

const confirmingFixes = 2

async function suggestShipmentStatus(input: {
  shipmentId: string
  driverId: string
  suggestedStatus: 'PICKED_UP' | 'ARRIVED'
  reason: 'DEPOT_GEOFENCE' | 'NEAR_DROPOFF'
}): Promise<void> {
  const key = `routecommand:shipment-suggestion:${input.shipmentId}:${input.suggestedStatus}`
  const result = await redisClient.sendCommand(['SET', key, '1', 'NX', 'EX', '600'])
  if (String(result) !== 'OK') return
  domainEventBus.publish('shipment.suggested', input)
}

interface GeofenceRow {
  id: string
  type: 'DELIVERY' | 'RESTRICTED' | 'DEPOT' | 'CUSTOM'
  is_inside: boolean | null
  pending_inside: boolean | null
  pending_count: number
  actual_inside: boolean
}

interface TelemetryEvent {
  driverId: string
  lat: number
  lng: number
  accuracyM: number
  speedMps: number | null
  headingDeg: number | null
  recordedAt: string
  receivedAt: string
}

async function emitAlert(
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
  input: {
    driverId: string
    zoneId: string
    type: 'RESTRICTED_ZONE_BREACH' | 'ZONE_EXIT'
    severity: 'HIGH' | 'CRITICAL'
    payload: Record<string, unknown>
  },
): Promise<void> {
  const result = await executor.query(
    `INSERT INTO alerts (type, severity, driver_id, zone_id, payload)
     SELECT $1::alert_type, $2::alert_severity, $3, $4, $5::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM alerts
       WHERE type = $1::alert_type AND driver_id = $3 AND zone_id = $4 AND status <> 'RESOLVED'
     )
     RETURNING id`,
    [input.type, input.severity, input.driverId, input.zoneId, JSON.stringify(input.payload)],
  )
  const alert = result.rows[0] as { id?: string } | undefined
  if (alert?.id) {
    afterCommit(() => {
      domainEventBus.publish('alert.created', {
        alertId: alert.id!,
        type: input.type,
        severity: input.severity,
      })
    })
  }
}

async function resolveAlerts(
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
  driverId: string,
  zoneId: string,
  type: 'RESTRICTED_ZONE_BREACH' | 'ZONE_EXIT',
  reason: string,
): Promise<void> {
  const result = await executor.query(
    `UPDATE alerts SET status = 'RESOLVED', resolved_at = now(),
       payload = payload || jsonb_build_object('resolutionReason', $4::text)
     WHERE driver_id = $1 AND zone_id = $2 AND type = $3::alert_type AND status <> 'RESOLVED'
     RETURNING id`,
    [driverId, zoneId, type, reason],
  )
  for (const row of result.rows as { id: string }[]) {
    afterCommit(() =>
      domainEventBus.publish('alert.updated', {
        alertId: row.id,
        status: 'RESOLVED',
        actorId: '00000000-0000-0000-0000-000000000000',
      }),
    )
  }
}

export async function processGeofenceFix(event: TelemetryEvent): Promise<void> {
  if (
    !Number.isFinite(event.lat) ||
    !Number.isFinite(event.lng) ||
    !Number.isFinite(event.accuracyM)
  )
    return

  await withTransaction(async (executor, afterCommit) => {
    await executor.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [event.driverId])
    const point = `ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography`
    const zones = await executor.query<GeofenceRow>(
      `SELECT z.id, z.type, s.is_inside, s.pending_inside, coalesce(s.pending_count, 0)::int AS pending_count,
              ST_Covers(z.geom, ${point}) AS actual_inside
       FROM zones z
       LEFT JOIN geofence_states s ON s.driver_id = $1 AND s.zone_id = z.id
       WHERE z.is_active
         AND (s.driver_id IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM geofence_states prior WHERE prior.driver_id = $1
         ) OR z.geom && ${point})`,
      [event.driverId, event.lng, event.lat],
    )

    for (const zone of zones.rows) {
      const current = zone.is_inside
      const actual = zone.actual_inside
      if (current === null) {
        await executor.query(
          `INSERT INTO geofence_states (driver_id, zone_id, is_inside, since)
           VALUES ($1, $2, $3, now()) ON CONFLICT (driver_id, zone_id) DO NOTHING`,
          [event.driverId, zone.id, actual],
        )
        continue
      }

      if (actual === current) {
        if (zone.pending_inside !== null) {
          await executor.query(
            `UPDATE geofence_states SET pending_inside = NULL, pending_count = 0
             WHERE driver_id = $1 AND zone_id = $2`,
            [event.driverId, zone.id],
          )
        }
        continue
      }

      const pendingCount = zone.pending_inside === actual ? zone.pending_count + 1 : 1
      if (pendingCount < confirmingFixes) {
        await executor.query(
          `UPDATE geofence_states SET pending_inside = $3, pending_count = $4
           WHERE driver_id = $1 AND zone_id = $2`,
          [event.driverId, zone.id, actual, pendingCount],
        )
        continue
      }

      await executor.query(
        `UPDATE geofence_states SET is_inside = $3, since = now(), pending_inside = NULL, pending_count = 0
         WHERE driver_id = $1 AND zone_id = $2`,
        [event.driverId, zone.id, actual],
      )
      afterCommit(() =>
        domainEventBus.publish('geofence.crossed', {
          driverId: event.driverId,
          zoneId: zone.id,
          direction: actual ? 'ENTER' : 'EXIT',
        }),
      )

      if (zone.type === 'RESTRICTED') {
        if (actual) {
          await emitAlert(executor, afterCommit, {
            driverId: event.driverId,
            zoneId: zone.id,
            type: 'RESTRICTED_ZONE_BREACH',
            severity: 'CRITICAL',
            payload: { lat: event.lat, lng: event.lng, accuracyM: event.accuracyM },
          })
        } else {
          await resolveAlerts(
            executor,
            afterCommit,
            event.driverId,
            zone.id,
            'RESTRICTED_ZONE_BREACH',
            'Driver left the restricted zone.',
          )
        }
      }

      if (zone.type === 'DELIVERY' && actual) {
        await resolveAlerts(
          executor,
          afterCommit,
          event.driverId,
          zone.id,
          'ZONE_EXIT',
          'Driver re-entered the delivery zone.',
        )
      }
      if (zone.type === 'DELIVERY' && !actual) {
        const activeShipment = await executor.query<{ active: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM shipments
             WHERE driver_id = $1 AND status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED')
           ) AS active`,
          [event.driverId],
        )
        if (activeShipment.rows[0]?.active) {
          await emitAlert(executor, afterCommit, {
            driverId: event.driverId,
            zoneId: zone.id,
            type: 'ZONE_EXIT',
            severity: 'HIGH',
            payload: { lat: event.lat, lng: event.lng, accuracyM: event.accuracyM },
          })
        }
      }

      if (zone.type === 'DEPOT' && actual) {
        const assignedShipments = await executor.query<{ id: string }>(
          `SELECT id FROM shipments WHERE driver_id = $1 AND status = 'ASSIGNED'`,
          [event.driverId],
        )
        for (const shipment of assignedShipments.rows) {
          afterCommit(() =>
            suggestShipmentStatus({
              shipmentId: shipment.id,
              driverId: event.driverId,
              suggestedStatus: 'PICKED_UP',
              reason: 'DEPOT_GEOFENCE',
            }),
          )
        }
      }
    }

    const nearbyDropoffs = await executor.query<{ id: string }>(
      `SELECT id FROM shipments
       WHERE driver_id = $1 AND status IN ('PICKED_UP', 'IN_TRANSIT')
         AND ST_DWithin(dropoff_location, ${point}, $4::double precision)`,
      [event.driverId, event.lng, event.lat, env.DROPOFF_SUGGESTION_RADIUS_M],
    )
    for (const shipment of nearbyDropoffs.rows) {
      afterCommit(() =>
        suggestShipmentStatus({
          shipmentId: shipment.id,
          driverId: event.driverId,
          suggestedStatus: 'ARRIVED',
          reason: 'NEAR_DROPOFF',
        }),
      )
    }
  })
}

export async function startGeofenceWorker(): Promise<() => void> {
  const stopTelemetry = domainEventBus.subscribe('telemetry.received', (event) => {
    void processGeofenceFix(event).catch((error) => {
      logger.error(
        {
          driverId: event.driverId,
          code: error instanceof Error && 'code' in error ? String(error.code) : undefined,
        },
        'Geofence fix processing failed',
      )
    })
  })
  const stopZoneUpdates = domainEventBus.subscribe('zone.updated', () => {
    void withTransaction((executor) => executor.query('DELETE FROM geofence_states')).catch(
      (error) => logger.error({ err: error }, 'Geofence state reset failed after zone update'),
    )
  })
  return () => {
    stopTelemetry()
    stopZoneUpdates()
  }
}
