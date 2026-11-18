import { randomUUID } from 'node:crypto'

import { databaseUuidSchema, telemetryPointSchema } from '@routecommand/shared'

import { recordFlushMetrics } from './metrics.js'
import { persistTelemetryBatch, updateDriverLatestPosition } from './repository.js'
import type { PersistedTelemetryPoint } from './repository.js'
import { env } from '../../config/env.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { withTransaction } from '../../db/pool.js'
import { redisClient } from '../../infra/redis.js'

const streamName = 'routecommand:telemetry:stream'
const consumerGroup = 'routecommand:telemetry:postgres'
const consumerName = `api-${process.pid}-${randomUUID()}`

interface StreamPoint extends PersistedTelemetryPoint {
  filterReasons: string[]
  live: boolean
}

interface StreamMessage {
  id: string
  message: Map<string, string> | Record<string, string>
}

export function parseTelemetryStreamEntry(
  entry: StreamMessage,
): { id: string; point: StreamPoint } | null {
  const { id } = entry
  const fields =
    entry.message instanceof Map ? entry.message : new Map(Object.entries(entry.message))
  const payload = fields.get('payload')
  if (!payload) return null

  try {
    const decoded = JSON.parse(payload) as Omit<StreamPoint, 'point'> & { point: unknown }
    const parsed = telemetryPointSchema.safeParse(decoded.point)
    if (
      !parsed.success ||
      !databaseUuidSchema.safeParse(decoded.driverId).success ||
      typeof decoded.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(decoded.receivedAt)) ||
      !['DEVICE', 'SIMULATOR'].includes(decoded.source) ||
      typeof decoded.isFiltered !== 'boolean' ||
      !Array.isArray(decoded.filterReasons) ||
      !decoded.filterReasons.every((reason) => typeof reason === 'string')
    ) {
      return null
    }
    return {
      id,
      point: {
        driverId: decoded.driverId,
        point: parsed.data,
        receivedAt: decoded.receivedAt,
        source: decoded.source,
        isFiltered: decoded.isFiltered,
        filterReasons: decoded.filterReasons,
        live: fields.get('live') === '1',
      },
    }
  } catch {
    return null
  }
}

async function acknowledge(client: typeof redisClient, ids: string[]): Promise<void> {
  if (!ids.length) return
  await client.sendCommand(['XACK', streamName, consumerGroup, ...ids])
  await client.sendCommand(['XDEL', streamName, ...ids])
}

