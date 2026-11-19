import type { NavigationCoordinate, NavigationRoute, NavigationStep } from '@routecommand/shared'

import { env } from '../../config/env.js'
import { AppError, ErrorCode } from '../../core/errors/app-error.js'

export interface RouteRequest {
  waypoints: NavigationCoordinate[]
  costing: 'auto' | 'bicycle' | 'truck'
  alternatives?: number
  excludePolygons?: Array<{
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }>
  language?: string
}

export interface RoutingProvider {
  readonly name: string
  route(input: RouteRequest): Promise<NavigationRoute>
  matchTrace(
    points: Array<NavigationCoordinate & { recordedAt: string; accuracyM?: number }>,
    costing: RouteRequest['costing'],
  ): Promise<NavigationRoute>
  health(): Promise<boolean>
}

export class RoutingError extends AppError {
  constructor(message: string, statusCode = 503) {
    super(
      statusCode === 422 ? ErrorCode.BAD_REQUEST : ErrorCode.SERVICE_UNAVAILABLE,
      statusCode,
      message,
    )
    this.name = 'RoutingError'
  }
}

type ValhallaManeuver = {
  type?: number
  instruction?: string
  verbal_transition_alert_instruction?: string
  verbal_pre_transition_instruction?: string
  verbal_post_transition_instruction?: string
  street_names?: string[]
  length?: number
  time?: number
  begin_shape_index?: number
  end_shape_index?: number
  begin_heading?: number
  turn_degree?: number
  roundabout_exit_count?: number
}

type ValhallaLeg = {
  shape?: string
  maneuvers?: ValhallaManeuver[]
  summary?: { length?: number; time?: number }
}
type ValhallaResponse = {
  trip?: { legs?: ValhallaLeg[]; summary?: { length?: number; time?: number } }
  error?: string
  status_message?: string
}

function decodePolyline6(encoded: string): Array<[number, number]> {
  const coordinates: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    const read = () => {
      let result = 0
      let shift = 0
      let byte: number
      do {
        if (index >= encoded.length)
          throw new RoutingError('Routing engine returned malformed geometry.')
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      return result & 1 ? ~(result >> 1) : result >> 1
    }
    lat += read()
    lng += read()
    coordinates.push([lng / 1_000_000, lat / 1_000_000])
  }
  if (coordinates.length < 2) throw new RoutingError('Routing engine returned an empty route.')
  return coordinates
}

function maneuverType(type: number | undefined): string {
  const names: Record<number, string> = {
    1: 'START',
    2: 'START_RIGHT',
    3: 'START_LEFT',
    4: 'DESTINATION',
    5: 'BECOMES',
    6: 'CONTINUE',
    7: 'SLIGHT_RIGHT',
    8: 'RIGHT',
    9: 'SHARP_RIGHT',
    10: 'U_TURN_RIGHT',
    11: 'U_TURN_LEFT',
    12: 'SHARP_LEFT',
    13: 'LEFT',
    14: 'SLIGHT_LEFT',
    15: 'RAMP_STRAIGHT',
    16: 'RAMP_RIGHT',
    17: 'RAMP_LEFT',
    18: 'EXIT_RIGHT',
    19: 'EXIT_LEFT',
    20: 'STAY_STRAIGHT',
    21: 'STAY_RIGHT',
    22: 'STAY_LEFT',
    23: 'MERGE',
    24: 'ROUNDABOUT_ENTER',
    25: 'ROUNDABOUT_EXIT',
    26: 'FERRY_ENTER',
    27: 'FERRY_EXIT',
    28: 'TRANSFER',
    29: 'TRANSIT',
  }
  return type === undefined ? 'CONTINUE' : (names[type] ?? 'CONTINUE')
}

function normaliseLeg(leg: ValhallaLeg, legIndex: number) {
  const coordinates = decodePolyline6(leg.shape ?? '')
  const steps: NavigationStep[] = (leg.maneuvers ?? []).map((maneuver, index) => ({
    index,
    type: maneuverType(maneuver.type),
    instruction: maneuver.instruction ?? 'Continue on the route.',
    verbalAlert: maneuver.verbal_transition_alert_instruction || null,
    verbalPre: maneuver.verbal_pre_transition_instruction || null,
    verbalPost: maneuver.verbal_post_transition_instruction || null,
    streetNames: maneuver.street_names ?? [],
    distanceM: Math.max(0, (maneuver.length ?? 0) * 1_000),
    durationS: Math.max(0, maneuver.time ?? 0),
    beginShapeIndex: maneuver.begin_shape_index ?? 0,
    endShapeIndex: maneuver.end_shape_index ?? 0,
    bearingBefore: maneuver.begin_heading ?? 0,
    bearingAfter: ((maneuver.begin_heading ?? 0) + (maneuver.turn_degree ?? 0) + 360) % 360,
    roundaboutExit: maneuver.roundabout_exit_count ?? null,
  }))
  return {
    geometry: coordinates,
    steps,
    distanceM: Math.max(0, (leg.summary?.length ?? 0) * 1_000),
    durationS: Math.max(0, leg.summary?.time ?? 0),
    legIndex,
  }
}

