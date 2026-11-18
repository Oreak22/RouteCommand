import { z } from 'zod'

export const navigationCoordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
})
export type NavigationCoordinate = z.infer<typeof navigationCoordinateSchema>

export const navigationStepSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.string(),
  instruction: z.string(),
  verbalAlert: z.string().nullable(),
  verbalPre: z.string().nullable(),
  verbalPost: z.string().nullable(),
  streetNames: z.array(z.string()),
  distanceM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  beginShapeIndex: z.number().int().nonnegative(),
  endShapeIndex: z.number().int().nonnegative(),
  bearingBefore: z.number().min(0).max(360),
  bearingAfter: z.number().min(0).max(360),
  roundaboutExit: z.number().int().positive().nullable(),
})
export type NavigationStep = z.infer<typeof navigationStepSchema>

export const navigationRouteSchema = z.object({
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  }),
  legs: z.array(
    z.object({
      steps: z.array(navigationStepSchema),
      distanceM: z.number().nonnegative(),
      durationS: z.number().nonnegative(),
    }),
  ),
  distanceM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  provider: z.string(),
  crossesRestrictedZone: z.boolean().default(false),
  degraded: z.boolean().default(false),
})
export type NavigationRoute = z.infer<typeof navigationRouteSchema>
export type NavigationTargetType = 'PICKUP' | 'DROPOFF'

export const routePreviewSchema = z.object({
  waypoints: z.array(navigationCoordinateSchema).min(2).max(10),
  costing: z.enum(['auto', 'bicycle', 'truck']),
  language: z.string().trim().min(2).max(16).default('en'),
  alternatives: z.number().int().min(0).max(3).default(0),
})
export const startNavigationSchema = z.object({ shipmentId: z.string().uuid() })
export const navigationSessionIdSchema = z.object({ sessionId: z.string().uuid() })
export const navigationRerouteSchema = z.object({
  position: navigationCoordinateSchema,
  heading: z.number().min(0).max(360).nullable().optional(),
  accuracyM: z.number().positive().max(10_000),
  reason: z
    .enum(['OFF_ROUTE', 'USER_REQUEST', 'VEHICLE_CHANGED', 'STOP_ADVANCED'])
    .default('OFF_ROUTE'),
})
export const navigationProgressSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  remainingDistanceM: z.number().nonnegative(),
  etaSeconds: z.number().int().nonnegative(),
  offRoute: z.boolean(),
  status: z.enum(['ON_ROUTE', 'OFF_ROUTE', 'ESTIMATED', 'ARRIVED']),
  position: navigationCoordinateSchema,
  occurredAt: z.string().datetime({ offset: true }),
})
export const endNavigationSchema = z.object({ reason: z.enum(['ARRIVED', 'CANCELLED', 'MANUAL']) })

export interface NavigationFix extends NavigationCoordinate {
  accuracyM: number
  speedMps: number | null
  headingDeg: number | null
  recordedAt: string
}

export interface NavigationState {
  status: 'ON_ROUTE' | 'OFF_ROUTE' | 'ESTIMATED' | 'ARRIVED'
  distanceAlongRouteM: number
  lateralOffsetM: number
  snappedPosition: NavigationCoordinate
  currentStepIndex: number
  distanceToNextManeuverM: number
  remainingDistanceM: number
  etaSeconds: number
  confidence: 'HIGH' | 'LOW'
  announcements: Array<{ stepIndex: number; tier: 'ALERT' | 'PRE' | 'NOW'; text: string }>
}

export const defaultNavigationConfig = {
  maxAccuracyM: 100,
  offRouteMinimumM: 35,
  offRouteAccuracyMultiplier: 1.5,
  offRouteConsecutiveFixes: 3,
  onRouteRecoveryFixes: 2,
  deadReckonMaxSeconds: 15,
  minimumMovingSpeedMps: 1.5,
  headingUsefulSpeedMps: 2,
  arrivalRadiusM: 25,
  arrivalMaximumSpeedMps: 3,
} as const
export type NavigationEngineConfig = typeof defaultNavigationConfig

