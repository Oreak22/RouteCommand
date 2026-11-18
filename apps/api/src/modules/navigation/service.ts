import type {
  NavigationCoordinate,
  NavigationRoute,
  NavigationTargetType,
} from '@routecommand/shared'

import { routingProvider, RoutingError } from './provider.js'
import { env } from '../../config/env.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { query } from '../../db/pool.js'
import { redisClient } from '../../infra/redis.js'

const activeStatuses = ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED']

async function restrictedPolygons(): Promise<
  Array<{ type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }>
> {
  const result = await query<{ geometry: unknown; total_perimeter_m: number }>(
    `SELECT ST_AsGeoJSON(geom::geometry)::json AS geometry,
            SUM(ST_Perimeter(geom)) OVER ()::float8 AS total_perimeter_m
       FROM zones WHERE type = 'RESTRICTED' AND is_active = true`,
  )
  // Valhalla validates the combined exclusion perimeter against a 10 km cap.
  // For larger zone sets, omit provider exclusions and rely on the authoritative
  // PostGIS route-intersection check below; the driver session is blocked if it crosses.
  if (Number(result.rows[0]?.total_perimeter_m ?? 0) > 9_000) return []
  return result.rows.flatMap(({ geometry }) => {
    if (!geometry || typeof geometry !== 'object') return []
    const value = geometry as { type?: unknown; coordinates?: unknown }
    if (
      (value.type !== 'Polygon' && value.type !== 'MultiPolygon') ||
      !Array.isArray(value.coordinates)
    )
      return []
    return [
      { type: value.type, coordinates: value.coordinates } as {
        type: 'Polygon' | 'MultiPolygon'
        coordinates: number[][][] | number[][][][]
      },
    ]
  })
}

