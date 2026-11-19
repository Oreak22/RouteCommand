import type { PublicTrackingResponse } from '@routecommand/shared'
import { useEffect, useMemo } from 'react'
import { CircleMarker, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'

import { MapCanvas } from '../../map/MapCanvas'

function FitTrackingPoints({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView(points[0]!, 14)
    else map.fitBounds(points, { padding: [36, 36], maxZoom: 15 })
  }, [map, points])
  return null
}

export function TrackingMap({ tracking }: { tracking: PublicTrackingResponse }) {
  const dropoffLat = tracking.dropoff?.lat ?? null
  const dropoffLng = tracking.dropoff?.lng ?? null
  const driverLat = tracking.location?.lat ?? null
  const driverLng = tracking.location?.lng ?? null
  const dropoff = useMemo<[number, number] | null>(
    () => (dropoffLat === null || dropoffLng === null ? null : [dropoffLat, dropoffLng]),
    [dropoffLat, dropoffLng],
  )
  const driver = useMemo<[number, number] | null>(
    () => (driverLat === null || driverLng === null ? null : [driverLat, driverLng]),
    [driverLat, driverLng],
  )
  const points = useMemo(
    () => [driver, dropoff].filter((point): point is [number, number] => point !== null),
    [driver, dropoff],
  )

  return (
    <div className="h-72 overflow-hidden rounded-box border border-base-content/10 sm:h-96">
      <MapCanvas>
        <FitTrackingPoints points={points} />
        {driver && (
          <CircleMarker
            center={driver}
            radius={10}
            pathOptions={{ color: 'var(--color-primary)', fillOpacity: 0.85 }}
          >
            <Tooltip>Approximate driver location</Tooltip>
          </CircleMarker>
        )}
        {dropoff && (
          <Marker position={dropoff}>
            <Tooltip>Approximate delivery area</Tooltip>
          </Marker>
        )}
        {driver && dropoff && (
          <Polyline
            positions={[driver, dropoff]}
            pathOptions={{
              color: 'var(--color-primary)',
              dashArray: '7 8',
              weight: 4,
              opacity: 0.8,
            }}
          />
        )}
      </MapCanvas>
    </div>
  )
}
