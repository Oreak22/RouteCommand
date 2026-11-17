export type Coordinate = { lat: number; lng: number }

export interface EtaEstimator {
  estimate(pickup: Coordinate, dropoff: Coordinate, now?: Date): Date
}

const earthRadiusMeters = 6_371_000
const averageUrbanSpeedMetersPerSecond = 8

function haversineDistanceMeters(first: Coordinate, second: Coordinate): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(second.lat - first.lat)
  const longitudeDelta = radians(second.lng - first.lng)
  const firstLatitude = radians(first.lat)
  const secondLatitude = radians(second.lat)
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export class HaversineEtaEstimator implements EtaEstimator {
  estimate(pickup: Coordinate, dropoff: Coordinate, now = new Date()): Date {
    const durationMs =
      (haversineDistanceMeters(pickup, dropoff) / averageUrbanSpeedMetersPerSecond) * 1_000
    return new Date(now.getTime() + durationMs)
  }
}

export const etaEstimator: EtaEstimator = new HaversineEtaEstimator()