async function crossesRestrictedZone(route: NavigationRoute): Promise<boolean> {
  const intersection = await query<{ intersects: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM zones z
        WHERE z.type = 'RESTRICTED' AND z.is_active
          AND ST_Intersects(z.geom::geometry, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
     ) AS intersects`,
    [JSON.stringify(route.geometry)],
  )
  return Boolean(intersection.rows[0]?.intersects)
}

export async function previewRoute(input: {
  waypoints: NavigationCoordinate[]
  costing: 'auto' | 'bicycle' | 'truck'
  language: string
  alternatives?: number
}): Promise<NavigationRoute> {
  try {
    const route = await routingProvider.route({
      ...input,
      excludePolygons: await restrictedPolygons(),
    })
    return { ...route, crossesRestrictedZone: await crossesRestrictedZone(route) }
  } catch (error) {
    if (error instanceof RoutingError && error.statusCode === 422) {
      const fallback = await routingProvider.route({ ...input, excludePolygons: [] })
      return { ...fallback, crossesRestrictedZone: await crossesRestrictedZone(fallback) }
    }
    if (error instanceof RoutingError && error.statusCode === 503) {
      const [start, end] = [input.waypoints[0]!, input.waypoints.at(-1)!]
      const radians = (degrees: number) => (degrees * Math.PI) / 180
      const dLat = radians(end.lat - start.lat)
      const dLng = radians(end.lng - start.lng)
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(radians(start.lat)) * Math.cos(radians(end.lat)) * Math.sin(dLng / 2) ** 2
      const distanceM = 2 * 6_371_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
      const bearing =
        ((Math.atan2(dLng * Math.cos(radians((start.lat + end.lat) / 2)), dLat) * 180) / Math.PI +
          360) %
        360
      const fallbackRoute: NavigationRoute = {
        geometry: {
          type: 'LineString',
          coordinates: input.waypoints.map(({ lat, lng }) => [lng, lat] as [number, number]),
        },
        legs: [
          {
            steps: [
              {
                index: 0,
                type: 'CONTINUE',
                instruction: 'Road routing unavailable. Head toward the destination.',
                verbalAlert: null,
                verbalPre: null,
                verbalPost: null,
                streetNames: [],
                distanceM,
                durationS: Math.round(distanceM / 8),
                beginShapeIndex: 0,
                endShapeIndex: input.waypoints.length - 1,
                bearingBefore: bearing,
                bearingAfter: bearing,
                roundaboutExit: null,
              },
            ],
            distanceM,
            durationS: Math.round(distanceM / 8),
          },
        ],
        distanceM,
        durationS: Math.round(distanceM / 8),
        provider: 'straight-line',
        crossesRestrictedZone: false,
        degraded: true,
      }
      return { ...fallbackRoute, crossesRestrictedZone: await crossesRestrictedZone(fallbackRoute) }
    }
    if (error instanceof RoutingError) throw error
    throw error
  }
}

interface ShipmentNavigationRow {
  shipment_id: string
  status: string
  driver_id: string
  tracking_code: string
  pickup_lat: number
  pickup_lng: number
  dropoff_lat: number
  dropoff_lng: number
  vehicle_type: 'BIKE' | 'CAR' | 'VAN' | 'TRUCK'
}

async function getAssignedShipment(userId: string, driverId: string, shipmentId: string) {
  const result = await query<ShipmentNavigationRow>(
    `SELECT s.id AS shipment_id, s.status::text AS status, d.id AS driver_id,
            s.tracking_code, ST_Y(s.pickup_location::geometry)::float8 AS pickup_lat,
            ST_X(s.pickup_location::geometry)::float8 AS pickup_lng,
            ST_Y(s.dropoff_location::geometry)::float8 AS dropoff_lat,
            ST_X(s.dropoff_location::geometry)::float8 AS dropoff_lng,
            v.type AS vehicle_type
       FROM shipments s JOIN drivers d ON d.id = s.driver_id
       JOIN vehicles v ON v.id = d.vehicle_id
      WHERE s.id = $1 AND d.id = $2 AND d.user_id = $3`,
    [shipmentId, driverId, userId],
  )
  const row = result.rows[0]
  if (!row) throw new ForbiddenError('This shipment is not assigned to your driver account.')
  if (!activeStatuses.includes(row.status))
    throw new ConflictError('This shipment is no longer active.')
  return row
}

function costingFor(type: ShipmentNavigationRow['vehicle_type']): 'auto' | 'bicycle' | 'truck' {
  return type === 'BIKE' ? 'bicycle' : type === 'CAR' ? 'auto' : 'truck'
}

function navigationTarget(shipment: ShipmentNavigationRow): NavigationCoordinate {
  return navigationTargetType(shipment.status) === 'DROPOFF'
    ? { lat: shipment.dropoff_lat, lng: shipment.dropoff_lng }
    : { lat: shipment.pickup_lat, lng: shipment.pickup_lng }
}

function navigationTargetType(status: string): NavigationTargetType {
  return status === 'PICKED_UP' || status === 'IN_TRANSIT' || status === 'ARRIVED'
    ? 'DROPOFF'
    : 'PICKUP'
}

function sameCoordinate(first: NavigationCoordinate | undefined, second: NavigationCoordinate) {
  return first?.lat === second.lat && first.lng === second.lng
}

async function currentDriverLocation(driverId: string): Promise<NavigationCoordinate | null> {
  const [raw, seenAt] = await Promise.all([
    redisClient.hGet(`routecommand:driver:${driverId}:loc`, 'point'),
    redisClient.get(`routecommand:driver:${driverId}:seen`),
  ])
  if (!raw || !seenAt || Date.now() - Date.parse(seenAt) > env.DRIVER_SIGNAL_STALE_SECONDS * 1_000)
    return null
  try {
    const data = JSON.parse(raw) as { point?: NavigationCoordinate; lat?: number; lng?: number }
    const point = data.point ?? data
    return typeof point.lat === 'number' &&
      Number.isFinite(point.lat) &&
      typeof point.lng === 'number' &&
      Number.isFinite(point.lng)
      ? { lat: point.lat, lng: point.lng }
      : null
  } catch {
    return null
  }
}

async function lastKnownDriverLocation(driverId: string): Promise<NavigationCoordinate | null> {
  const result = await query<{ lat: number | null; lng: number | null }>(
    `SELECT ST_Y(last_known_location::geometry)::float8 AS lat,
            ST_X(last_known_location::geometry)::float8 AS lng
       FROM drivers WHERE id = $1 AND last_known_location IS NOT NULL`,
    [driverId],
  )
  const location = result.rows[0]
  return location?.lat !== null &&
    location?.lat !== undefined &&
    location.lng !== null &&
    location.lng !== undefined
    ? { lat: location.lat, lng: location.lng }
    : null
}

export interface NavigationSessionRecord {
  id: string
  driverId: string
  shipmentId: string
  status: string
  route: NavigationRoute
  waypoints: NavigationCoordinate[]
  targetType: NavigationTargetType
  distanceM: number
  durationS: number
  currentStepIndex: number
  rerouteCount: number
  startedAt: string | null
  updatedAt: string
}

async function recoverStraightLineSession(
  session: NavigationSessionRecord,
): Promise<NavigationSessionRecord> {
  if (!session.route.degraded || session.route.provider !== 'straight-line') return session
  const current = await currentDriverLocation(session.driverId)
  const first = session.route.geometry.coordinates[0]
  const position = current ?? (first ? { lng: first[0], lat: first[1] } : null)
  if (!position) return session
  try {
    return await rerouteNavigationSession(session.id, session.driverId, {
      position,
      accuracyM: 100,
      heading: null,
      reason: 'USER_REQUEST',
    })
  } catch (error) {
    if (error instanceof ConflictError) throw error
    return session
  }
}

function sessionSql() {
  return `SELECT n.id, n.driver_id, n.shipment_id, n.status::text AS status, n.route, n.waypoints,
                 CASE WHEN s.status IN ('PICKED_UP','IN_TRANSIT','ARRIVED') THEN 'DROPOFF' ELSE 'PICKUP' END AS target_type,
                 n.distance_m::float8 AS distance_m, n.duration_s, n.current_step_index,
                 n.reroute_count, n.started_at, n.updated_at
            FROM navigation_sessions n JOIN shipments s ON s.id = n.shipment_id`
}

function mapSession(row: Record<string, unknown>): NavigationSessionRecord {
  return {
    id: String(row.id),
    driverId: String(row.driver_id),
    shipmentId: String(row.shipment_id),
    status: String(row.status),
    route: row.route as NavigationRoute,
    waypoints: row.waypoints as NavigationCoordinate[],
    targetType: row.target_type === 'DROPOFF' ? 'DROPOFF' : 'PICKUP',
    distanceM: Number(row.distance_m),
    durationS: Number(row.duration_s),
    currentStepIndex: Number(row.current_step_index),
    rerouteCount: Number(row.reroute_count),
    startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function startNavigationSession(userId: string, driverId: string, shipmentId: string) {
  const shipment = await getAssignedShipment(userId, driverId, shipmentId)
  const existing = await query<Record<string, unknown>>(
    `${sessionSql()} WHERE n.driver_id = $1 AND n.status IN ('PLANNED','ACTIVE','OFF_ROUTE','REROUTING') ORDER BY n.created_at DESC LIMIT 1`,
    [driverId],
  )
  if (existing.rows[0] && String(existing.rows[0].shipment_id) === shipmentId)
    return recoverStraightLineSession(await reconcileNavigationStage(mapSession(existing.rows[0])))
  if (existing.rows[0])
    throw new ConflictError('End the active navigation session before starting another.')

  const position =
    (await currentDriverLocation(driverId)) ?? (await lastKnownDriverLocation(driverId))
  if (!position) {
    throw new ConflictError(
      'A current driver location is needed to start navigation. Enable location sharing and try again.',
    )
  }
  const remaining = [navigationTarget(shipment)]
  const waypoints = [position, ...remaining]
  const route = await previewRoute({
    waypoints,
    costing: costingFor(shipment.vehicle_type),
    language: 'en-US',
  })
  if (route.crossesRestrictedZone) {
    throw new ConflictError(
      'The available road route crosses a restricted zone and needs dispatcher review.',
      {
        reason: 'RESTRICTED_ROUTE_CONFIRMATION_REQUIRED',
      },
    )
  }
  const result = await query<Record<string, unknown>>(
    `INSERT INTO navigation_sessions (driver_id, shipment_id, status, route, waypoints, distance_m, duration_s, started_at, provider)
     VALUES ($1, $2, 'ACTIVE', $3::jsonb, $4::jsonb, $5, $6, now(), $7)
     RETURNING id, driver_id, shipment_id, status::text AS status, route, waypoints,
               distance_m::float8 AS distance_m, duration_s, current_step_index,
               reroute_count, started_at, updated_at`,
    [
      driverId,
      shipmentId,
      JSON.stringify(route),
      JSON.stringify(remaining),
      route.distanceM,
      Math.round(route.durationS),
      route.provider,
    ],
  )
  const session = {
    ...mapSession(result.rows[0]!),
    targetType: navigationTargetType(shipment.status),
  }
  domainEventBus.publish('navigation.route', { ...session, trackingCode: shipment.tracking_code })
  return session
}

export async function getActiveNavigationSession(driverId: string) {
  const result = await query<Record<string, unknown>>(
    `${sessionSql()} WHERE n.driver_id = $1 AND n.status IN ('PLANNED','ACTIVE','OFF_ROUTE','REROUTING') ORDER BY n.created_at DESC LIMIT 1`,
    [driverId],
  )
  return result.rows[0]
    ? recoverStraightLineSession(await reconcileNavigationStage(mapSession(result.rows[0])))
    : null
}

export async function listActiveNavigationSessions() {
  const result = await query<Record<string, unknown>>(
    `${sessionSql()} WHERE n.status IN ('ACTIVE','OFF_ROUTE','REROUTING') ORDER BY n.updated_at DESC LIMIT 500`,
  )
  return result.rows.map(mapSession)
}

export async function getNavigationSession(
  sessionId: string,
  userId: string,
  role: string,
  driverId?: string,
) {
  const result = await query<Record<string, unknown>>(`${sessionSql()} WHERE n.id = $1`, [
    sessionId,
  ])
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Navigation session was not found.')
  if (role === 'DRIVER' && (row.driver_id !== driverId || String(row.driver_id) === ''))
    throw new ForbiddenError()
  if (!['DRIVER', 'ADMIN', 'DISPATCHER'].includes(role)) throw new ForbiddenError()
  void userId
  return mapSession(row)
}

export async function rerouteNavigationSession(
  sessionId: string,
  driverId: string,
  input: {
    position: NavigationCoordinate
    heading?: number | null
    accuracyM: number
    reason: string
  },
) {
  const result = await query<Record<string, unknown>>(
    `${sessionSql()} WHERE n.id = $1 AND n.driver_id = $2 AND n.status IN ('ACTIVE','OFF_ROUTE','REROUTING')`,
    [sessionId, driverId],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Active navigation session was not found.')
  const throttleKey = `routecommand:navigation:reroute:${sessionId}`
  const previous = mapSession(row)
  const shipmentResult = await query<ShipmentNavigationRow>(
    `SELECT s.id AS shipment_id, s.status::text AS status, d.id AS driver_id,
            s.tracking_code, ST_Y(s.pickup_location::geometry)::float8 AS pickup_lat,
            ST_X(s.pickup_location::geometry)::float8 AS pickup_lng,
            ST_Y(s.dropoff_location::geometry)::float8 AS dropoff_lat,
            ST_X(s.dropoff_location::geometry)::float8 AS dropoff_lng,
            v.type AS vehicle_type
       FROM shipments s JOIN drivers d ON d.id = s.driver_id
       JOIN vehicles v ON v.id = d.vehicle_id
      WHERE s.id = $1 AND d.id = $2`,
    [previous.shipmentId, driverId],
  )
  const shipment = shipmentResult.rows[0]
  if (!shipment) throw new ConflictError('The shipment no longer has an assigned driver.')
  const destinations = [navigationTarget(shipment)]
  if (reasonMatchesActiveTarget(input.reason, previous.waypoints, destinations[0]!)) return previous

  if (input.reason !== 'STOP_ADVANCED') {
    if (
      !(await redisClient.set(throttleKey, '1', {
        NX: true,
        EX: env.NAVIGATION_REROUTE_MIN_INTERVAL_SECONDS,
      }))
    )
      throw new ConflictError('Please wait before requesting another route.')
  }
  const rerouteWindowKey = `routecommand:navigation:reroute-window:${sessionId}`
  const rerouteAttempts =
    input.reason === 'STOP_ADVANCED'
      ? previous.rerouteCount
      : await redisClient.incr(rerouteWindowKey)
  if (input.reason !== 'STOP_ADVANCED' && rerouteAttempts === 1)
    await redisClient.expire(rerouteWindowKey, 120)
  if (input.reason !== 'STOP_ADVANCED' && rerouteAttempts > 5) {
    const alert = await query<{ id: string }>(
      `INSERT INTO alerts (type, severity, driver_id, shipment_id, payload)
       SELECT 'OFF_ROUTE'::alert_type, 'HIGH'::alert_severity, $1, $2, $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM alerts
          WHERE type = 'OFF_ROUTE'::alert_type AND driver_id = $1 AND shipment_id = $2 AND status <> 'RESOLVED'
       ) RETURNING id`,
      [
        driverId,
        previous.shipmentId,
        JSON.stringify({
          navigationSessionId: sessionId,
          reason: 'REROUTE_LIMIT_EXCEEDED',
          attempts: rerouteAttempts,
        }),
      ],
    )
    if (alert.rows[0])
      domainEventBus.publish('alert.created', {
        alertId: alert.rows[0].id,
        type: 'OFF_ROUTE',
        severity: 'HIGH',
      })
    throw new ConflictError(
      'Automatic rerouting paused after repeated route failures. Ask dispatch to check the route.',
      {
        reason: 'REROUTE_LIMIT_EXCEEDED',
      },
    )
  }
  const vehicle = await query<{ type: ShipmentNavigationRow['vehicle_type'] }>(
    `SELECT v.type FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = $1`,
    [driverId],
  )
  const route = await previewRoute({
    waypoints: [input.position, ...destinations],
    costing: costingFor(vehicle.rows[0]?.type ?? 'CAR'),
    language: 'en-US',
  })
  if (route.crossesRestrictedZone) {
    throw new ConflictError(
      'The new road route crosses a restricted zone. Ask dispatch to check the route.',
      {
        reason: 'RESTRICTED_ROUTE_CONFIRMATION_REQUIRED',
      },
    )
  }
  const updated = await query<Record<string, unknown>>(
    `UPDATE navigation_sessions SET route = $3::jsonb, waypoints = $4::jsonb, status = 'ACTIVE',
            reroute_count = reroute_count + CASE WHEN $8 THEN 0 ELSE 1 END,
            current_step_index = 0, distance_m = $5, duration_s = $6, provider = $7
      WHERE id = $1 AND driver_id = $2
      RETURNING id, driver_id, shipment_id, status::text AS status, route, waypoints,
                distance_m::float8 AS distance_m, duration_s, current_step_index,
                reroute_count, started_at, updated_at`,
    [
      sessionId,
      driverId,
      JSON.stringify(route),
      JSON.stringify(destinations),
      route.distanceM,
      Math.round(route.durationS),
      route.provider,
      input.reason === 'STOP_ADVANCED',
    ],
  )
  const session = {
    ...mapSession(updated.rows[0]!),
    targetType: navigationTargetType(shipment.status),
  }
  domainEventBus.publish('navigation.rerouted', session)
  return session
}

function reasonMatchesActiveTarget(
  reason: string,
  currentWaypoints: NavigationCoordinate[],
  target: NavigationCoordinate,
) {
  return (
    reason === 'STOP_ADVANCED' &&
    currentWaypoints.length === 1 &&
    sameCoordinate(currentWaypoints[0], target)
  )
}

async function reconcileNavigationStage(session: NavigationSessionRecord) {
  const shipmentResult = await query<ShipmentNavigationRow>(
    `SELECT s.id AS shipment_id, s.status::text AS status, d.id AS driver_id,
            s.tracking_code, ST_Y(s.pickup_location::geometry)::float8 AS pickup_lat,
            ST_X(s.pickup_location::geometry)::float8 AS pickup_lng,
            ST_Y(s.dropoff_location::geometry)::float8 AS dropoff_lat,
            ST_X(s.dropoff_location::geometry)::float8 AS dropoff_lng,
            v.type AS vehicle_type
       FROM shipments s JOIN drivers d ON d.id = s.driver_id
       JOIN vehicles v ON v.id = d.vehicle_id
      WHERE s.id = $1 AND d.id = $2`,
    [session.shipmentId, session.driverId],
  )
  const shipment = shipmentResult.rows[0]
  if (!shipment) return session
  const target = navigationTarget(shipment)
  if (session.waypoints.length === 1 && sameCoordinate(session.waypoints[0], target)) return session
  const current = await currentDriverLocation(session.driverId)
  const first = session.route.geometry.coordinates[0]
  const position = current ?? (first ? { lng: first[0], lat: first[1] } : null)
  if (!position) return session
  return rerouteNavigationSession(session.id, session.driverId, {
    position,
    accuracyM: 100,
    heading: null,
    reason: 'STOP_ADVANCED',
  })
}

export async function updateNavigationProgress(
  sessionId: string,
  driverId: string,
  input: {
    stepIndex: number
    remainingDistanceM: number
    etaSeconds: number
    offRoute: boolean
    status: 'ON_ROUTE' | 'OFF_ROUTE' | 'ESTIMATED' | 'ARRIVED'
    position: NavigationCoordinate
    occurredAt: string
  },
) {
  const previousKey = `routecommand:navigation:progress:${sessionId}`
  const priorJson = await redisClient.get(previousKey)
  const result = await query<Record<string, unknown>>(
    `${sessionSql()} WHERE n.id = $1 AND n.driver_id = $2 AND n.status IN ('ACTIVE','OFF_ROUTE','REROUTING')`,
    [sessionId, driverId],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Active navigation session was not found.')
  const session = mapSession(row)
  const maxStep = Math.max(
    0,
    ...session.route.legs.flatMap((leg) => leg.steps.map((step) => step.index)),
  )
  const previous = priorJson
    ? (JSON.parse(priorJson) as {
        stepIndex?: number
        remainingDistanceM?: number
        etaSeconds?: number
        status?: string
      })
    : null
  if (
    input.stepIndex > maxStep ||
    input.stepIndex < session.currentStepIndex - 1 ||
    (previous?.stepIndex !== undefined && input.stepIndex < previous.stepIndex - 1)
  ) {
    throw new ConflictError('Navigation progress moved outside the active route.')
  }
  const progressKey = `routecommand:navigation:progress-limit:${sessionId}`
  if (
    !(await redisClient.set(progressKey, '1', {
      NX: true,
      EX: env.NAVIGATION_PROGRESS_MIN_INTERVAL_SECONDS,
    }))
  ) {
    throw new ConflictError('Navigation progress was sent too soon.')
  }
  const changed =
    !previous ||
    Math.abs(
      (previous.remainingDistanceM ?? input.remainingDistanceM) - input.remainingDistanceM,
    ) >= 25 ||
    Math.abs((previous.etaSeconds ?? input.etaSeconds) - input.etaSeconds) >= 30
  await redisClient.set(previousKey, JSON.stringify(input), { EX: 86_400 })
  await query(
    `UPDATE navigation_sessions SET current_step_index = $2,
       status = $3::navigation_session_status
     WHERE id = $1`,
    [sessionId, input.stepIndex, input.status === 'OFF_ROUTE' ? 'OFF_ROUTE' : 'ACTIVE'],
  )
  let trackingCode = ''
  if (changed) {
    const shipmentResult = await query<{ tracking_code: string }>(
      `UPDATE shipments SET eta = now() + ($2::int * interval '1 second') WHERE id = $1 RETURNING tracking_code`,
      [session.shipmentId, input.etaSeconds],
    )
    trackingCode = shipmentResult.rows[0]?.tracking_code ?? ''
  }
  const payload = {
    ...input,
    navigationSessionId: sessionId,
    driverId,
    shipmentId: session.shipmentId,
    trackingCode,
    changed,
  }
  if (input.status === 'OFF_ROUTE')
    domainEventBus.publish('navigation.offRoute', {
      navigationSessionId: sessionId,
      driverId,
      shipmentId: session.shipmentId,
    })
  if (input.status === 'ARRIVED')
    domainEventBus.publish('navigation.arrived', {
      navigationSessionId: sessionId,
      driverId,
      shipmentId: session.shipmentId,
    })
  domainEventBus.publish('navigation.progress', payload)
  if (input.status === 'OFF_ROUTE' && previous?.status !== 'OFF_ROUTE') {
    const alert = await query<{ id: string }>(
      `INSERT INTO alerts (type, severity, driver_id, shipment_id, payload)
       SELECT 'OFF_ROUTE'::alert_type, 'HIGH'::alert_severity, $1, $2, $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM alerts
          WHERE type = 'OFF_ROUTE'::alert_type AND driver_id = $1 AND shipment_id = $2 AND status <> 'RESOLVED'
       ) RETURNING id`,
      [
        driverId,
        session.shipmentId,
        JSON.stringify({
          navigationSessionId: sessionId,
          remainingDistanceM: input.remainingDistanceM,
          position: input.position,
        }),
      ],
    )
    if (alert.rows[0])
      domainEventBus.publish('alert.created', {
        alertId: alert.rows[0].id,
        type: 'OFF_ROUTE',
        severity: 'HIGH',
      })
  }
  if (input.status === 'ARRIVED' && previous?.status !== 'ARRIVED') {
    const once = await redisClient.set(`routecommand:navigation:arrived:${sessionId}`, '1', {
      NX: true,
      EX: 86_400,
    })
    if (once === 'OK') {
      const driver = await query<{ user_id: string }>('SELECT user_id FROM drivers WHERE id = $1', [
        driverId,
      ])
      const shipment = await query<{ status: string }>(
        'SELECT status::text FROM shipments WHERE id = $1',
        [session.shipmentId],
      )
      if (driver.rows[0] && shipment.rows[0]?.status === 'IN_TRANSIT') {
        domainEventBus.publish('shipment.suggested', {
          shipmentId: session.shipmentId,
          driverId,
          suggestedStatus: 'ARRIVED',
          reason: 'NEAR_DROPOFF',
        })
      }
    }
  }
  return { ok: true as const }
}

export async function endNavigationSession(
  sessionId: string,
  driverId: string,
  reason: 'ARRIVED' | 'CANCELLED' | 'MANUAL',
) {
  const status = reason === 'ARRIVED' ? 'ARRIVED' : 'CANCELLED'
  const result = await query<Record<string, unknown>>(
    `UPDATE navigation_sessions SET status = $3::navigation_session_status, ended_at = now()
      WHERE id = $1 AND driver_id = $2 AND status IN ('PLANNED','ACTIVE','OFF_ROUTE','REROUTING')
      RETURNING id, driver_id, shipment_id, status::text AS status, route, waypoints,
                distance_m::float8 AS distance_m, duration_s, current_step_index,
                reroute_count, started_at, updated_at`,
    [sessionId, driverId, status],
  )
  if (!result.rows[0]) throw new NotFoundError('Active navigation session was not found.')
  const session = mapSession(result.rows[0])
  domainEventBus.publish('navigation.ended', { ...session, reason })
  return session
}

export async function navigationReadiness() {
  return routingProvider.health()
}

export const navigationConfig = {
  requestTimeoutMs: 8_000,
  rerouteIntervalSeconds: 8,
  driverSignalStaleSeconds: env.DRIVER_SIGNAL_STALE_SECONDS,
}
