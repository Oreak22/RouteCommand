import type { ZoneGeometry } from '@routecommand/shared'
import { zoneGeometrySchema } from '@routecommand/shared'
import type L from 'leaflet'

export function toLeafletPosition(position: readonly [number, number]): L.LatLngTuple {
  const [longitude, latitude] = position
  return [latitude, longitude]
}

function orientation(
  first: readonly [number, number],
  second: readonly [number, number],
  third: readonly [number, number],
) {
  return (
    (second[1] - first[1]) * (third[0] - second[0]) -
    (second[0] - first[0]) * (third[1] - second[1])
  )
}

function segmentsIntersect(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
) {
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)
  return first * second < 0 && third * fourth < 0
}

export function getZoneGeometryIssue(geometry: ZoneGeometry): string | null {
  const parsed = zoneGeometrySchema.safeParse(geometry)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Check the zone boundary.'

  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const rings of polygons) {
    for (const ring of rings) {
      const segmentCount = ring.length - 1
      for (let first = 0; first < segmentCount; first += 1) {
        for (let second = first + 1; second < segmentCount; second += 1) {
          if (second === first + 1 || (first === 0 && second === segmentCount - 1)) continue
          if (segmentsIntersect(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!)) {
            return 'This boundary crosses itself. Move the intersecting points before saving.'
          }
        }
      }
    }
  }
  return null
}

export function circleToPolygon(circle: L.Circle, steps = 64): ZoneGeometry {
  const center = circle.getLatLng()
  const angularRadius = circle.getRadius() / 6_371_008.8
  const centerLatitude = (center.lat * Math.PI) / 180
  const centerLongitude = (center.lng * Math.PI) / 180
  const ring: [number, number][] = []

  for (let step = 0; step < steps; step += 1) {
    const bearing = (step * 2 * Math.PI) / steps
    const latitude = Math.asin(
      Math.sin(centerLatitude) * Math.cos(angularRadius) +
        Math.cos(centerLatitude) * Math.sin(angularRadius) * Math.cos(bearing),
    )
    const longitude =
      centerLongitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(centerLatitude),
        Math.cos(angularRadius) - Math.sin(centerLatitude) * Math.sin(latitude),
      )
    const longitudeDegrees = (((longitude * 180) / Math.PI + 540) % 360) - 180
    ring.push([longitudeDegrees, (latitude * 180) / Math.PI])
  }
  ring.push(ring[0]!)
  return { type: 'Polygon', coordinates: [ring] }
}
