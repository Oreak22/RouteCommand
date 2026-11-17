import { describe, expect, it } from 'vitest'

import { HaversineEtaEstimator } from '../src/modules/shipments/eta-estimator.js'

describe('HaversineEtaEstimator', () => {
  const estimator = new HaversineEtaEstimator()

  it('returns an ETA at the supplied time for coincident points', () => {
    const now = new Date('2026-11-17T12:00:00.000Z')
    expect(
      estimator.estimate({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 }, now).toISOString(),
    ).toBe(now.toISOString())
  })

  it('returns a later ETA for separated locations and is symmetric', () => {
    const now = new Date('2026-11-17T12:00:00.000Z')
    const pickup = { lat: 6.5244, lng: 3.3792 }
    const dropoff = { lat: 6.4474, lng: 3.3903 }
    const forward = estimator.estimate(pickup, dropoff, now)
    const reverse = estimator.estimate(dropoff, pickup, now)
    expect(forward.getTime()).toBeGreaterThan(now.getTime())
    expect(forward.getTime()).toBe(reverse.getTime())
  })
})
