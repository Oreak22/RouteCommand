import { zoneTypes } from '@routecommand/shared'
import type { ZoneGeometry } from '@routecommand/shared'
import L from 'leaflet'
import { Crosshair, Pencil, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { FeatureGroup, useMap } from 'react-leaflet'

import { ZoneDrawControl } from './ZoneDrawControl'
import { ZoneForm } from './ZoneForm'
import { Button } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/Checkbox'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { StatusPill } from '../../../components/ui/StatusPill'
import { useToast } from '../../../components/ui/toast-context'
import { MapCanvas } from '../../map/MapCanvas'
import { ZonesLayer } from '../../map/ZonesLayer'
import type { Zone, ZoneFeature } from '../api/client'
import { useDeactivateZone, useUpdateZone, useZoneGeoJson, useZones } from '../api/hooks'
import { getZoneGeometryIssue } from '../geometry'

function toleranceForZoom(zoom: number) {
  if (zoom <= 8) return 1_000
  if (zoom <= 10) return 250
  if (zoom <= 12) return 50
  return 0
}

function MapBridge({
  mapRef,
  onZoomChange,
}: {
  mapRef: RefObject<L.Map | null>
  onZoomChange: (zoom: number) => void
}) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    onZoomChange(map.getZoom())
    const zoomChanged = () => onZoomChange(map.getZoom())
    map.on('zoomend', zoomChanged)
    return () => {
      map.off('zoomend', zoomChanged)
      mapRef.current = null
    }
  }, [map, mapRef, onZoomChange])
  return null
}

