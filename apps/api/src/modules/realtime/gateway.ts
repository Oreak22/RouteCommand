import { randomUUID } from 'node:crypto'
import { Server as HttpServer } from 'node:http'

import {
  databaseUuidSchema,
  telemetryBatchSchema,
  telemetryPointSchema,
  type ClientToServerEvents,
  type DriverPositionEvent,
  type ServerToClientEvents,
  type SocketIdentity,
} from '@routecommand/shared'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server } from 'socket.io'

import { env } from '../../config/env.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { redisClient, redisPublisher } from '../../infra/redis.js'
import { authenticateAccessToken } from '../auth/service.js'
import { getShipmentRecord, publicTrackingCodeExists } from '../shipments/service.js'
import { ingestTelemetryBatch } from '../telemetry/service.js'

const telemetryChannel = 'routecommand:telemetry:live'
const domainChannel = 'routecommand:realtime:events'
const positionFlushMs = 500
const maxConnectionsPerUser = 5
const maxRoomsPerSocket = 20
const connectionLeaseKey = (userId: string) => `routecommand:realtime:connections:${userId}`
const broadcasterLockKey = 'routecommand:realtime:broadcaster'
const broadcasterId = randomUUID()
const renewBroadcasterScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], 5000)
  return 1
end
return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', 5000) and 1 or 0
`
const releaseBroadcasterScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`

interface SocketData {
  identity: SocketIdentity
  sessionId: string
  expiresAt: number
  vehicleType?: 'BIKE' | 'CAR' | 'VAN' | 'TRUCK'
  expiryTimer?: NodeJS.Timeout
  leaseTimer?: NodeJS.Timeout
  roomsJoined: number
  eventWindowStartedAt: number
  eventCount: number
}

type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

interface LiveTelemetry {
  driverId: string
  lat: number
  lng: number
  accuracyM: number
  speedMps: number | null
  headingDeg: number | null
  recordedAt: string
  receivedAt: string
}

interface QueuedPoint {
  driverId: string
  receivedAt: string
  point: {
    lat: number
    lng: number
    accuracyM: number
    speedMps?: number
    headingDeg?: number
    recordedAt: string
  }
  isFiltered: boolean
}

function subscribeDomainEvents(): Array<() => void> {
  const publish = (name: string, payload: unknown) => {
    void redisPublisher.publish(domainChannel, JSON.stringify({ name, payload })).catch((error) => {
      logger.error({ err: error, event: name }, 'Realtime event could not be bridged through Redis')
    })
  }
  return [
    domainEventBus.subscribe('driver.statusChanged', (event) =>
      publish('driver.statusChanged', event),
    ),
    domainEventBus.subscribe('driver.vehicleAssigned', (event) =>
      publish('driver.vehicleAssigned', event),
    ),
    domainEventBus.subscribe('shipment.requested', (event) => publish('shipment.requested', event)),
    domainEventBus.subscribe('shipment.assigned', (event) => publish('shipment.assigned', event)),
    domainEventBus.subscribe('shipment.statusChanged', (event) =>
      publish('shipment.statusChanged', event),
    ),
    domainEventBus.subscribe('shipment.cancelled', (event) => publish('shipment.cancelled', event)),
    domainEventBus.subscribe('alert.created', (event) => publish('alert.created', event)),
    domainEventBus.subscribe('zone.updated', (event) => publish('zone.updated', event)),
  ]
}

async function operationsSnapshot(): Promise<{
  generatedAt: string
  positions: DriverPositionEvent[]
}> {
  const generatedAt = new Date().toISOString()
  const driverIds = await redisClient.zRange('routecommand:drivers:geo', 0, 999)
  const candidates = await Promise.all(
    driverIds.map(async (driverId) => {
      const [raw, seen, sequence] = await Promise.all([
        redisClient.hGet(`routecommand:driver:${driverId}:loc`, 'point'),
        redisClient.get(`routecommand:driver:${driverId}:seen`),
        redisClient.get(`routecommand:driver:${driverId}:sequence`),
      ])
      if (!raw || !seen || Date.now() - Date.parse(seen) > env.DRIVER_SIGNAL_STALE_SECONDS * 1000) {
        return null
      }
      try {
        const queued = JSON.parse(raw) as QueuedPoint
        const point = telemetryPointSchema.safeParse(queued.point)
        if (!point.success || queued.isFiltered) return null
        return {
          driverId,
          ...point.data,
          sequence: Number(sequence ?? 0),
          receivedAt: queued.receivedAt,
        } satisfies DriverPositionEvent
      } catch {
        return null
      }
    }),
  )
  return {
    generatedAt,
    positions: candidates.filter((item) => item !== null),
  }
}

