import { describe, expect, it } from 'vitest'

import { getZoneGeometryIssue, toLeafletPosition } from './geometry'

describe('zone map geometry helpers', () => {
  it('converts GeoJSON longitude/latitude to Leaflet latitude/longitude', () => {
    expect(toLeafletPosition([3.4, 6.5])).toEqual([6.5, 3.4])
  })

  it('reports an unclosed ring before it reaches the API', () => {
    expect(
      getZoneGeometryIssue({
        type: 'Polygon',
        coordinates: [
          [
            [3, 6],
            [4, 6],
            [4, 7],
            [3, 7],
          ],
        ],
      }),
    ).toMatch(/closed/i)
  })

  it('warns when a boundary crosses itself', () => {
    expect(
      getZoneGeometryIssue({
        type: 'Polygon',
        coordinates: [
          [
            [3, 6],
            [4, 7],
            [3, 7],
            [4, 6],
            [3, 6],
          ],
        ],
      }),
    ).toMatch(/crosses itself/i)
  })

  it('accepts valid polygon rings with holes', () => {
    expect(
      getZoneGeometryIssue({
        type: 'Polygon',
        coordinates: [
          [
            [3, 6],
            [4, 6],
            [4, 7],
            [3, 7],
            [3, 6],
          ],
          [
            [3.2, 6.2],
            [3.3, 6.2],
            [3.3, 6.3],
            [3.2, 6.3],
            [3.2, 6.2],
          ],
        ],
      }),
    ).toBeNull()
  })
})
