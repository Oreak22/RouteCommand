export type LongitudeLatitude = readonly [longitude: number, latitude: number]

export type GeographicCoordinate = {
  longitude: number
  latitude: number
}

/** Return PostGIS/GeoJSON coordinate order: longitude first, latitude second. */
export function toLongitudeLatitude({
  longitude,
  latitude,
}: GeographicCoordinate): LongitudeLatitude {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError('Longitude must be a finite number between -180 and 180.')
  }

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError('Latitude must be a finite number between -90 and 90.')
  }

  return [longitude, latitude]
}