function emitDomainEvent(io: RealtimeServer, name: string, payload: Record<string, unknown>): void {
  if (name === 'driver.statusChanged' || name === 'driver.vehicleAssigned') {
    const driverId = payload.driverId
    if (typeof driverId !== 'string') return
    io.to('ops').emit('driver:status', {
      driverId,
      status: String(payload.status ?? 'UPDATED'),
      occurredAt: String(payload.occurredAt ?? new Date().toISOString()),
    })
    io.to(`driver:${driverId}`).emit('driver:status', {
      driverId,
      status: String(payload.status ?? 'UPDATED'),
      occurredAt: String(payload.occurredAt ?? new Date().toISOString()),
    })
    return
  }
  if (name.startsWith('shipment.')) {
    const shipmentId = payload.shipmentId
    if (typeof shipmentId !== 'string') return
    const event = {
      shipmentId,
      ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
      ...(typeof payload.trackingCode === 'string' ? { trackingCode: payload.trackingCode } : {}),
    }
    io.to('ops').emit('shipment:updated', event)
    io.to(`shipment:${shipmentId}`).emit('shipment:updated', event)
    if (typeof payload.driverId === 'string')
      io.to(`driver:${payload.driverId}`).emit('shipment:updated', event)
    return
  }
  if (name === 'alert.created' && typeof payload.alertId === 'string') {
    io.to('ops').emit('alert:created', {
      alertId: payload.alertId,
      type: String(payload.type ?? 'UNKNOWN'),
      severity: String(payload.severity ?? 'LOW'),
    })
    return
  }
  if (name === 'zone.updated' && typeof payload.zoneId === 'string') {
    io.to('ops').emit('zone:updated', {
      zoneId: payload.zoneId,
      action:
        payload.action === 'created' || payload.action === 'deactivated'
          ? payload.action
          : 'updated',
      updatedAt: String(payload.updatedAt ?? new Date().toISOString()),
    })
  }
}

function publicError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return {
      code: error.code,
      message: error instanceof Error ? error.message : 'Request rejected.',
    }
  }
  return { code: 'INTERNAL_ERROR', message: 'The realtime request could not be completed.' }
}

