import { Circle, CircleMarker, Popup } from 'react-leaflet'

import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Skeleton } from '../components/ui/Skeleton'
import { useDriverMe } from '../features/drivers/api/hooks'
import { MapCanvas } from '../features/map/MapCanvas'
import { ZonesLayer } from '../features/map/ZonesLayer'
import { useDriverTelemetry } from '../features/telemetry/DriverTelemetryProvider'
import { useZoneGeoJson } from '../features/zones/api/hooks'

export function DriverMapPage() {
  const driverQuery = useDriverMe()
  const zonesQuery = useZoneGeoJson()
  const tracker = useDriverTelemetry()
  const driver = driverQuery.data
  const location = tracker.lastFix
    ? { lat: tracker.lastFix.lat, lng: tracker.lastFix.lng, accuracyM: tracker.lastFix.accuracyM }
    : driver?.lat !== null &&
        driver?.lat !== undefined &&
        driver?.lng !== null &&
        driver?.lng !== undefined
      ? { lat: driver.lat, lng: driver.lng, accuracyM: null }
      : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Map</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Your live or last reported position and active operating zones.
        </p>
      </div>

      {driverQuery.isError ? (
        <ErrorState
          title="Your map could not be loaded"
          description="Check your connection and try again."
          onRetry={() => void driverQuery.refetch()}
        />
      ) : driverQuery.isPending ? (
        <Skeleton className="h-[55vh] min-h-80 w-full" />
      ) : !location ? (
        <Card>
          <EmptyState
            title="No location has been reported yet"
            description="Start location sharing from Jobs to show your position here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="h-[55vh] min-h-80">
            <MapCanvas center={[location.lat, location.lng]}>
              <ZonesLayer features={zonesQuery.data?.features ?? []} hiddenIds={new Set()} />
              {location.accuracyM !== null && location.accuracyM <= 500 && (
                <Circle
                  center={[location.lat, location.lng]}
                  radius={location.accuracyM}
                  pathOptions={{ color: 'var(--color-primary)', fillOpacity: 0.12, weight: 1 }}
                />
              )}
              <CircleMarker
                center={[location.lat, location.lng]}
                radius={11}
                pathOptions={{
                  color: 'var(--color-base-100)',
                  weight: 3,
                  fillColor: 'var(--color-primary)',
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  <strong>
                    {tracker.lastFix ? 'Your live position' : 'Your last reported position'}
                  </strong>
                  {!tracker.lastFix && driver?.lastSeenAt && (
                    <div>Updated {new Date(driver.lastSeenAt).toLocaleString()}</div>
                  )}
                  {tracker.lastFix && <div>Accuracy ±{Math.round(location.accuracyM!)} m</div>}
                </Popup>
              </CircleMarker>
            </MapCanvas>
          </div>
          {zonesQuery.isError && (
            <p
              className="border-t border-base-content/10 px-4 py-3 text-sm text-warning"
              role="status"
            >
              Operating zones could not be loaded. Your position is still shown.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
