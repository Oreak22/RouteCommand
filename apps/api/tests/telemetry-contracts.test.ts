import { telemetryBatchSchema } from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

const validFix = {
  lat: 6.5244,
  lng: 3.3792,
  accuracyM: 6.5,
  altitudeM: 12,
  speedMps: 8,
  headingDeg: 90,
  recordedAt: '2026-11-17T12:00:00.000Z',
  batteryPct: 80,
}

describe('telemetry contracts', () => {
  it('accepts named coordinates and optional GNSS metadata', () => {
    expect(telemetryBatchSchema.parse({ points: [validFix] }).points).toHaveLength(1)
  })

  it('rejects Null Island, invalid coordinates, negative accuracy, and invalid heading', () => {
    for (const point of [
      { ...validFix, lat: 0, lng: 0 },
      { ...validFix, lat: 91 },
      { ...validFix, accuracyM: -1 },
      { ...validFix, headingDeg: 360 },
    ]) {
      expect(telemetryBatchSchema.safeParse({ points: [point] }).success).toBe(false)
    }
  })

  it('bounds batches and requires an ISO timestamp with an explicit timezone', () => {
    expect(telemetryBatchSchema.safeParse({ points: [] }).success).toBe(false)
    expect(
      telemetryBatchSchema.safeParse({ points: Array.from({ length: 501 }, () => validFix) })
        .success,
    ).toBe(false)
    expect(
      telemetryBatchSchema.safeParse({
        points: [{ ...validFix, recordedAt: '2026-11-17T12:00:00' }],
      }).success,
    ).toBe(false)
  })
})