export async function startRealtimeGateway(httpServer: HttpServer): Promise<() => Promise<void>> {
  const adapterPublisher = redisClient.duplicate()
  const adapterSubscriber = redisClient.duplicate()
  const eventSubscriber = redisClient.duplicate()
  await Promise.all([
    adapterPublisher.connect(),
    adapterSubscriber.connect(),
    eventSubscriber.connect(),
  ])

  const io: RealtimeServer = new Server(httpServer, {
    adapter: createAdapter(adapterPublisher, adapterSubscriber),
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    maxHttpBufferSize: Math.min(env.BODY_LIMIT_BYTES, 256_000),
    pingInterval: 25_000,
    pingTimeout: 20_000,
    transports: ['websocket', 'polling'],
  })
  const queuedPositions = new Map<string, LiveTelemetry>()
  let flushTimer: NodeJS.Timeout | undefined
  let isBroadcaster = false
  const refreshBroadcasterLease = async () => {
    isBroadcaster =
      Number(
        await redisClient.sendCommand([
          'EVAL',
          renewBroadcasterScript,
          '1',
          broadcasterLockKey,
          broadcasterId,
        ]),
      ) === 1
  }
  await refreshBroadcasterLease()
  const broadcasterTimer = setInterval(() => {
    void refreshBroadcasterLease().catch((error) => {
      isBroadcaster = false
      logger.error({ err: error }, 'Realtime broadcaster lease renewal failed')
    })
  }, 1_000)
  broadcasterTimer.unref()
  const unsubscribers = subscribeDomainEvents()

  await eventSubscriber.subscribe(domainChannel, (message) => {
    if (!isBroadcaster) return
    try {
      const event = JSON.parse(message) as { name?: unknown; payload?: unknown }
      if (typeof event.name !== 'string' || !event.payload || typeof event.payload !== 'object')
        return
      emitDomainEvent(io, event.name, event.payload as Record<string, unknown>)
    } catch {
      logger.warn('Malformed realtime domain event was ignored')
    }
  })
  await eventSubscriber.subscribe(telemetryChannel, (message) => {
    if (!isBroadcaster) return
    try {
      const event = JSON.parse(message) as LiveTelemetry
      if (
        typeof event.driverId !== 'string' ||
        !Number.isFinite(event.lat) ||
        !Number.isFinite(event.lng)
      )
        return
      queuedPositions.set(event.driverId, event)
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined
          const batch = [...queuedPositions.entries()]
          queuedPositions.clear()
          if (!isBroadcaster) return
          void Promise.all(
            batch.map(async ([driverId, position]) => {
              const sequence = await redisClient.incr(`routecommand:driver:${driverId}:sequence`)
              io.to('ops').emit('driver:position', { ...position, sequence })
            }),
          ).catch((error) => logger.error({ err: error }, 'Realtime position fan-out failed'))
        }, positionFlushMs)
        flushTimer.unref()
      }
    } catch {
      logger.warn('Malformed live telemetry event was ignored')
    }
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.accessToken
      if (typeof token !== 'string' || token.length > 8_192) return next(new Error('unauthorized'))
      const identity = await authenticateAccessToken(token)
      socket.data.identity = {
        userId: identity.user.id,
        role: identity.user.role,
        ...(identity.driverId ? { driverId: identity.driverId } : {}),
      }
      socket.data.sessionId = identity.sessionId
      socket.data.expiresAt = identity.expiresAt
      if (identity.vehicleType) socket.data.vehicleType = identity.vehicleType
      socket.data.roomsJoined = 0
      socket.data.eventWindowStartedAt = Date.now()
      socket.data.eventCount = 0
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    const { userId, role, driverId } = socket.data.identity
    let leased = false
    const userLeaseKey = connectionLeaseKey(userId)
    const refreshLease = async () => {
      const now = Date.now()
      await redisClient.zRemRangeByScore(userLeaseKey, 0, now - 120_000)
      await redisClient.zAdd(userLeaseKey, { score: now, value: socket.id })
      await redisClient.expire(userLeaseKey, 180)
      if ((await redisClient.zCard(userLeaseKey)) > maxConnectionsPerUser) {
        await redisClient.zRem(userLeaseKey, socket.id)
        socket.disconnect(true)
        return false
      }
      leased = true
      return true
    }
    void (async () => {
      try {
        const accepted = await refreshLease()
        if (!accepted) return
        if (!socket.connected) {
          leased = false
          await redisClient.zRem(userLeaseKey, socket.id)
          return
        }
        socket.data.leaseTimer = setInterval(() => void refreshLease(), 30_000)
        socket.data.leaseTimer.unref()
      } catch (error) {
        logger.error({ err: error }, 'Socket connection lease failed')
        socket.disconnect(true)
      }
    })()

    const scheduleExpiry = () => {
      if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer)
      const untilExpiry = Math.max(0, socket.data.expiresAt - Date.now())
      socket.data.expiryTimer = setTimeout(() => {
        socket.emit('system:notice', {
          code: 'AUTH_EXPIRED',
          message: 'Refresh your session to continue.',
        })
        socket.disconnect(true)
      }, untilExpiry)
      socket.data.expiryTimer.unref()
    }
    scheduleExpiry()
    socket.use((_packet, next) => {
      const now = Date.now()
      if (now - socket.data.eventWindowStartedAt >= 1_000) {
        socket.data.eventWindowStartedAt = now
        socket.data.eventCount = 0
      }
      socket.data.eventCount += 1
      if (socket.data.eventCount > 200) return next(new Error('rate limited'))
      next()
    })

    if (role === 'ADMIN' || role === 'DISPATCHER') {
      void (async () => {
        await socket.join('ops')
        socket.emit('ops:snapshot', await operationsSnapshot())
      })()
    }
    if (role === 'DRIVER' && driverId) void socket.join(`driver:${driverId}`)

    socket.on('auth:refresh', async ({ accessToken }, ack) => {
      try {
        const refreshed = await authenticateAccessToken(accessToken)
        if (
          refreshed.user.id !== socket.data.identity.userId ||
          refreshed.sessionId !== socket.data.sessionId ||
          refreshed.user.role !== socket.data.identity.role ||
          (refreshed.driverId ?? null) !== (socket.data.identity.driverId ?? null)
        ) {
          ack({ ok: false, code: 'SESSION_CHANGED' })
          socket.disconnect(true)
          return
        }
        socket.data.expiresAt = refreshed.expiresAt
        if (refreshed.vehicleType) socket.data.vehicleType = refreshed.vehicleType
        else delete socket.data.vehicleType
        scheduleExpiry()
        ack({ ok: true })
      } catch {
        ack({ ok: false, code: 'UNAUTHORIZED' })
        socket.disconnect(true)
      }
    })

    socket.on('telemetry:update', async (input, ack) => {
      const parsed = telemetryPointSchema.safeParse(input)
      if (!parsed.success)
        return ack({ ok: false, code: 'VALIDATION_ERROR', message: 'Telemetry point is invalid.' })
      try {
        const result = await ingestTelemetryBatch(
          { points: [parsed.data] },
          {
            role,
            ...(driverId ? { driverId } : {}),
            ...(socket.data.vehicleType ? { vehicleType: socket.data.vehicleType } : {}),
          },
        )
        ack({ ok: true, ...result })
      } catch (error) {
        const details = publicError(error)
        ack({ ok: false, ...details })
      }
    })

    socket.on('telemetry:batch', async (input, ack) => {
      const parsed = telemetryBatchSchema.safeParse(input)
      if (!parsed.success)
        return ack({ ok: false, code: 'VALIDATION_ERROR', message: 'Telemetry batch is invalid.' })
      try {
        const result = await ingestTelemetryBatch(parsed.data, {
          role,
          ...(driverId ? { driverId } : {}),
          ...(socket.data.vehicleType ? { vehicleType: socket.data.vehicleType } : {}),
        })
        ack({ ok: true, ...result })
      } catch (error) {
        const details = publicError(error)
        ack({ ok: false, ...details })
      }
    })

    socket.on('subscribe:shipment', async ({ shipmentId }, ack) => {
      if (!databaseUuidSchema.safeParse(shipmentId).success) {
        return ack({ ok: false, code: 'INVALID_ROOM' })
      }
      try {
        await getShipmentRecord(shipmentId, { id: userId, role })
        const room = `shipment:${shipmentId}`
        if (!socket.rooms.has(room)) {
          if (socket.data.roomsJoined >= maxRoomsPerSocket)
            return ack({ ok: false, code: 'ROOM_LIMIT' })
          await socket.join(room)
          socket.data.roomsJoined += 1
        }
        ack({ ok: true })
      } catch (error) {
        ack({ ok: false, code: publicError(error).code })
      }
    })
    socket.on('unsubscribe:shipment', async ({ shipmentId }, ack) => {
      if (!databaseUuidSchema.safeParse(shipmentId).success)
        return ack({ ok: false, code: 'INVALID_ROOM' })
      const room = `shipment:${shipmentId}`
      if (socket.rooms.has(room)) {
        await socket.leave(room)
        socket.data.roomsJoined = Math.max(0, socket.data.roomsJoined - 1)
      }
      ack({ ok: true })
    })
    socket.on('public:subscribe', async ({ trackingCode }, ack) => {
      if (!/^RC-[0-9A-HJKMNP-TV-Z]{10}$/.test(trackingCode)) {
        return ack({ ok: false, code: 'INVALID_ROOM' })
      }
      try {
        if (!(await publicTrackingCodeExists(trackingCode)))
          return ack({ ok: false, code: 'NOT_FOUND' })
        const room = `public:${trackingCode}`
        if (!socket.rooms.has(room)) {
          if (socket.data.roomsJoined >= maxRoomsPerSocket)
            return ack({ ok: false, code: 'ROOM_LIMIT' })
          await socket.join(room)
          socket.data.roomsJoined += 1
        }
        ack({ ok: true })
      } catch {
        ack({ ok: false, code: 'INTERNAL_ERROR' })
      }
    })
    socket.on('public:unsubscribe', async ({ trackingCode }, ack) => {
      if (!/^RC-[0-9A-HJKMNP-TV-Z]{10}$/.test(trackingCode))
        return ack({ ok: false, code: 'INVALID_ROOM' })
      const room = `public:${trackingCode}`
      if (socket.rooms.has(room)) {
        await socket.leave(room)
        socket.data.roomsJoined = Math.max(0, socket.data.roomsJoined - 1)
      }
      ack({ ok: true })
    })
    socket.on('ops:snapshot:request', async (ack) => {
      if (role !== 'ADMIN' && role !== 'DISPATCHER') return ack?.({ ok: false, code: 'FORBIDDEN' })
      socket.emit('ops:snapshot', await operationsSnapshot())
      ack?.({ ok: true })
    })
    socket.on('ping', (ack) => ack?.({ pong: Date.now() }))
    socket.on('disconnect', () => {
      if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer)
      if (socket.data.leaseTimer) clearInterval(socket.data.leaseTimer)
      if (leased) void redisClient.zRem(userLeaseKey, socket.id)
    })
  })

  return async () => {
    if (flushTimer) clearTimeout(flushTimer)
    clearInterval(broadcasterTimer)
    await redisClient.sendCommand([
      'EVAL',
      releaseBroadcasterScript,
      '1',
      broadcasterLockKey,
      broadcasterId,
    ])
    unsubscribers.forEach((unsubscribe) => unsubscribe())
    await eventSubscriber.unsubscribe([domainChannel, telemetryChannel])
    io.disconnectSockets(true)
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await Promise.allSettled([
      adapterPublisher.quit(),
      adapterSubscriber.quit(),
      eventSubscriber.quit(),
    ])
  }
}
