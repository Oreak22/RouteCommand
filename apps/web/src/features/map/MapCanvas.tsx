import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import type { LatLngExpression } from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { ReactNode } from 'react'
import { LayersControl, MapContainer, ScaleControl, TileLayer } from 'react-leaflet'

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: string })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const demoCenter: LatLngExpression = [6.5244, 3.3792]
const satelliteTileUrl =
  import.meta.env.VITE_SATELLITE_TILE_URL ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const satelliteAttribution =
  'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
const streetAttribution =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function MapCanvas({ children }: { children?: ReactNode }) {
  return (
    <MapContainer center={demoCenter} zoom={11} scrollWheelZoom className="z-0 h-full w-full">
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satellite imagery">
          <TileLayer attribution={satelliteAttribution} url={satelliteTileUrl} maxZoom={19} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Street map">
          <TileLayer
            attribution={streetAttribution}
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>
      <ScaleControl position="bottomleft" imperial={false} />
      {children}
    </MapContainer>
  )
}