function normaliseResponse(payload: ValhallaResponse, provider: string): NavigationRoute {
  if (!payload.trip?.legs?.length) {
    const outsideCoverage = /no suitable edges|no route|failed to find|not routable/i.test(
      payload.error ?? payload.status_message ?? '',
    )
    throw new RoutingError(
      outsideCoverage
        ? 'No road route is available for these locations.'
        : 'Routing engine could not calculate a route.',
      outsideCoverage ? 422 : 503,
    )
  }
  const legs = payload.trip.legs.map(normaliseLeg)
  const geometryCoordinates: Array<[number, number]> = []
  let globalStepIndex = 0
  const normalizedLegs = legs.map((leg) => {
    const indexOffset = Math.max(0, geometryCoordinates.length - 1)
    for (const point of leg.geometry) {
      if (
        !geometryCoordinates.length ||
        geometryCoordinates.at(-1)?.[0] !== point[0] ||
        geometryCoordinates.at(-1)?.[1] !== point[1]
      )
        geometryCoordinates.push(point)
    }
    const steps = leg.steps.map((step) => ({
      ...step,
      index: globalStepIndex++,
      beginShapeIndex: step.beginShapeIndex + indexOffset,
      endShapeIndex: step.endShapeIndex + indexOffset,
    }))
    return { steps, distanceM: leg.distanceM, durationS: leg.durationS }
  })
  if (geometryCoordinates.length < 2)
    throw new RoutingError('Routing engine returned an empty route.')
  return {
    geometry: { type: 'LineString', coordinates: geometryCoordinates },
    legs: normalizedLegs,
    distanceM: Math.max(
      0,
      (payload.trip.summary?.length ?? legs.reduce((sum, leg) => sum + leg.distanceM / 1_000, 0)) *
        1_000,
    ),
    durationS: Math.max(
      0,
      payload.trip.summary?.time ?? legs.reduce((sum, leg) => sum + leg.durationS, 0),
    ),
    provider,
    crossesRestrictedZone: false,
    degraded: false,
  }
}

export class ValhallaProvider implements RoutingProvider {
  readonly name = 'valhalla'
  private failureCount = 0
  private circuitOpenedAt = 0
  private readonly cache = new Map<string, { expiresAt: number; value: NavigationRoute }>()

