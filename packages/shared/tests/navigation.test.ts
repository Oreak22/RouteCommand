import { describe, expect, it } from 'vitest'

import { NavigationEngine } from '../src/navigation.js'
import type { NavigationFix, NavigationRoute } from '../src/navigation.js'

function fixture(): NavigationRoute {
  return {
    geometry: {
      type: 'LineString',
      coordinates: [
        [3.38, 6.52],
        [3.385, 6.52],
        [3.39, 6.52],
      ],
    },
    legs: [
      {
        distanceM: 1_100,
        durationS: 500,
        steps: [
          {
            index: 0,
            type: 'START',
            instruction: 'Head east.',
            verbalAlert: 'Continue east.',
            verbalPre: null,
            verbalPost: null,
            streetNames: ['A Street'],
            distanceM: 550,
            durationS: 250,
            beginShapeIndex: 0,
            endShapeIndex: 1,
            bearingBefore: 90,
            bearingAfter: 90,
            roundaboutExit: null,
          },
          {
            index: 1,
            type: 'RIGHT',
            instruction: 'Turn right.',
            verbalAlert: 'Turn right soon.',
            verbalPre: 'Prepare to turn right.',
            verbalPost: 'Turn right now.',
            streetNames: ['B Street'],
            distanceM: 550,
            durationS: 250,
            beginShapeIndex: 1,
            endShapeIndex: 2,
            bearingBefore: 90,
            bearingAfter: 180,
            roundaboutExit: null,
          },
        ],
      },
    ],
    distanceM: 1_100,
    durationS: 500,
    provider: 'fixture',
    crossesRestrictedZone: false,
    degraded: false,
  }
}

function fix(
  lng: number,
  lat: number,
  recordedAt: string,
  extra: Partial<NavigationFix> = {},
): NavigationFix {
  return { lng, lat, accuracyM: 5, speedMps: 8, headingDeg: 90, recordedAt, ...extra }
}

describe('NavigationEngine', () => {
  it('projects fixes to the route and never moves progress backwards', () => {
    const engine = new NavigationEngine(fixture())
    const first = engine.update(fix(3.382, 6.52, '2026-11-18T10:00:00.000Z'))!
    const second = engine.update(fix(3.387, 6.52, '2026-11-18T10:00:05.000Z'))!
    const noisyBacktrack = engine.update(fix(3.384, 6.52, '2026-11-18T10:00:10.000Z'))!

    expect(second.distanceAlongRouteM).toBeGreaterThan(first.distanceAlongRouteM)
    expect(noisyBacktrack.distanceAlongRouteM).toBeGreaterThanOrEqual(second.distanceAlongRouteM)
    expect(noisyBacktrack.lateralOffsetM).toBeLessThan(2)
  })

  it('ignores stale, out-of-order and unusably inaccurate fixes', () => {
    const engine = new NavigationEngine(fixture())
    const accepted = engine.update(fix(3.381, 6.52, '2026-11-18T10:00:10.000Z'))!
    expect(engine.update(fix(3.382, 6.52, '2026-11-18T10:00:09.000Z'))).toBeNull()
    expect(
      engine.update(fix(3.382, 6.52, '2026-11-18T10:00:11.000Z', { accuracyM: 150 })),
    ).toBeNull()
    expect(accepted.distanceAlongRouteM).toBeGreaterThan(0)
  })

  it('requires consecutive good fixes before declaring off route', () => {
    const engine = new NavigationEngine(fixture())
    engine.update(fix(3.381, 6.52, '2026-11-18T10:00:00.000Z'))
    const first = engine.update(fix(3.3815, 6.521, '2026-11-18T10:00:05.000Z'))!
    const second = engine.update(fix(3.382, 6.521, '2026-11-18T10:00:10.000Z'))!
    const third = engine.update(fix(3.3825, 6.521, '2026-11-18T10:00:15.000Z'))!

    expect(first.status).toBe('ON_ROUTE')
    expect(second.status).toBe('ON_ROUTE')
    expect(third.status).toBe('OFF_ROUTE')
  })

  it('announces a maneuver once, then advances the step index', () => {
    const engine = new NavigationEngine(fixture())
    engine.update(fix(3.381, 6.52, '2026-11-18T10:00:00.000Z'))
    const approach = engine.update(fix(3.3849, 6.52, '2026-11-18T10:00:05.000Z'))!
    const repeat = engine.update(fix(3.38495, 6.52, '2026-11-18T10:00:10.000Z'))!

    expect(approach.currentStepIndex).toBe(1)
    expect(approach.announcements.length).toBeGreaterThan(0)
    expect(repeat.announcements).toEqual([])
  })

  it('dead reckons for a short GPS gap and stops before a maneuver', () => {
    let now = Date.parse('2026-11-18T10:00:00.000Z')
    const route = fixture()
    route.legs[0]!.steps[0]!.beginShapeIndex = 0
    route.legs[0]!.steps[0]!.endShapeIndex = 1
    route.legs[0]!.steps[1]!.beginShapeIndex = 1
    const engine = new NavigationEngine(route, () => now)
    engine.update(fix(3.3848, 6.52, '2026-11-18T10:00:00.000Z'))
    now += 3_000
    const estimated = engine.update(
      fix(3.3848, 6.52, '2026-11-18T10:00:01.000Z', { accuracyM: 101 }),
    )!
    expect(estimated.status).toBe('ESTIMATED')
    expect(estimated.distanceAlongRouteM).toBeLessThanOrEqual(560)
    now += 20_000
    expect(
      engine.update(fix(3.3848, 6.52, '2026-11-18T10:00:02.000Z', { accuracyM: 101 })),
    ).toBeNull()
  })

  it('clamps adaptive ETA confidence and marks arrival only at the route end', () => {
    const engine = new NavigationEngine(fixture())
    const state = engine.update(fix(3.38999, 6.52, '2026-11-18T10:00:00.000Z', { speedMps: 0 }))!
    expect(state.status).toBe('ARRIVED')
    expect(state.etaSeconds).toBeGreaterThanOrEqual(0)
    expect(state.confidence).toBe('HIGH')
  })
})
