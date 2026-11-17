import type { LatLngExpression } from 'leaflet'
import { MapPin } from 'lucide-react'
import { Marker, useMapEvents } from 'react-leaflet'

import { MapCanvas } from '../../map/MapCanvas'

type Point = { lat: number; lng: number } | null

function PointSelection({ onSelect }: { onSelect: (point: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(event) {
      onSelect({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

function markerPosition(point: Point): LatLngExpression | null {
  return point ? [point.lat, point.lng] : null
}

export function LocationPicker({
  pickup,
  dropoff,
  activePoint,
  onActivePointChange,
  onSelect,
}: {
  pickup: Point
  dropoff: Point
  activePoint: 'pickup' | 'dropoff'
  onActivePointChange: (point: 'pickup' | 'dropoff') => void
  onSelect: (point: 'pickup' | 'dropoff', value: { lat: number; lng: number }) => void
}) {
  const pickupPosition = markerPosition(pickup)
  const dropoffPosition = markerPosition(dropoff)

  return (
    <section className="space-y-3" aria-label="Shipment locations">
      <div className="join w-full">
        <button
          type="button"
          className={`btn join-item flex-1 ${activePoint === 'pickup' ? 'btn-primary' : 'btn-outline'}`}
          aria-pressed={activePoint === 'pickup'}
          onClick={() => onActivePointChange('pickup')}
        >
          <MapPin className="size-4" aria-hidden="true" />
          Set pickup
        </button>
        <button
          type="button"
          className={`btn join-item flex-1 ${activePoint === 'dropoff' ? 'btn-primary' : 'btn-outline'}`}
          aria-pressed={activePoint === 'dropoff'}
          onClick={() => onActivePointChange('dropoff')}
        >
          <MapPin className="size-4" aria-hidden="true" />
          Set dropoff
        </button>
      </div>
      <p className="text-xs text-base-content/60">Click the map to place the selected location.</p>
      <div className="h-56 overflow-hidden rounded-box border border-base-content/10">
        <MapCanvas>
          <PointSelection onSelect={(point) => onSelect(activePoint, point)} />
          {pickupPosition && <Marker position={pickupPosition} alt="Pickup location" />}
          {dropoffPosition && <Marker position={dropoffPosition} alt="Dropoff location" />}
        </MapCanvas>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <p className="rounded-field bg-base-200 p-2">
          Pickup: {pickup ? `${pickup.lat.toFixed(5)}, ${pickup.lng.toFixed(5)}` : 'Not set'}
        </p>
        <p className="rounded-field bg-base-200 p-2">
          Dropoff: {dropoff ? `${dropoff.lat.toFixed(5)}, ${dropoff.lng.toFixed(5)}` : 'Not set'}
        </p>
      </div>
    </section>
  )
}
