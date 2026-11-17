import type L from 'leaflet'
import { Polygon, Tooltip } from 'react-leaflet'

import type { ZoneFeature } from '../zones/api/client'
import { toLeafletPosition } from '../zones/geometry'

type ZonePolygonMetadata = {
  zoneId: string
  updatedAt: string
  polygonIndex: number
  polygonCount: number
}

type ZonePolygonLayer = L.Polygon & {
  feature?: {
    type: 'Feature'
    properties: ZonePolygonMetadata
    geometry: { type: 'Polygon'; coordinates: [number, number][][] }
  }
}

function polygonCoordinates(feature: ZoneFeature) {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
}

export function ZonesLayer({
  features,
  hiddenIds,
}: {
  features: ZoneFeature[]
  hiddenIds: Set<string>
}) {
  return (
    <>
      {features
        .filter((feature) => !hiddenIds.has(feature.id))
        .flatMap((feature) => {
          const polygons = polygonCoordinates(feature)
          return polygons.map((rings, polygonIndex) => {
            const positions = rings.map((ring) => ring.map(toLeafletPosition))
            const metadata = {
              zoneId: feature.id,
              updatedAt: feature.properties.updatedAt,
              polygonIndex,
              polygonCount: polygons.length,
            }
            return (
              <Polygon
                key={`${feature.id}-${polygonIndex}-${feature.properties.updatedAt}`}
                positions={positions}
                pathOptions={{
                  color: feature.properties.color,
                  fillColor: feature.properties.color,
                  fillOpacity: 0.18,
                  opacity: 0.9,
                  weight: 2,
                }}
                ref={(layer: L.Polygon | null) => {
                  if (!layer) return
                  const polygon = layer as ZonePolygonLayer
                  polygon.feature = {
                    type: 'Feature',
                    properties: metadata,
                    geometry: { type: 'Polygon', coordinates: rings as [number, number][][] },
                  }
                }}
                eventHandlers={{
                  mouseover: (event: L.LeafletMouseEvent) => {
                    ;(event.target as L.Path).setStyle({ weight: 4, fillOpacity: 0.28 })
                  },
                  mouseout: (event: L.LeafletMouseEvent) => {
                    ;(event.target as L.Path).setStyle({ weight: 2, fillOpacity: 0.18 })
                  },
                }}
              >
                <Tooltip sticky>
                  <span className="font-medium">{feature.properties.name}</span>
                  <span> · {feature.properties.type.toLowerCase()}</span>
                </Tooltip>
              </Polygon>
            )
          })
        })}
    </>
  )
}
