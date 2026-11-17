import {
  checkZonePointSchema,
  createZoneSchema,
  listZonesQuerySchema,
  updateZoneSchema,
} from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

const validPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [3.3, 6.4],
      [3.4, 6.4],
      [3.4, 6.5],
      [3.3, 6.5],
      [3.3, 6.4],
    ],
  ],
} as const

describe('zone API contracts', () => {
  it('accepts closed Polygon and MultiPolygon GeoJSON with holes', () => {
    expect(
      createZoneSchema.parse({ name: '  Lagos Island ', type: 'DELIVERY', geometry: validPolygon }),
    ).toMatchObject({ name: 'Lagos Island', color: '#168B91' })
    expect(
      createZoneSchema.safeParse({
        name: 'Depot',
        type: 'DEPOT',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              validPolygon.coordinates[0],
              [
                [3.32, 6.42],
                [3.33, 6.42],
                [3.33, 6.43],
                [3.32, 6.42],
              ],
            ],
          ],
        },
      }).success,
    ).toBe(true)
  })

  it('rejects unclosed rings and out-of-range coordinates', () => {
    expect(
      createZoneSchema.safeParse({
        name: 'Bad zone',
        type: 'CUSTOM',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [3, 6],
              [4, 6],
              [4, 7],
              [3, 7],
            ],
          ],
        },
      }).success,
    ).toBe(false)
    expect(
      createZoneSchema.safeParse({
        name: 'Bad zone',
        type: 'CUSTOM',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [181, 6],
              [4, 6],
              [4, 7],
              [181, 6],
            ],
          ],
        },
      }).success,
    ).toBe(false)
  })

  it('requires an optimistic-concurrency timestamp and a changed field', () => {
    const expectedUpdatedAt = '2026-11-16T13:00:00.000Z'
    expect(updateZoneSchema.safeParse({ expectedUpdatedAt }).success).toBe(false)
    expect(updateZoneSchema.safeParse({ expectedUpdatedAt, name: 'Updated zone' }).success).toBe(
      true,
    )
  })

  it('bounds check-point coordinates and defaults zone list pagination', () => {
    expect(checkZonePointSchema.safeParse({ lng: 181, lat: 6 }).success).toBe(false)
    expect(listZonesQuerySchema.parse({}).limit).toBe(100)
    expect(listZonesQuerySchema.safeParse({ active: 'yes' }).success).toBe(false)
  })
})