async function persistEntries(
  client: typeof redisClient,
  entries: { id: string; point: StreamPoint }[],
): Promise<void> {
  const startedAt = performance.now()
  const valid = entries.filter((entry) => entry.point.driverId)
  if (!valid.length) {
    await acknowledge(
      client,
      entries.map((entry) => entry.id),
    )
    return
  }

  const latestLiveByDriver = new Map<string, PersistedTelemetryPoint>()
  for (const { point } of valid) {
    if (!point.live || point.isFiltered) continue
    const current = latestLiveByDriver.get(point.driverId)
    if (!current || Date.parse(current.point.recordedAt) < Date.parse(point.point.recordedAt)) {
      latestLiveByDriver.set(point.driverId, point)
    }
  }

  await withTransaction(async (executor, afterCommit) => {
    await persistTelemetryBatch(
      valid.map((entry) => entry.point),
      executor,
    )
    for (const [driverId, latest] of latestLiveByDriver) {
      const throttleKey = `routecommand:telemetry:db-position:${driverId}`
      const acquired = await client.sendCommand([
        'SET',
        throttleKey,
        latest.point.recordedAt,
        'NX',
        'EX',
        String(env.TELEMETRY_DB_POSITION_THROTTLE_SECONDS),
      ])
      if (String(acquired) !== 'OK') continue

      const cached = await redisClient.hGet(`routecommand:driver:${driverId}:loc`, 'point')
      if (!cached) continue
      let latestPoint: PersistedTelemetryPoint['point']
      try {
        const parsed = JSON.parse(cached) as { point?: unknown }
        const result = telemetryPointSchema.safeParse(parsed.point)
        if (!result.success) continue
        latestPoint = result.data
      } catch {
        continue
      }
      await updateDriverLatestPosition(driverId, latestPoint, executor)
    }
    const driverIds = [...new Set(valid.map((entry) => entry.point.driverId))]
    if (driverIds.length) {
      const recoveredIds = [
        ...new Set(
          valid
            .filter((entry) => entry.point.live && !entry.point.isFiltered)
            .map((entry) => entry.point.driverId),
        ),
      ]
      const recoveredAlerts = await executor.query<{ id: string; status: string }>(
        `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
         WHERE type IN ('SIGNAL_LOST', 'LOW_ACCURACY') AND status <> 'RESOLVED'
           AND driver_id = ANY($1::uuid[])
         RETURNING id, status`,
        [recoveredIds],
      )
      for (const alert of recoveredAlerts.rows) {
        afterCommit(() =>
          domainEventBus.publish('alert.updated', {
            alertId: alert.id,
            status: alert.status,
            actorId: '00000000-0000-0000-0000-000000000000',
          }),
        )
      }

      const lowAccuracyDriverIds = [
        ...new Set(
          valid
            .filter(
              (entry) =>
                entry.point.isFiltered && entry.point.filterReasons.includes('LOW_ACCURACY'),
            )
            .map((entry) => entry.point.driverId),
        ),
      ]
      for (const driverId of lowAccuracyDriverIds) {
        const count = await executor.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM telemetry_points
           WHERE driver_id = $1 AND is_filtered AND 'LOW_ACCURACY' = ANY(filter_reasons)
             AND received_at >= now() - interval '5 minutes'`,
          [driverId],
        )
        if ((count.rows[0]?.count ?? 0) < 3) continue
        const created = await executor.query<{ id: string }>(
          `INSERT INTO alerts (type, severity, driver_id, payload)
           SELECT 'LOW_ACCURACY', 'MEDIUM', $1,
                  jsonb_build_object('windowMinutes', 5, 'filteredFixCount', $2::int)
           WHERE NOT EXISTS (
             SELECT 1 FROM alerts
             WHERE type = 'LOW_ACCURACY' AND driver_id = $1 AND zone_id IS NULL AND status <> 'RESOLVED'
           ) RETURNING id`,
          [driverId, count.rows[0]?.count ?? 0],
        )
        for (const alert of created.rows) {
          afterCommit(() =>
            domainEventBus.publish('alert.created', {
              alertId: alert.id,
              type: 'LOW_ACCURACY',
              severity: 'MEDIUM',
            }),
          )
        }
      }
    }
  })

  await acknowledge(
    client,
    valid.map((entry) => entry.id),
  )
  const rejected = entries.length - valid.length
  if (rejected) {
    logger.warn({ count: rejected }, 'Malformed telemetry stream entries were discarded')
    await acknowledge(
      client,
      entries.filter((entry) => !valid.includes(entry)).map((entry) => entry.id),
    )
  }
  recordFlushMetrics(valid.length, performance.now() - startedAt)
}

async function scanOperationalAlerts(
  executor: Parameters<Parameters<typeof withTransaction>[0]>[0],
  afterCommit: Parameters<Parameters<typeof withTransaction>[0]>[1],
): Promise<void> {
  const speeding = await executor.query<{ id: string; driver_id: string }>(
    `INSERT INTO alerts (type, severity, driver_id, payload)
     SELECT 'SPEEDING', 'HIGH', candidate.id,
            jsonb_build_object('maxSpeedMps', candidate.max_speed_mps,
              'speedLimitMps', candidate.speed_limit_mps,
              'windowSeconds', $1::int)
     FROM (
       SELECT d.id, max(p.speed_mps) AS max_speed_mps,
              CASE v.type
                WHEN 'BIKE' THEN $2::double precision
                WHEN 'CAR' THEN $3::double precision
                WHEN 'VAN' THEN $4::double precision
                ELSE $5::double precision
              END AS speed_limit_mps
       FROM drivers d
       JOIN vehicles v ON v.id = d.vehicle_id
       JOIN telemetry_points p ON p.driver_id = d.id
       WHERE d.status = 'BUSY' AND p.is_filtered = false
         AND p.recorded_at >= now() - ($1::int * interval '1 second')
       GROUP BY d.id, v.type
       HAVING count(*) FILTER (WHERE p.speed_mps > CASE v.type
           WHEN 'BIKE' THEN $2::double precision
           WHEN 'CAR' THEN $3::double precision
           WHEN 'VAN' THEN $4::double precision
           ELSE $5::double precision END) >= 3
          AND min(p.recorded_at) <= now() - ($1::double precision * 0.8 * interval '1 second')
     ) candidate
     WHERE NOT EXISTS (
       SELECT 1 FROM alerts a WHERE a.type = 'SPEEDING' AND a.driver_id = candidate.id
         AND a.zone_id IS NULL AND a.status <> 'RESOLVED'
     ) RETURNING id, driver_id`,
    [
      env.ALERT_SPEEDING_DURATION_SECONDS,
      env.TELEMETRY_MAX_SPEED_BIKE_MPS,
      env.TELEMETRY_MAX_SPEED_CAR_MPS,
      env.TELEMETRY_MAX_SPEED_VAN_MPS,
      env.TELEMETRY_MAX_SPEED_TRUCK_MPS,
    ],
  )
  for (const alert of speeding.rows) {
    afterCommit(() =>
      domainEventBus.publish('alert.created', {
        alertId: alert.id,
        type: 'SPEEDING',
        severity: 'HIGH',
      }),
    )
  }

  const idle = await executor.query<{ id: string; driver_id: string }>(
    `INSERT INTO alerts (type, severity, driver_id, payload)
     SELECT 'IDLE_TOO_LONG', 'MEDIUM', candidate.id,
            jsonb_build_object('windowSeconds', $1::int, 'maxDriftM', candidate.max_drift_m)
     FROM (
       SELECT d.id, max(ST_Distance(p.location, first_fix.location)) AS max_drift_m,
              min(p.recorded_at) AS first_recorded_at, count(*)::int AS fix_count
       FROM drivers d
       JOIN telemetry_points p ON p.driver_id = d.id AND p.is_filtered = false
       JOIN LATERAL (
         SELECT first_point.location FROM telemetry_points first_point
         WHERE first_point.driver_id = d.id AND first_point.is_filtered = false
           AND first_point.recorded_at >= now() - ($1::int * interval '1 second')
         ORDER BY first_point.recorded_at LIMIT 1
       ) first_fix ON true
       WHERE d.status = 'BUSY'
         AND p.recorded_at >= now() - ($1::int * interval '1 second')
         AND (p.speed_mps IS NULL OR p.speed_mps <= 0.8)
       GROUP BY d.id
       HAVING count(*) >= 3
          AND min(p.recorded_at) <= now() - ($1::double precision * 0.8 * interval '1 second')
          AND max(ST_Distance(p.location, first_fix.location)) <= $2::double precision
     ) candidate
     JOIN drivers d ON d.id = candidate.id
     WHERE NOT EXISTS (
       SELECT 1 FROM geofence_states gs JOIN zones z ON z.id = gs.zone_id
       WHERE gs.driver_id = candidate.id AND gs.is_inside AND z.is_active
         AND z.type IN ('DEPOT', 'DELIVERY')
     )
       AND NOT EXISTS (
         SELECT 1 FROM shipments s WHERE s.driver_id = candidate.id
           AND s.status IN ('PICKED_UP', 'IN_TRANSIT', 'ARRIVED')
           AND d.last_known_location IS NOT NULL
           AND ST_DWithin(s.dropoff_location, d.last_known_location, $3::double precision)
       )
       AND NOT EXISTS (
         SELECT 1 FROM alerts a WHERE a.type = 'IDLE_TOO_LONG' AND a.driver_id = candidate.id
           AND a.zone_id IS NULL AND a.status <> 'RESOLVED'
       ) RETURNING id, driver_id`,
    [env.ALERT_IDLE_DURATION_SECONDS, env.ALERT_IDLE_MAX_DRIFT_M, env.DROPOFF_SUGGESTION_RADIUS_M],
  )
  for (const alert of idle.rows) {
    afterCommit(() =>
      domainEventBus.publish('alert.created', {
        alertId: alert.id,
        type: 'IDLE_TOO_LONG',
        severity: 'MEDIUM',
      }),
    )
  }

  const delayed = await executor.query<{ id: string; driver_id: string | null }>(
    `INSERT INTO alerts (type, severity, driver_id, shipment_id, payload)
     SELECT 'SHIPMENT_DELAYED',
            CASE s.priority WHEN 'URGENT' THEN 'HIGH' WHEN 'HIGH' THEN 'HIGH' ELSE 'MEDIUM' END::alert_severity,
            s.driver_id, s.id,
            jsonb_build_object('trackingCode', s.tracking_code, 'eta', s.eta,
              'delaySeconds', floor(extract(epoch FROM now() - s.eta))::int)
     FROM shipments s
     WHERE s.status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED')
       AND s.eta < now() - ($1::int * interval '1 second')
       AND NOT EXISTS (
         SELECT 1 FROM alerts a WHERE a.type = 'SHIPMENT_DELAYED' AND a.shipment_id = s.id
           AND a.status <> 'RESOLVED'
       ) RETURNING id, driver_id`,
    [env.ALERT_SHIPMENT_DELAY_GRACE_SECONDS],
  )
  for (const alert of delayed.rows) {
    afterCommit(() =>
      domainEventBus.publish('alert.created', {
        alertId: alert.id,
        type: 'SHIPMENT_DELAYED',
        severity: 'HIGH',
      }),
    )
  }

  const resolved = await executor.query<{ id: string }>(
    `UPDATE alerts a SET status = 'RESOLVED', resolved_at = now()
     WHERE a.status <> 'RESOLVED' AND (
       (a.type = 'SHIPMENT_DELAYED' AND EXISTS (
         SELECT 1 FROM shipments s WHERE s.id = a.shipment_id
           AND (s.status IN ('DELIVERED', 'CANCELLED', 'FAILED_DELIVERY', 'RETURNED')
             OR s.eta >= now() - ($1::int * interval '1 second'))
       )) OR
       (a.type IN ('SPEEDING', 'IDLE_TOO_LONG') AND EXISTS (
         SELECT 1 FROM drivers d
         LEFT JOIN vehicles v ON v.id = d.vehicle_id
         LEFT JOIN LATERAL (
           SELECT p.speed_mps FROM telemetry_points p WHERE p.driver_id = d.id
             AND p.is_filtered = false ORDER BY p.recorded_at DESC LIMIT 1
         ) latest ON true
         WHERE d.id = a.driver_id AND (
           d.status <> 'BUSY' OR
           (a.type = 'IDLE_TOO_LONG' AND latest.speed_mps > 1.0) OR
           (a.type = 'IDLE_TOO_LONG' AND (
             EXISTS (
               SELECT 1 FROM geofence_states gs JOIN zones z ON z.id = gs.zone_id
               WHERE gs.driver_id = d.id AND gs.is_inside AND z.is_active
                 AND z.type IN ('DEPOT', 'DELIVERY')
             ) OR EXISTS (
               SELECT 1 FROM shipments s WHERE s.driver_id = d.id
                 AND s.status IN ('PICKED_UP', 'IN_TRANSIT', 'ARRIVED')
                 AND d.last_known_location IS NOT NULL
                 AND ST_DWithin(s.dropoff_location, d.last_known_location, $6::double precision)
             )
           )) OR
           (a.type = 'SPEEDING' AND (latest.speed_mps IS NULL OR latest.speed_mps <= CASE v.type
             WHEN 'BIKE' THEN $2::double precision WHEN 'CAR' THEN $3::double precision
             WHEN 'VAN' THEN $4::double precision ELSE $5::double precision END))
         )
       ))
     ) RETURNING a.id`,
    [
      env.ALERT_SHIPMENT_DELAY_GRACE_SECONDS,
      env.TELEMETRY_MAX_SPEED_BIKE_MPS,
      env.TELEMETRY_MAX_SPEED_CAR_MPS,
      env.TELEMETRY_MAX_SPEED_VAN_MPS,
      env.TELEMETRY_MAX_SPEED_TRUCK_MPS,
      env.DROPOFF_SUGGESTION_RADIUS_M,
    ],
  )
  for (const alert of resolved.rows) {
    afterCommit(() =>
      domainEventBus.publish('alert.updated', {
        alertId: alert.id,
        status: 'RESOLVED',
        actorId: '00000000-0000-0000-0000-000000000000',
      }),
    )
  }
}

async function markSignalLostDrivers(client: typeof redisClient): Promise<void> {
  const staleDriverIds = await withTransaction(async (executor, afterCommit) => {
    await scanOperationalAlerts(executor, afterCommit)
    const newAlerts = await executor.query<{ id: string }>(
      `INSERT INTO alerts (type, severity, driver_id, payload)
       SELECT 'SIGNAL_LOST', 'HIGH', d.id,
              jsonb_build_object('lastSignalAt', coalesce(d.last_seen_at, d.status_changed_at, d.created_at))
       FROM drivers d
       WHERE d.status <> 'OFFLINE'
         AND coalesce(d.last_seen_at, d.status_changed_at, d.created_at)
             < now() - ($1::int * interval '1 second')
         AND NOT EXISTS (
           SELECT 1 FROM alerts a
           WHERE a.type = 'SIGNAL_LOST' AND a.driver_id = d.id AND a.zone_id IS NULL AND a.status <> 'RESOLVED'
         )`,
      [env.DRIVER_SIGNAL_STALE_SECONDS],
    )
    for (const alert of newAlerts.rows) {
      afterCommit(() =>
        domainEventBus.publish('alert.created', {
          alertId: alert.id,
          type: 'SIGNAL_LOST',
          severity: 'HIGH',
        }),
      )
    }
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM drivers
       WHERE status <> 'OFFLINE'
         AND coalesce(last_seen_at, status_changed_at, created_at)
             < now() - ($1::int * interval '1 second')`,
      [env.DRIVER_SIGNAL_STALE_SECONDS],
    )
    return result.rows.map((row) => row.id)
  })
  if (staleDriverIds.length) {
    await client.sendCommand(['ZREM', 'routecommand:drivers:geo', ...staleDriverIds])
  }
}

async function ensureConsumerGroup(client: typeof redisClient): Promise<void> {
  try {
    await client.sendCommand(['XGROUP', 'CREATE', streamName, consumerGroup, '0', 'MKSTREAM'])
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error
  }
}

async function runConsumer(client: typeof redisClient, signal: AbortSignal) {
  let nextStaleCheck = 0
  while (!signal.aborted) {
    try {
      if (Date.now() >= nextStaleCheck) {
        await markSignalLostDrivers(client)
        nextStaleCheck = Date.now() + Math.max(10_000, env.TELEMETRY_FLUSH_INTERVAL_MS * 10)
      }
      const claimed = await client.xAutoClaim(
        streamName,
        consumerGroup,
        consumerName,
        Math.max(5_000, env.TELEMETRY_FLUSH_INTERVAL_MS * 5),
        '0-0',
        { COUNT: 100 },
      )
      const pending = claimed.messages.filter((message) => message !== null)
      const streams = pending.length
        ? [{ name: streamName, messages: pending }]
        : ((await client.xReadGroup(consumerGroup, consumerName, [{ key: streamName, id: '>' }], {
            COUNT: 500,
            BLOCK: env.TELEMETRY_FLUSH_INTERVAL_MS,
          })) ?? [])
      const messages = streams.flatMap((stream) => stream.messages)
      if (!messages.length) continue

      const parsed = messages.map(parseTelemetryStreamEntry)
      const entries = parsed.filter(
        (entry): entry is { id: string; point: StreamPoint } => entry !== null,
      )
      const invalidIds = messages
        .map(({ id }) => id)
        .filter((id) => !entries.some((entry) => entry.id === id))
      if (entries.length) await persistEntries(client, entries)
      if (invalidIds.length) {
        logger.warn(
          { count: invalidIds.length },
          'Malformed telemetry stream entries were discarded',
        )
        await acknowledge(client, invalidIds)
      }
    } catch (error) {
      logger.error(
        { code: error instanceof Error && 'code' in error ? String(error.code) : undefined },
        'Telemetry history flush failed; stream entries will be retried',
      )
      await new Promise((resolve) => setTimeout(resolve, env.TELEMETRY_FLUSH_INTERVAL_MS))
    }
  }
}

export async function startTelemetryWorker(): Promise<() => Promise<void>> {
  const client = redisClient.duplicate()
  client.on('error', (error) => logger.error({ err: error }, 'Telemetry worker Redis error'))
  await client.connect()
  try {
    await ensureConsumerGroup(client)
  } catch (error) {
    if (client.isOpen) await client.quit()
    throw error
  }
  const controller = new AbortController()
  const run = runConsumer(client, controller.signal)
  return async () => {
    controller.abort()
    await run
    if (client.isOpen) await client.quit()
  }
}
