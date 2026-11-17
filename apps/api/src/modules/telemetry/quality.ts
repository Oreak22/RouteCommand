import type { TelemetryPointInput, VehicleType } from '@routecommand/shared'

import { env } from '../../config/env.js'

export interface LatestTelemetryPosition {
  lat: number
  lng: number
  accuracyM: number
  recordedAt: string
}

export type TelemetryFilterReason =
  | 'LOW_ACCURACY'
  | 'IMPLAUSIBLE_SPEED'
  | 'OUT_OF_ORDER'
  | 'IMPOSSIBLE_JUMP'
  | 'STATIONARY_NOISE'
  | 'STALE_FIX'

export interface TelemetryQualityResult {
  isFiltered: boolean
  reasons: TelemetryFilterReason[]
  canUpdateLivePosition: boolean
}

const earthRadiusM = 6_371_008.8

export function distanceBetweenPointsM(
  first: Pick<TelemetryPointInput, 'lat' | 'lng'>,
  second: Pick<TelemetryPointInput, 'lat' | 'lng'>,
): number {
  const radians = Math.PI / 180
  const lat1 = first.lat * radians
  const lat2 = second.lat * radians
  const deltaLat = (second.lat - first.lat) * radians
  const deltaLng = (second.lng - first.lng) * radians
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * earthRadiusM * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

export function maximumSpeedForVehicle(type: VehicleType | null): number {
  if (!type) {
    return Math.max(
      env.TELEMETRY_MAX_SPEED_BIKE_MPS,
      env.TELEMETRY_MAX_SPEED_CAR_MPS,
      env.TELEMETRY_MAX_SPEED_VAN_MPS,
      env.TELEMETRY_MAX_SPEED_TRUCK_MPS,
    )
  }
  switch (type) {
    case 'BIKE':
      return env.TELEMETRY_MAX_SPEED_BIKE_MPS
    case 'CAR':
      return env.TELEMETRY_MAX_SPEED_CAR_MPS
    case 'VAN':
      return env.TELEMETRY_MAX_SPEED_VAN_MPS
    case 'TRUCK':
      return env.TELEMETRY_MAX_SPEED_TRUCK_MPS
  }
}

export function timestampIsOutsideAcceptedWindow(
  recordedAt: string,
  now: Date,
): 'TOO_OLD' | 'TOO_FAR_IN_FUTURE' | null {
  const timestamp = Date.parse(recordedAt)
  const ageMs = now.getTime() - timestamp
  const maximumAgeMs = env.TELEMETRY_MAX_AGE_HOURS * 60 * 60 * 1_000
  const maximumFutureMs = env.TELEMETRY_FUTURE_SKEW_SECONDS * 1_000
  if (ageMs > maximumAgeMs) return 'TOO_OLD'
  if (ageMs < -maximumFutureMs) return 'TOO_FAR_IN_FUTURE'
  return null
}

export function assessTelemetryQuality(
  point: TelemetryPointInput,
  vehicleType: VehicleType | null,
  previous: LatestTelemetryPosition | null,
  now = new Date(),
): TelemetryQualityResult {
  const reasons: TelemetryFilterReason[] = []
  const maxSpeed = maximumSpeedForVehicle(vehicleType)

  if (point.accuracyM > env.MAX_ACCURACY_M) reasons.push('LOW_ACCURACY')
  if (point.speedMps != null && point.speedMps > maxSpeed) reasons.push('IMPLAUSIBLE_SPEED')
  if (now.getTime() - Date.parse(point.recordedAt) > env.DRIVER_SIGNAL_STALE_SECONDS * 1_000) {
    reasons.push('STALE_FIX')
  }

  if (previous) {
    const pointTime = Date.parse(point.recordedAt)
    const previousTime = Date.parse(previous.recordedAt)
    if (pointTime <= previousTime) {
      reasons.push('OUT_OF_ORDER')
    } else {
      const distanceM = distanceBetweenPointsM(point, previous)
      const elapsedSeconds = (pointTime - previousTime) / 1_000
      if (distanceM / elapsedSeconds > maxSpeed) reasons.push('IMPOSSIBLE_JUMP')
      if (
        (point.speedMps ?? 0) <= 0.5 &&
        distanceM <= Math.max(point.accuracyM, previous.accuracyM)
      ) {
        reasons.push('STATIONARY_NOISE')
      }
    }
  }

  return {
    isFiltered: reasons.length > 0,
    reasons,
    canUpdateLivePosition: reasons.length === 0,
  }
}
