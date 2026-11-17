import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'

import type { ZoneGeometry } from '@routecommand/shared'
import L from 'leaflet'
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useMap } from 'react-leaflet'

import { circleToPolygon } from '../geometry'

type ZoneLayerMetadata = {
  zoneId: string
  updatedAt: string
  polygonIndex: number
  polygonCount: number
}

type ZoneLeafletLayer = L.Layer & {
  feature?: { properties?: Partial<ZoneLayerMetadata> }
  toGeoJSON?: (precision?: number) => GeoJSON.Feature<GeoJSON.Geometry>
}

type ZoneDrawControlProps = {
  featureGroupRef: RefObject<L.FeatureGroup | null>
  canEditGeometry: boolean
  onCreated: (geometry: ZoneGeometry, layer: L.Layer) => void
  onEdited: (zoneId: string, updatedAt: string, geometry: ZoneGeometry) => void
}

function asZoneGeometry(layer: ZoneLeafletLayer): ZoneGeometry | null {
  if (layer instanceof L.Circle) return circleToPolygon(layer)
  const geometry = layer.toGeoJSON?.(6).geometry
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null
  return geometry as ZoneGeometry
}

export function ZoneDrawControl({
  featureGroupRef,
  canEditGeometry,
  onCreated,
  onEdited,
}: ZoneDrawControlProps) {
  const map = useMap()

  useEffect(() => {
    const featureGroup = featureGroupRef.current
    if (!featureGroup) return

    const control = new L.Control.Draw({
      position: 'topright',
      draw: {
        polyline: false,
        polygon: { allowIntersection: false, showArea: true },
        rectangle: {},
        circle: {},
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup,
        ...(canEditGeometry ? {} : { edit: false }),
        remove: false,
      },
    })
    map.addControl(control)

    const created = (rawEvent: L.LeafletEvent) => {
      const event = rawEvent as L.DrawEvents.Created
      const geometry = asZoneGeometry(event.layer as ZoneLeafletLayer)
      if (!geometry) return
      map.addLayer(event.layer)
      onCreated(geometry, event.layer)
    }

    const edited = (rawEvent: L.LeafletEvent) => {
      const event = rawEvent as L.DrawEvents.Edited
      const changedZoneIds = new Set<string>()
      event.layers.eachLayer((rawLayer) => {
        const layer = rawLayer as ZoneLeafletLayer
        const zoneId = layer.feature?.properties?.zoneId
        if (zoneId) changedZoneIds.add(zoneId)
      })

      for (const zoneId of changedZoneIds) {
        const zoneLayers = featureGroup
          .getLayers()
          .map((layer) => layer as ZoneLeafletLayer)
          .filter((layer) => layer.feature?.properties?.zoneId === zoneId)
          .sort(
            (first, second) =>
              (first.feature?.properties?.polygonIndex ?? 0) -
              (second.feature?.properties?.polygonIndex ?? 0),
          )
        const updatedAt = zoneLayers[0]?.feature?.properties?.updatedAt
        const geometries = zoneLayers
          .map((layer) => asZoneGeometry(layer))
          .filter((geometry): geometry is ZoneGeometry => geometry !== null)
          .map((geometry) => (geometry.type === 'Polygon' ? geometry.coordinates : null))

        if (!updatedAt || geometries.length !== zoneLayers.length || geometries.length === 0)
          continue
        if (geometries.length === 1) {
          onEdited(zoneId, updatedAt, { type: 'Polygon', coordinates: geometries[0]! })
        } else {
          onEdited(zoneId, updatedAt, {
            type: 'MultiPolygon',
            coordinates: geometries as NonNullable<(typeof geometries)[number]>[],
          })
        }
      }
    }

    map.on(L.Draw.Event.CREATED, created)
    map.on(L.Draw.Event.EDITED, edited)
    return () => {
      map.off(L.Draw.Event.CREATED, created)
      map.off(L.Draw.Event.EDITED, edited)
      map.removeControl(control)
    }
  }, [canEditGeometry, featureGroupRef, map, onCreated, onEdited])

  return null
}