export function ZonesWorkspace() {
  const [search, setSearch] = useState('')
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const [editingZone, setEditingZone] = useState<Zone | null>(null)
  const [drawnGeometry, setDrawnGeometry] = useState<ZoneGeometry | null>(null)
  const [drawnLayer, setDrawnLayer] = useState<L.Layer | null>(null)
  const [zoneToDelete, setZoneToDelete] = useState<Zone | null>(null)
  const [zoom, setZoom] = useState(11)
  const mapRef = useRef<L.Map | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const zonesQuery = useZones()
  const toleranceM = toleranceForZoom(zoom)
  const geoJsonQuery = useZoneGeoJson(toleranceM)
  const update = useUpdateZone()
  const deactivate = useDeactivateZone()
  const { pushToast } = useToast()
  const saveZoneUpdate = update.mutateAsync
  const refetchZones = zonesQuery.refetch
  const refetchGeoJson = geoJsonQuery.refetch

  const visibleZones = useMemo(
    () =>
      (zonesQuery.data ?? []).filter((zone) => {
        const term = search.trim().toLowerCase()
        return (
          !term || zone.name.toLowerCase().includes(term) || zone.type.toLowerCase().includes(term)
        )
      }),
    [search, zonesQuery.data],
  )

  const onZoomChange = useCallback((value: number) => setZoom(value), [])

  const onCreated = useCallback((geometry: ZoneGeometry, layer: L.Layer) => {
    setEditingZone(null)
    setDrawnGeometry(geometry)
    setDrawnLayer(layer)
  }, [])

  const onEdited = useCallback(
    (zoneId: string, updatedAt: string, geometry: ZoneGeometry) => {
      const issue = getZoneGeometryIssue(geometry)
      if (issue) {
        pushToast(issue, 'error')
        void refetchZones()
        return
      }
      void saveZoneUpdate({ id: zoneId, input: { expectedUpdatedAt: updatedAt, geometry } })
        .then(() => pushToast('Zone boundary updated.', 'success'))
        .catch((error: unknown) => {
          pushToast(
            error instanceof Error ? error.message : 'Could not update the zone boundary.',
            'error',
          )
          void refetchZones()
          void refetchGeoJson()
        })
    },
    [pushToast, refetchGeoJson, refetchZones, saveZoneUpdate],
  )

  function closeEditor() {
    if (drawnLayer) mapRef.current?.removeLayer(drawnLayer)
    setDrawnLayer(null)
    setEditingZone(null)
    setDrawnGeometry(null)
  }

  function toggleVisibility(zoneId: string) {
    setHiddenIds((previous) => {
      const next = new Set(previous)
      if (next.has(zoneId)) next.delete(zoneId)
      else next.add(zoneId)
      return next
    })
  }

  function flyToZone(zone: Zone) {
    const map = mapRef.current
    if (!map) return
    const bounds = L.geoJSON(zone.geometry as GeoJSON.GeoJsonObject).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 14, padding: [24, 24] })
  }

  async function confirmDeactivate() {
    if (!zoneToDelete) return
    try {
      await deactivate.mutateAsync({
        id: zoneToDelete.id,
        expectedUpdatedAt: zoneToDelete.updatedAt,
      })
      pushToast('Zone deactivated.', 'success')
      setZoneToDelete(null)
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not deactivate the zone.', 'error')
    }
  }

  const allFeatures: ZoneFeature[] = geoJsonQuery.data?.features ?? []

  return (
    <>
      <div className="absolute inset-0">
        <MapCanvas>
          <MapBridge mapRef={mapRef} onZoomChange={onZoomChange} />
          <FeatureGroup ref={featureGroupRef}>
            <ZonesLayer features={allFeatures} hiddenIds={hiddenIds} />
            <ZoneDrawControl
              featureGroupRef={featureGroupRef}
              canEditGeometry={toleranceM === 0 && !geoJsonQuery.isFetching}
              onCreated={onCreated}
              onEdited={onEdited}
            />
          </FeatureGroup>
        </MapCanvas>
      </div>
      <aside className="absolute bottom-3 left-3 right-3 top-auto z-10 flex max-h-[min(48vh,26rem)] flex-col rounded-box border border-base-content/10 bg-base-100/95 shadow-xl backdrop-blur sm:bottom-5 sm:left-6 sm:right-auto sm:top-4 sm:max-h-none sm:w-[min(22rem,calc(100vw-3rem))]">
        <div className="border-b border-base-content/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest">Geofences</p>
              <p className="mt-1 text-xs text-base-content/55">
                Draw and manage operational zones.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 p-2 text-primary">
              <Crosshair className="size-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-3 text-xs text-base-content/60">
            Use the map toolbar to draw a polygon, rectangle, or circle. Circles are saved as
            polygon boundaries.
          </p>
          {toleranceM > 0 && (
            <p className="mt-2 text-xs text-warning">
              Zoom in to edit detailed boundaries. Low-zoom outlines are simplified for display.
            </p>
          )}
        </div>
        <div className="border-b border-base-content/10 p-3">
          <FormField label="Search zones">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-base-content/40"
                aria-hidden="true"
              />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or type"
              />
            </div>
          </FormField>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {zonesQuery.isError || geoJsonQuery.isError ? (
            <ErrorState
              title="Zones could not be loaded"
              description="Check the API connection and retry."
              onRetry={() => {
                void zonesQuery.refetch()
                void geoJsonQuery.refetch()
              }}
            />
          ) : zonesQuery.isPending || geoJsonQuery.isPending ? (
            <p className="py-8 text-center text-sm text-base-content/60" role="status">
              Loading zones…
            </p>
          ) : visibleZones.length === 0 ? (
            <EmptyState
              title={search ? 'No matching zones' : 'No zones yet'}
              description={
                search
                  ? 'Try a different name or zone type.'
                  : 'Draw a boundary with the map toolbar to create the first zone.'
              }
            />
          ) : (
            <ul className="space-y-2" aria-label="Zones">
              {visibleZones.map((zone) => (
                <li key={zone.id} className="rounded-field border border-base-content/10 p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={!hiddenIds.has(zone.id)}
                      disabled={!zone.isActive}
                      aria-label={`${hiddenIds.has(zone.id) ? 'Show' : 'Hide'} ${zone.name} on map`}
                      onChange={() => toggleVisibility(zone.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{zone.name}</p>
                        <span
                          className="size-3 shrink-0 rounded-full ring-1 ring-base-content/15"
                          style={{ backgroundColor: zone.color }}
                          aria-label={`${zone.name} colour`}
                        />
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusPill category="zone" status={zone.type} />
                        {!zone.isActive && (
                          <span className="text-xs text-base-content/45">Inactive</span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => flyToZone(zone)}
                          aria-label={`Fly to ${zone.name}`}
                        >
                          <Crosshair className="size-3.5" aria-hidden="true" />
                          Locate
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingZone(zone)
                            setDrawnGeometry(null)
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Edit
                        </Button>
                        {zone.isActive && (
                          <Button size="sm" variant="ghost" onClick={() => setZoneToDelete(zone)}>
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-base-content/10 p-3">
          <div className="flex items-center justify-between gap-3 text-xs text-base-content/60">
            <span>{visibleZones.filter((zone) => zone.isActive).length} active in list</span>
            <span>{zoneTypes.length} zone types</span>
          </div>
        </div>
      </aside>
      <ZoneForm
        key={
          editingZone
            ? `${editingZone.id}-${editingZone.updatedAt}`
            : drawnGeometry
              ? JSON.stringify(drawnGeometry)
              : 'new-zone'
        }
        zone={editingZone}
        geometry={drawnGeometry}
        open={editingZone !== null || drawnGeometry !== null}
        onClose={closeEditor}
      />
      <ConfirmDialog
        open={zoneToDelete !== null}
        title="Deactivate zone?"
        message={`${zoneToDelete?.name ?? 'This zone'} will be removed from active geofence results but retained for historical references.`}
        confirmLabel="Deactivate zone"
        busy={deactivate.isPending}
        onConfirm={() => void confirmDeactivate()}
        onCancel={() => setZoneToDelete(null)}
      />
    </>
  )
}
