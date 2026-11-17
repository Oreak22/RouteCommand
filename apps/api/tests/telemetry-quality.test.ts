import type { TelemetryPointInput } from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

import {
  assessTelemetryQuality,
  distanceBetweenPointsM,
  maximumSpeedForVehicle,
  timestampIsOutsideAcceptedWindow,
} from '../src/modules/telemetry/quality.js'

const point = (overrides: Partial<TelemetryPointInput> = {}): TelemetryPointInput => ({
  lat: 6.5244,
  lng: 3.3792,
  accuracyM: 8,
  speedMps: 5,
  headingDeg: 90,
  recordedAt: '2026-11-17T12:00:00.000Z',
  ...overrides,
})

describe('telemetry quality filters', () => {
  it('flags low accuracy and vehicle-specific implausible speed for history only', () => {
    const result = assessTelemetryQuality(
      point({ accuracyM: 150, speedMps: 31 }),
      'BIKE',
      null,
      new Date('2026-11-17T12:00:00.000Z'),
    )
    expect(maximumSpeedForVehicle('BIKE')).toBe(30)
    expect(result.reasons).toEqual(['LOW_ACCURACY', 'IMPLAUSIBLE_SPEED'])
    expect(result.canUpdateLivePosition).toBe(false)
  })

  it('rejects out-of-order fixes from live position while retaining them as filtered history', () => {
    const previous = {
      lat: 6.5244,
      lng: 3.3792,
      accuracyM: 10,
      recordedAt: '2026-11-17T12:00:05.000Z',
    }
    const result = assessTelemetryQuality(point(), 'CAR', previous)
    expect(result.reasons).toContain('OUT_OF_ORDER')
    expect(result.canUpdateLivePosition).toBe(false)
  })

  it('filters impossible jumps and stationary jitter inside the accuracy radius', () => {
    const previous = {
      lat: 6.5244,
      lng: 3.3792,
      accuracyM: 10,
      recordedAt: '2026-11-17T12:00:00.000Z',
    }
    const jump = assessTelemetryQuality(
      point({ lat: 6.6, recordedAt: '2026-11-17T12:00:01.000Z' }),
      'CAR',
      previous,
    )
    expect(jump.reasons).toContain('IMPOSSIBLE_JUMP')

    const jitter = assessTelemetryQuality(
      point({ speedMps: 0, accuracyM: 20, recordedAt: '2026-11-17T12:00:01.000Z' }),
      'CAR',
      previous,
    )
    expect(jitter.reasons).toContain('STATIONARY_NOISE')
  })

  it('calculates geodesic displacement and enforces the accepted timestamp window', () => {
    expect(distanceBetweenPointsM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -2)
    const now = new Date('2026-11-17T12:00:00.000Z')
    expect(timestampIsOutsideAcceptedWindow('2026-11-17T11:59:00.000Z', now)).toBeNull()
    expect(timestampIsOutsideAcceptedWindow('2026-11-10T00:00:00.000Z', now)).toBe('TOO_OLD')
    expect(timestampIsOutsideAcceptedWindow('2026-11-17T12:03:00.000Z', now)).toBe(
      'TOO_FAR_IN_FUTURE',
    )
  })
})
