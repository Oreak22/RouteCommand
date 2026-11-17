import { randomUUID } from 'node:crypto'

import { databaseUuidSchema, telemetryPointSchema } from '@routecommand/shared'

import { recordFlushMetrics } from './metrics.js'
import { persistTelemetryBatch, updateDriverLatestPosition } from './repository.js'
import type { PersistedTelemetryPoint } from './repository.js'
import { env } from '../../config/env.js'
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

  await withTransaction(async (executor) => {
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
      await executor.query(
        `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
         WHERE type = 'SIGNAL_LOST' AND status <> 'RESOLVED' AND driver_id = ANY($1::uuid[])`,
        [driverIds],
      )
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

async function markSignalLostDrivers(client: typeof redisClient): Promise<void> {
  const staleDriverIds = await withTransaction(async (executor) => {
    await executor.query(
      `INSERT INTO alerts (type, severity, driver_id, payload)
       SELECT 'SIGNAL_LOST', 'HIGH', d.id,
              jsonb_build_object('lastSignalAt', coalesce(d.last_seen_at, d.status_changed_at, d.created_at))
       FROM drivers d
       WHERE d.status <> 'OFFLINE'
         AND coalesce(d.last_seen_at, d.status_changed_at, d.created_at)
             < now() - ($1::int * interval '1 second')
         AND NOT EXISTS (
           SELECT 1 FROM alerts a
           WHERE a.type = 'SIGNAL_LOST' AND a.driver_id = d.id AND a.status <> 'RESOLVED'
         )`,
      [env.DRIVER_SIGNAL_STALE_SECONDS],
    )
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