  async route(input: RouteRequest): Promise<NavigationRoute> {
    const key = JSON.stringify(input)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value)
    if (this.failureCount >= 5) {
      if (Date.now() - this.circuitOpenedAt < 10_000) {
        throw new RoutingError('Road routing is temporarily unavailable.')
      }
      this.failureCount = 0
    }

    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), env.VALHALLA_TIMEOUT_MS)
    try {
      const response = await fetch(`${env.VALHALLA_URL.replace(/\/$/, '')}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          locations: input.waypoints.map(({ lat, lng }) => ({ lat, lon: lng })),
          costing: input.costing,
          alternates: input.alternatives ?? 0,
          units: 'kilometers',
          language: input.language ?? 'en-US',
          ...(input.excludePolygons?.length
            ? {
                exclude_polygons: input.excludePolygons.flatMap((geometry) => {
                  const polygons =
                    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
                  return polygons.flatMap((polygon) => (polygon[0] ? [polygon[0]] : []))
                }),
              }
            : {}),
        }),
      })
      const payload = (await response.json()) as ValhallaResponse
      if (!response.ok || !payload.trip?.legs?.length) {
        const outsideCoverage = /no suitable edges|no route|failed to find|not routable/i.test(
          payload.error ?? payload.status_message ?? '',
        )
        const rejectedOptions = response.status === 400 || response.status === 422
        throw new RoutingError(
          rejectedOptions
            ? 'Routing engine rejected route options; retrying without zone exclusions.'
            : outsideCoverage
              ? 'No road route is available for these locations.'
              : 'Routing engine could not calculate a route.',
          rejectedOptions || outsideCoverage ? 422 : 503,
        )
      }
      const route = normaliseResponse(payload, this.name)
      this.failureCount = 0
      this.cache.set(key, { expiresAt: Date.now() + 30_000, value: route })
      for (const [cacheKey, entry] of this.cache)
        if (entry.expiresAt <= Date.now()) this.cache.delete(cacheKey)
      return route
    } catch (error) {
      if (error instanceof RoutingError) {
        if (error.statusCode >= 500) {
          this.failureCount += 1
          this.circuitOpenedAt = Date.now()
        }
        throw error
      }
      this.failureCount += 1
      this.circuitOpenedAt = Date.now()
      throw new RoutingError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Routing engine timed out.'
          : 'Routing engine could not be reached.',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async matchTrace(
    points: Array<NavigationCoordinate & { recordedAt: string; accuracyM?: number }>,
    costing: RouteRequest['costing'],
  ): Promise<NavigationRoute> {
    if (points.length < 2)
      throw new RoutingError('At least two GPS fixes are required for map matching.', 422)
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), env.VALHALLA_TIMEOUT_MS)
    try {
      const firstTime = Date.parse(points[0]!.recordedAt) / 1_000
      const response = await fetch(`${env.VALHALLA_URL.replace(/\/$/, '')}/trace_route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          costing,
          shape_match: 'map_snap',
          units: 'kilometers',
          language: 'en-US',
          gps_accuracy: Math.round(
            points.reduce((max, point) => Math.max(max, point.accuracyM ?? 0), 0),
          ),
          shape: points.map((point, index) => ({
            lat: point.lat,
            lon: point.lng,
            time: Math.max(0, Date.parse(point.recordedAt) / 1_000 - firstTime),
            ...(index === 0 || index === points.length - 1 ? { type: 'break' } : { type: 'via' }),
          })),
        }),
      })
      const payload = (await response.json()) as ValhallaResponse
      if (!response.ok) throw new RoutingError('Routing engine could not match this GPS trace.')
      return normaliseResponse(payload, this.name)
    } catch (error) {
      if (error instanceof RoutingError) throw error
      throw new RoutingError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Map matching timed out.'
          : 'Routing engine could not match this GPS trace.',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async health(): Promise<boolean> {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 2_000)
    try {
      const response = await fetch(`${env.VALHALLA_URL.replace(/\/$/, '')}/status`, {
        signal: abort.signal,
      })
      return response.ok
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class FakeProvider implements RoutingProvider {
  readonly name = 'fixture'
  constructor(private readonly fixture?: NavigationRoute) {}

  async route(input: RouteRequest): Promise<NavigationRoute> {
    if (this.fixture) return structuredClone(this.fixture)
    const coordinates = input.waypoints.map(({ lat, lng }) => [lng, lat] as [number, number])
    const distanceM = input.waypoints.slice(1).reduce((total, point, index) => {
      const previous = input.waypoints[index]!
      const dLat = ((point.lat - previous.lat) * Math.PI) / 180
      const dLng = ((point.lng - previous.lng) * Math.PI) / 180
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((previous.lat * Math.PI) / 180) *
          Math.cos((point.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2
      return total + 2 * 6_371_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
    }, 0)
    return {
      geometry: { type: 'LineString', coordinates },
      legs: [
        {
          steps: [
            {
              index: 0,
              type: 'CONTINUE',
              instruction: 'Continue toward the destination.',
              verbalAlert: null,
              verbalPre: null,
              verbalPost: null,
              streetNames: [],
              distanceM,
              durationS: Math.round(distanceM / 8),
              beginShapeIndex: 0,
              endShapeIndex: coordinates.length - 1,
              bearingBefore: 0,
              bearingAfter: 0,
              roundaboutExit: null,
            },
          ],
          distanceM,
          durationS: Math.round(distanceM / 8),
        },
      ],
      distanceM,
      durationS: Math.round(distanceM / 8),
      provider: this.name,
      crossesRestrictedZone: false,
      degraded: false,
    }
  }

  async matchTrace(
    points: Array<NavigationCoordinate & { recordedAt: string; accuracyM?: number }>,
    costing: RouteRequest['costing'],
  ): Promise<NavigationRoute> {
    return this.route({ waypoints: points, costing })
  }

  async health(): Promise<boolean> {
    return true
  }
}

export const routingProvider: RoutingProvider = new ValhallaProvider()
