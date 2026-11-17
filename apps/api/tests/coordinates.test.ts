import { describe, expect, it } from 'vitest'

import { toLongitudeLatitude } from '../src/db/coordinates.js'

describe('toLongitudeLatitude', () => {
  it('keeps longitude first for PostGIS point construction', () => {
    expect(toLongitudeLatitude({ longitude: 3.3792, latitude: 6.5244 })).toEqual([3.3792, 6.5244])
  })

  it('accepts valid coordinate boundaries', () => {
    expect(toLongitudeLatitude({ longitude: -180, latitude: -90 })).toEqual([-180, -90])
    expect(toLongitudeLatitude({ longitude: 180, latitude: 90 })).toEqual([180, 90])
  })

  it.each([
    [{ longitude: -180.1, latitude: 0 }, 'Longitude'],
    [{ longitude: 180.1, latitude: 0 }, 'Longitude'],
    [{ longitude: 0, latitude: -90.1 }, 'Latitude'],
    [{ longitude: 0, latitude: 90.1 }, 'Latitude'],
    [{ longitude: Number.NaN, latitude: 0 }, 'Longitude'],
    [{ longitude: 0, latitude: Number.POSITIVE_INFINITY }, 'Latitude'],
  ])('rejects invalid coordinate pair %#', (coordinate, axis) => {
    expect(() => toLongitudeLatitude(coordinate)).toThrow(`${axis} must be a finite number`)
  })
})
