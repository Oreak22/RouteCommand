import { CircleMarker, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import { useEffect, useMemo } from 'react'

import { MapCanvas } from '../../map/MapCanvas'
import type { PublicTrackingResponse } from '@routecommand/shared'

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
  const dropoff = tracking.dropoff
    ? ([tracking.dropoff.lat, tracking.dropoff.lng] as [number, number])
    : null
  const driver = tracking.location
    ? ([tracking.location.lat, tracking.location.lng] as [number, number])
    : null
  const points = useMemo(
    () => [driver, dropoff].filter((point): point is [number, number] => point !== null),
    [tracking.location?.lat, tracking.location?.lng, tracking.dropoff?.lat, tracking.dropoff?.lng],
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
