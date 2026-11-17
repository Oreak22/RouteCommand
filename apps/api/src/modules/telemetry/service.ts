import type { TelemetryBatchInput, TelemetryPointInput, VehicleType } from '@routecommand/shared'

import { recordIngestionMetrics } from './metrics.js'
import { assessTelemetryQuality, timestampIsOutsideAcceptedWindow } from './quality.js'
import type { LatestTelemetryPosition } from './quality.js'
import { env } from '../../config/env.js'
import { ForbiddenError, RateLimitedError, ValidationError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { redisClient, redisPublisher } from '../../infra/redis.js'

const telemetryStream = 'routecommand:telemetry:stream'
const liveChannel = 'routecommand:telemetry:live'
const geoIndex = 'routecommand:drivers:geo'

const rateLimitScript = `
local count = redis.call('INCRBY', KEYS[1], ARGV[1])
if count == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], 2) end
if count > tonumber(ARGV[2]) then
  redis.call('DECRBY', KEYS[1], ARGV[1])
  return 0
end
return count
`

const appendTelemetryScript = `
local latest = redis.call('HGET', KEYS[1], 'recordedAtMs')
local is_newer = (not latest) or tonumber(ARGV[1]) > tonumber(latest)
local update_live = ARGV[3] == '1' and is_newer
redis.call('XADD', KEYS[4], '*', 'payload', ARGV[2], 'live', update_live and '1' or '0')
redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[5])
if update_live then
  redis.call('HSET', KEYS[1], 'point', ARGV[2], 'recordedAtMs', ARGV[1])
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  redis.call('GEOADD', KEYS[2], ARGV[6], ARGV[7], ARGV[8])
  return 1
end
return 0
`

interface QueuedTelemetryPoint {
  driverId: string
  point: TelemetryPointInput
  receivedAt: string
  source: 'DEVICE'
  isFiltered: boolean
  filterReasons: string[]
}

function requireDriverContext(context: {
  role: string
  driverId?: string
  vehicleType?: VehicleType
}): { driverId: string; vehicleType: VehicleType | null } {
  if (context.role !== 'DRIVER' || !context.driverId) {
    throw new ForbiddenError('A driver profile is required to submit telemetry.')
  }
  return { driverId: context.driverId, vehicleType: context.vehicleType ?? null }
}

function parseLatest(raw: string | null): LatestTelemetryPosition | null {
  if (!raw) return null
  try {
    const queued = JSON.parse(raw) as QueuedTelemetryPoint
    return {
      lat: queued.point.lat,
      lng: queued.point.lng,
      accuracyM: queued.point.accuracyM,
      recordedAt: queued.point.recordedAt,
    }
  } catch {
    return null
  }
}

function validateBatchTimestamps(points: TelemetryPointInput[], now: Date): void {
  const issues = points.flatMap((point, index) => {
    const result = timestampIsOutsideAcceptedWindow(point.recordedAt, now)
    if (!result) return []
    return [
      {
        path: ['points', index, 'recordedAt'],
        code: 'custom',
        message:
          result === 'TOO_OLD'
            ? `A fix cannot be older than ${env.TELEMETRY_MAX_AGE_HOURS} hours.`
            : `A fix cannot be more than ${env.TELEMETRY_FUTURE_SKEW_SECONDS} seconds in the future.`,
      },
    ]
  })
  if (issues.length) throw new ValidationError({ issues })
}

export async function ingestTelemetryBatch(
  input: TelemetryBatchInput,
  context: { role: string; driverId?: string; vehicleType?: VehicleType },
): Promise<{ queued: number; filtered: number; liveUpdated: number }> {
  const startedAt = performance.now()
  const { driverId, vehicleType } = requireDriverContext(context)
  const now = new Date()
  validateBatchTimestamps(input.points, now)

  const rateKey = `routecommand:telemetry:rate:${driverId}:${Math.floor(now.getTime() / 1_000)}`
  const rateResult = await redisClient.sendCommand([
    'EVAL',
    rateLimitScript,
    '1',
    rateKey,
    String(input.points.length),
    String(env.TELEMETRY_RATE_LIMIT_PER_SECOND),
  ])
  if (Number(rateResult) === 0) throw new RateLimitedError('Telemetry update rate exceeded.')

  let previous = parseLatest(await redisClient.hGet(`routecommand:driver:${driverId}:loc`, 'point'))
  let filtered = 0
  let liveUpdated = 0
  const ttlSeconds = env.DRIVER_SIGNAL_STALE_SECONDS
  const orderedPoints = [...input.points].sort(
    (first, second) => Date.parse(first.recordedAt) - Date.parse(second.recordedAt),
  )

  for (const point of orderedPoints) {
    const quality = assessTelemetryQuality(point, vehicleType, previous, now)
    const receivedAt = new Date().toISOString()
    const queued: QueuedTelemetryPoint = {
      driverId,
      point,
      receivedAt,
      source: 'DEVICE',
      isFiltered: quality.isFiltered,
      filterReasons: quality.reasons,
    }
    const shouldUpdateLive = quality.canUpdateLivePosition
    const updateResult = await redisClient.sendCommand([
      'EVAL',
      appendTelemetryScript,
      '4',
      `routecommand:driver:${driverId}:loc`,
      geoIndex,
      `routecommand:driver:${driverId}:seen`,
      telemetryStream,
      String(Date.parse(point.recordedAt)),
      JSON.stringify(queued),
      shouldUpdateLive ? '1' : '0',
      receivedAt,
      String(ttlSeconds),
      String(point.lng),
      String(point.lat),
      driverId,
    ])

    if (quality.isFiltered) filtered += 1
    if (Number(updateResult) === 1) {
      liveUpdated += 1
      previous = {
        lat: point.lat,
        lng: point.lng,
        accuracyM: point.accuracyM,
        recordedAt: point.recordedAt,
      }
      const event = {
        driverId,
        lat: point.lat,
        lng: point.lng,
        accuracyM: point.accuracyM,
        speedMps: point.speedMps ?? null,
        headingDeg: point.headingDeg ?? null,
        recordedAt: point.recordedAt,
        receivedAt,
      }
      await redisPublisher.publish(liveChannel, JSON.stringify(event))
      domainEventBus.publish('telemetry.received', event)
    }
  }

  recordIngestionMetrics({
    accepted: orderedPoints.length,
    filtered,
    latencyMs: performance.now() - startedAt,
  })
  return { queued: orderedPoints.length, filtered, liveUpdated }
}
