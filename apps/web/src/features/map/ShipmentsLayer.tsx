import L from 'leaflet'
import { Fragment, useMemo } from 'react'
import { Marker, Polyline, Tooltip } from 'react-leaflet'

import { useLivePosition } from '../realtime/store/live-position-store'
import type { Shipment } from '../shipments/api/client'

function shipmentIcon(kind: 'P' | 'D', selected: boolean) {
  return L.divIcon({
    className: 'shipment-map-icon-shell',
    html: `<span class="shipment-map-icon ${selected ? 'is-selected' : ''}">${kind}</span>`,
    iconSize: [24, 30],
    iconAnchor: [12, 26],
  })
}

export function ShipmentsLayer({
  shipments,
  selectedShipmentId,
  onSelect,
  selectedDriverId,
}: {
  shipments: Shipment[]
  selectedShipmentId: string | null
  onSelect: (shipmentId: string) => void
  selectedDriverId: string | null
}) {
  const visible = useMemo(
    () =>
      shipments.filter(
        (shipment) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(shipment.status),
      ),
    [shipments],
  )
  const selected = visible.find((shipment) => shipment.id === selectedShipmentId)

  return (
    <>
      {visible.map((shipment) => {
        const isSelected = shipment.id === selectedShipmentId
        return (
          <Fragment key={shipment.id}>
            <Marker
              position={[shipment.pickup.lat, shipment.pickup.lng]}
              icon={shipmentIcon('P', isSelected)}
              eventHandlers={{ click: () => onSelect(shipment.id) }}
            >
              <Tooltip>Pickup · {shipment.trackingCode}</Tooltip>
            </Marker>
            <Marker
              position={[shipment.dropoff.lat, shipment.dropoff.lng]}
              icon={shipmentIcon('D', isSelected)}
              eventHandlers={{ click: () => onSelect(shipment.id) }}
            >
              <Tooltip>Dropoff · {shipment.trackingCode}</Tooltip>
            </Marker>
          </Fragment>
        )
      })}
      {selected && selectedDriverId && (
        <ShipmentStraightLine shipment={selected} driverId={selectedDriverId} />
      )}
    </>
  )
}

function ShipmentStraightLine({ shipment, driverId }: { shipment: Shipment; driverId: string }) {
  const position = useLivePosition(driverId)
  if (!position) return null
  return (
    <Polyline
      positions={[
        [position.lat, position.lng],
        [shipment.dropoff.lat, shipment.dropoff.lng],
      ]}
      pathOptions={{
        color: 'var(--color-primary)',
        weight: 3,
        dashArray: '8 7',
        opacity: 0.8,
      }}
    />
  )
}