const earthRadiusM = 6_371_000
const radians = (degrees: number) => (degrees * Math.PI) / 180
const distance = (a: NavigationCoordinate, b: NavigationCoordinate) => {
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Deterministic route progress tracker. It deliberately searches only a forward window. */
export class NavigationEngine {
  private points: NavigationCoordinate[]
  private cumulative: number[] = [0]
  private steps: NavigationStep[]
  private progressM = 0
  private offRouteFixes = 0
  private onRouteFixes = 0
  private readonly announced = new Set<string>()
  private lastGoodFix: NavigationFix | null = null
  private lastGoodAt = 0
  private lastDeadReckonedAt = 0
  private speedRatio = 1

  constructor(
    private route: NavigationRoute,
    private readonly now: () => number = Date.now,
    private readonly config: NavigationEngineConfig = defaultNavigationConfig,
  ) {
    this.points = []
    this.steps = []
    this.prepareRoute(route)
  }

  private prepareRoute(route: NavigationRoute): void {
    this.points = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
    this.cumulative = [0]
    for (let index = 1; index < this.points.length; index += 1) {
      this.cumulative.push(
        this.cumulative[index - 1]! + distance(this.points[index - 1]!, this.points[index]!),
      )
    }
    this.steps = route.legs.flatMap((leg) => leg.steps)
  }

  resetRoute(route: NavigationRoute): void {
    this.route = route
    this.prepareRoute(route)
    this.progressM = 0
    this.offRouteFixes = 0
    this.onRouteFixes = 0
    this.announced.clear()
    this.lastGoodFix = null
    this.lastGoodAt = 0
    this.lastDeadReckonedAt = 0
    this.speedRatio = 1
  }

  update(fix: NavigationFix): NavigationState | null {
    if (fix.accuracyM > this.config.maxAccuracyM) return this.deadReckon()
    const timestamp = Date.parse(fix.recordedAt)
    if (
      !Number.isFinite(timestamp) ||
      (this.lastGoodFix && timestamp <= Date.parse(this.lastGoodFix.recordedAt))
    )
      return null
    if (this.lastGoodFix) {
      const seconds = Math.max((timestamp - Date.parse(this.lastGoodFix.recordedAt)) / 1000, 0.1)
      const impliedSpeed = distance(this.lastGoodFix, fix) / seconds
      if (impliedSpeed > 80 && fix.accuracyM > 30) return null
    }

    const lowIndex = Math.max(0, this.cumulative.findIndex((value) => value >= this.progressM) - 3)
    const highProgress = this.progressM + Math.max(1_000, (fix.speedMps ?? 0) * 25)
    let best: {
      segment: number
      progress: number
      offset: number
      point: NavigationCoordinate
      bearing: number
      score: number
    } | null = null
    for (let segment = lowIndex; segment < this.points.length - 1; segment += 1) {
      if (this.cumulative[segment]! > highProgress) break
      const a = this.points[segment]!
      const b = this.points[segment + 1]!
      const meanLat = radians((a.lat + b.lat + fix.lat) / 3)
      const x1 = radians(a.lng - fix.lng) * Math.cos(meanLat) * earthRadiusM
      const y1 = radians(a.lat - fix.lat) * earthRadiusM
      const x2 = radians(b.lng - fix.lng) * Math.cos(meanLat) * earthRadiusM
      const y2 = radians(b.lat - fix.lat) * earthRadiusM
      const dx = x2 - x1
      const dy = y2 - y1
      const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy || 1)))
      const offset = Math.hypot(x1 + t * dx, y1 + t * dy)
      const segmentLength = this.cumulative[segment + 1]! - this.cumulative[segment]!
      const progress = this.cumulative[segment]! + segmentLength * t
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
      const headingPenalty =
        fix.speedMps !== null &&
        fix.speedMps > this.config.headingUsefulSpeedMps &&
        fix.headingDeg !== null
          ? Math.min(Math.abs(((fix.headingDeg - bearing + 540) % 360) - 180), 180) * 0.25
          : 0
      const score = offset + headingPenalty + Math.max(0, this.progressM - progress - 15) * 2
      if (!best || score < best.score)
        best = {
          segment,
          progress,
          offset,
          bearing,
          score,
          point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
        }
    }
    if (!best) return null
    this.progressM = Math.max(this.progressM, best.progress - 10)
    this.lastGoodFix = fix
    this.lastGoodAt = this.now()
    this.lastDeadReckonedAt = this.lastGoodAt
    const offThreshold = Math.max(
      this.config.offRouteMinimumM,
      fix.accuracyM * this.config.offRouteAccuracyMultiplier,
    )
    if (best.offset > offThreshold && (fix.speedMps ?? 0) > this.config.minimumMovingSpeedMps) {
      this.offRouteFixes += 1
      this.onRouteFixes = 0
    } else if (best.offset < Math.max(22, fix.accuracyM)) {
      this.onRouteFixes += 1
      this.offRouteFixes = 0
    }
    let status: NavigationState['status'] =
      this.offRouteFixes >= this.config.offRouteConsecutiveFixes ? 'OFF_ROUTE' : 'ON_ROUTE'
    if (this.onRouteFixes >= this.config.onRouteRecoveryFixes) status = 'ON_ROUTE'
    const remainingDistanceM = Math.max(0, this.route.distanceM - this.progressM)
    const remainingBaseSeconds =
      this.route.durationS * (remainingDistanceM / Math.max(1, this.route.distanceM))
    if (fix.speedMps !== null && fix.speedMps > 2 && this.lastGoodFix) {
      const observedRatio = Math.max(0.6, Math.min(1.6, fix.speedMps / 8))
      this.speedRatio = this.speedRatio * 0.8 + observedRatio * 0.2
    }
    const etaSeconds = Math.round(remainingBaseSeconds / this.speedRatio)
    const steps = this.steps
    const stepIndex = steps.findIndex(
      (step) =>
        this.progressM <=
        this.cumulative[Math.min(step.endShapeIndex, this.cumulative.length - 1)]! + 1,
    )
    const currentStepIndex = Math.max(0, stepIndex < 0 ? steps.length - 1 : stepIndex)
    const maneuverProgress = steps[currentStepIndex]
      ? this.cumulative[
          Math.min(steps[currentStepIndex]!.endShapeIndex, this.cumulative.length - 1)
        ]!
      : this.progressM
    const distanceToNextManeuverM = Math.max(0, maneuverProgress - this.progressM)
    const announcements: NavigationState['announcements'] = []
    const step = steps[currentStepIndex]
    if (step) {
      const speed = Math.max(2, fix.speedMps ?? 8)
      const thresholds: Array<{
        tier: 'ALERT' | 'PRE' | 'NOW'
        distance: number
        text: string | null
      }> = [
        { tier: 'ALERT', distance: Math.max(300, speed * 18), text: step.verbalAlert },
        { tier: 'PRE', distance: Math.max(100, speed * 8), text: step.verbalPre },
        { tier: 'NOW', distance: 30, text: step.verbalPost ?? step.instruction },
      ]
      let selectedTier: (typeof thresholds)[number] | undefined
      for (const threshold of thresholds) {
        const key = `${step.index}:${threshold.tier}`
        if (distanceToNextManeuverM <= threshold.distance && !this.announced.has(key)) {
          this.announced.add(key)
          if (!selectedTier || threshold.distance < selectedTier.distance) selectedTier = threshold
        }
      }
      if (selectedTier?.text)
        announcements.push({
          stepIndex: step.index,
          tier: selectedTier.tier,
          text: selectedTier.text,
        })
    }
    if (
      remainingDistanceM <= this.config.arrivalRadiusM &&
      (fix.speedMps ?? 0) < this.config.arrivalMaximumSpeedMps
    )
      status = 'ARRIVED'
    return {
      status,
      distanceAlongRouteM: this.progressM,
      lateralOffsetM: best.offset,
      snappedPosition: best.point,
      currentStepIndex,
      distanceToNextManeuverM,
      remainingDistanceM,
      etaSeconds,
      confidence: fix.accuracyM <= 30 ? 'HIGH' : 'LOW',
      announcements,
    }
  }

  private deadReckon(): NavigationState | null {
    const fix = this.lastGoodFix
    if (!fix) return null
    const elapsedS = (this.now() - this.lastGoodAt) / 1000
    if (elapsedS > this.config.deadReckonMaxSeconds || fix.speedMps === null || fix.speedMps < 1)
      return null
    const sinceLastEstimateS = (this.now() - this.lastDeadReckonedAt) / 1000
    const steps = this.steps
    const nextStep = steps.find(
      (step) =>
        this.progressM <=
        this.cumulative[Math.min(step.beginShapeIndex, this.cumulative.length - 1)]! + 1,
    )
    const nextTurnM = nextStep
      ? this.cumulative[Math.min(nextStep.endShapeIndex, this.cumulative.length - 1)]!
      : this.route.distanceM
    this.progressM = Math.min(
      nextTurnM,
      this.route.distanceM,
      this.progressM +
        fix.speedMps * Math.min(this.config.deadReckonMaxSeconds, Math.max(0, sinceLastEstimateS)),
    )
    this.lastDeadReckonedAt = this.now()
    const currentStepIndex = Math.max(
      0,
      steps.findIndex(
        (step) =>
          this.progressM <=
          this.cumulative[Math.min(step.endShapeIndex, this.cumulative.length - 1)]! + 1,
      ),
    )
    return {
      status: 'ESTIMATED',
      distanceAlongRouteM: this.progressM,
      lateralOffsetM: 0,
      snappedPosition: fix,
      currentStepIndex,
      distanceToNextManeuverM:
        nextTurnM === this.route.distanceM ? 0 : Math.max(0, nextTurnM - this.progressM),
      remainingDistanceM: Math.max(0, this.route.distanceM - this.progressM),
      etaSeconds: Math.round(
        Math.max(
          0,
          this.route.durationS * (1 - this.progressM / Math.max(1, this.route.distanceM)),
        ),
      ),
      confidence: 'LOW',
      announcements: [],
    }
  }
}
