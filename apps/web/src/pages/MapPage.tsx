import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import {
  Activity,
  Crosshair,
  ExternalLink,
  LocateFixed,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Ruler,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Polyline, useMap } from 'react-leaflet'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { StatusPill } from '../components/ui/StatusPill'
import { useAlerts, useAlertStats } from '../features/alerts/api/hooks'
import type { Driver } from '../features/drivers/api/client'
import { useAllDrivers } from '../features/drivers/api/hooks'
import { DriversLayer } from '../features/map/DriversLayer'
import { MapCanvas } from '../features/map/MapCanvas'
import { ShipmentsLayer } from '../features/map/ShipmentsLayer'
import { ZonesLayer } from '../features/map/ZonesLayer'
import { navigationApi } from '../features/navigation/api/client'
import type { NavigationSession } from '../features/navigation/api/client'
import { RealtimeConnectionBanner } from '../features/realtime/RealtimeConnectionBanner'
import {
  useLivePosition,
  useLivePositionStore,
} from '../features/realtime/store/live-position-store'
import { useSocketEvent } from '../features/realtime/useRealtime'
import { useRealtime } from '../features/realtime/useRealtime'
import type { Shipment } from '../features/shipments/api/client'
import { useShipments } from '../features/shipments/api/hooks'
import type { ZoneFeature } from '../features/zones/api/client'
import { useZoneGeoJson, useZones } from '../features/zones/api/hooks'

type MapListTab = 'drivers' | 'shipments'
type Coordinate = { lat: number; lng: number }
const EMPTY_DRIVERS: Driver[] = []
const EMPTY_SHIPMENTS: Shipment[] = []
const EMPTY_ZONE_FEATURES: ZoneFeature[] = []

function persistentPanel(key: string, initial: boolean): boolean {
  try {
    const saved = localStorage.getItem(`routecommand-map-${key}`)
    return saved === null ? initial : saved === 'open'
  } catch {
    return initial
  }
}

function inRing(point: Coordinate, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] ?? []
    const [xj, yj] = ring[j] ?? []
    if (yi === undefined || yj === undefined || xi === undefined || xj === undefined) continue
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function pointInZone(point: Coordinate, feature: ZoneFeature): boolean {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates
  return polygons.some((polygon) => {
    const [outer, ...holes] = polygon
    return Boolean(outer && inRing(point, outer)) && !holes.some((hole) => inRing(point, hole))
  })
}

function makeBenchmarkDrivers(count: number): Driver[] {
  const statuses: Driver['status'][] = ['AVAILABLE', 'BUSY', 'ON_BREAK', 'OFFLINE']
  const vehicleTypes = ['BIKE', 'CAR', 'VAN', 'TRUCK']
  const createdAt = new Date().toISOString()
  return Array.from({ length: count }, (_, index) => {
    const id = `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    const angle = index * 2.399963229728653
    const distanceM = 250 + (index % 20) * 700
    return {
      id,
      userId: id,
      name: `Benchmark Driver ${String(index + 1).padStart(3, '0')}`,
      email: `benchmark-${index + 1}@routecommand.local`,
      phone: null,
      isActive: true,
      licenseNo: `BENCH-${String(index + 1).padStart(4, '0')}`,
      status: statuses[index % statuses.length]!,
      statusChangedAt: createdAt,
      rating: 4.8,
      vehicleId: null,
      vehiclePlate: `BEN-${String(index + 1).padStart(4, '0')}`,
      vehicleType: vehicleTypes[index % vehicleTypes.length]!,
      lat: 6.5244 + (Math.sin(angle) * distanceM) / 111_320,
      lng: 3.3792 + (Math.cos(angle) * distanceM) / (111_320 * Math.cos((6.5244 * Math.PI) / 180)),
      lastSeenAt: createdAt,
      signalState: 'LIVE',
    }
  })
}

function MapBridge({
  mapRef,
  measureMode,
  onCursor,
  onMeasureClick,
  followDriverId,
}: {
  mapRef: RefObject<LeafletMap | null>
  measureMode: boolean
  onCursor: (coordinate: Coordinate) => void
  onMeasureClick: (coordinate: Coordinate) => void
  followDriverId: string | null
}) {
  const map = useMap()
  const callbacks = useRef({ onCursor, onMeasureClick })
  useEffect(() => {
    callbacks.current = { onCursor, onMeasureClick }
  }, [onCursor, onMeasureClick])
  useEffect(() => {
    mapRef.current = map
    const mouseMove = (event: L.LeafletMouseEvent) =>
      callbacks.current.onCursor({ lat: event.latlng.lat, lng: event.latlng.lng })
    const click = (event: L.LeafletMouseEvent) =>
      callbacks.current.onMeasureClick({ lat: event.latlng.lat, lng: event.latlng.lng })
    map.on('mousemove', mouseMove)
    map.on('click', click)
    return () => {
      map.off('mousemove', mouseMove)
      map.off('click', click)
      mapRef.current = null
    }
  }, [map, mapRef])
  useEffect(() => {
    if (measureMode) map.getContainer().style.cursor = 'crosshair'
    else map.getContainer().style.cursor = ''
    return () => {
      map.getContainer().style.cursor = ''
    }
  }, [map, measureMode])
  useEffect(() => {
    if (!followDriverId) return
    const panToLatest = () => {
      const position = useLivePositionStore.getState().byDriverId[followDriverId]
      if (position) map.panTo([position.lat, position.lng], { animate: false })
    }
    panToLatest()
    return useLivePositionStore.subscribe(panToLatest)
  }, [followDriverId, map])
  return null
}

function formatAge(value: string | null): string {
  if (!value) return 'No signal'
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
}

function DriverRow({
  driver,
  selected,
  onClick,
}: {
  driver: Driver
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`w-full rounded-box border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/10' : 'border-base-content/10 hover:bg-base-200'}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{driver.name}</span>
        <StatusPill
          category="driver"
          status={driver.signalState === 'SIGNAL_LOST' ? 'OFFLINE' : driver.status}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-base-content/60">
        <span>{driver.vehicleType ?? 'No vehicle'}</span>
        <span>{driver.vehiclePlate ?? '—'}</span>
        <span>{formatAge(driver.lastSeenAt)}</span>
      </div>
    </button>
  )
}

function ShipmentRow({
  shipment,
  selected,
  onClick,
}: {
  shipment: Shipment
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`w-full rounded-box border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/10' : 'border-base-content/10 hover:bg-base-200'}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-data text-xs font-semibold">{shipment.trackingCode}</span>
        <StatusPill category="shipment" status={shipment.status} />
      </div>
      <p className="mt-1 truncate text-xs text-base-content/65">
        {shipment.pickupAddress} → {shipment.dropoffAddress}
      </p>
      <p className="mt-1 text-xs text-base-content/50">
        {shipment.driverName ?? 'Unassigned'} · {shipment.priority}
      </p>
    </button>
  )
}

function ActiveNavigationRoute({ route }: { route: NavigationSession | null }) {
  if (!route) return null
  const positions = route.route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as const)
  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: route.status === 'OFF_ROUTE' ? '#d97706' : '#0e8c90',
        weight: 6,
        opacity: 0.9,
        dashArray: '12 7',
      }}
    />
  )
}

export function MapPage() {
  const { status: realtimeStatus } = useRealtime()
  const requestedBenchmark = Number(new URLSearchParams(window.location.search).get('benchmark'))
  const benchmarkCount =
    import.meta.env.DEV && Number.isInteger(requestedBenchmark)
      ? Math.max(0, Math.min(2_000, requestedBenchmark))
      : 0
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(() => persistentPanel('left', true))
  const [rightOpen, setRightOpen] = useState(() => persistentPanel('right', true))
  const [listTab, setListTab] = useState<MapListTab>('drivers')
  const [query, setQuery] = useState('')
  const [driverStatus, setDriverStatus] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [shipmentStatus, setShipmentStatus] = useState('')
  const [zonesVisible, setZonesVisible] = useState(true)
  const [measureMode, setMeasureMode] = useState(false)
  const [measureStart, setMeasureStart] = useState<Coordinate | null>(null)
  const [measureDistanceM, setMeasureDistanceM] = useState<number | null>(null)
  const [hasCursor, setHasCursor] = useState(false)
  const [tileIssue, setTileIssue] = useState(false)
  const [tileRetry, setTileRetry] = useState(0)
  const [followSelected, setFollowSelected] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeNavigations, setActiveNavigations] = useState<Record<string, NavigationSession>>({})
  const mapRef = useRef<LeafletMap | null>(null)
  const cursorRef = useRef<Coordinate | null>(null)
  const cursorTextRef = useRef<HTMLSpanElement | null>(null)
  const cursorStarted = useRef(false)
  const hasAutoFitted = useRef(false)
  const allDriversQuery = useAllDrivers(benchmarkCount === 0)
  const shipmentsQuery = useShipments({ limit: 100 })
  const zonesQuery = useZones({ active: true })
  const zoneFeaturesQuery = useZoneGeoJson(250)
  const alertStatsQuery = useAlertStats()
  const alertsQuery = useAlerts({ status: 'OPEN' })
  const drivers = useMemo(
    () =>
      benchmarkCount > 0
        ? makeBenchmarkDrivers(benchmarkCount)
        : (allDriversQuery.data ?? EMPTY_DRIVERS),
    [allDriversQuery.data, benchmarkCount],
  )
  const shipments = shipmentsQuery.data ?? EMPTY_SHIPMENTS
  const zoneFeatures = zoneFeaturesQuery.data?.features ?? EMPTY_ZONE_FEATURES
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId) ?? null
  const selectedShipment = shipments.find((shipment) => shipment.id === selectedShipmentId) ?? null
  const live = benchmarkCount > 0 || realtimeStatus === 'connected'

  useEffect(() => {
    let active = true
    void navigationApi
      .activeAll()
      .then((sessions) => {
        if (active)
          setActiveNavigations(
            Object.fromEntries(sessions.map((session) => [session.driverId, session])),
          )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const activeNavigation = selectedDriverId ? (activeNavigations[selectedDriverId] ?? null) : null

  useSocketEvent('navigation:route', (event) => {
    setActiveNavigations((previous) => ({
      ...previous,
      [event.driverId]: {
        id: event.sessionId,
        driverId: event.driverId,
        shipmentId: event.shipmentId,
        status: event.status,
        route: event.route,
        waypoints: [],
        targetType: event.targetType,
        distanceM: event.distanceM,
        durationS: event.durationS,
        currentStepIndex: 0,
        rerouteCount: previous[event.driverId]?.rerouteCount ?? 0,
        startedAt: previous[event.driverId]?.startedAt ?? null,
        updatedAt: new Date().toISOString(),
      },
    }))
  })
  useSocketEvent('navigation:rerouted', (event) => {
    setActiveNavigations((previous) => {
      const session = previous[event.driverId]
      return session?.id === event.sessionId
        ? {
            ...previous,
            [event.driverId]: {
              ...session,
              route: event.route,
              targetType: event.targetType,
              status: event.status,
              distanceM: event.distanceM,
              durationS: event.durationS,
              rerouteCount: session.rerouteCount + 1,
            },
          }
        : previous
    })
  })
  useSocketEvent('navigation:progress', (event) => {
    setActiveNavigations((previous) => {
      const session = previous[event.driverId]
      return session?.id === event.sessionId
        ? {
            ...previous,
            [event.driverId]: {
              ...session,
              status: event.status === 'OFF_ROUTE' ? 'OFF_ROUTE' : session.status,
              currentStepIndex: event.stepIndex,
              distanceM: event.remainingDistanceM,
              durationS: event.etaSeconds,
            },
          }
        : previous
    })
  })
  useSocketEvent('navigation:ended', (event) => {
    setActiveNavigations((previous) => {
      if (previous[event.driverId]?.id !== event.sessionId) return previous
      const next = { ...previous }
      delete next[event.driverId]
      return next
    })
  })

  useEffect(() => {
    if (!benchmarkCount) return
    const ids = drivers.map((driver) => driver.id)
    const sequences = new Map(ids.map((id) => [id, 0]))
    const startedAt = performance.now()
    const emitTick = () => {
      const elapsed = (performance.now() - startedAt) / 1_000
      const recordedAt = new Date().toISOString()
      for (const [index, driver] of drivers.entries()) {
        const angle = elapsed * (0.08 + (index % 7) * 0.01) + index * 2.399963229728653
        const lat = (driver.lat ?? 6.5244) + Math.sin(angle) * 0.000025
        const lng = (driver.lng ?? 3.3792) + Math.cos(angle) * 0.00003
        const sequence = (sequences.get(driver.id) ?? 0) + 1
        sequences.set(driver.id, sequence)
        useLivePositionStore.getState().applyPosition({
          driverId: driver.id,
          sequence,
          lat,
          lng,
          accuracyM: 5 + (index % 22),
          speedMps: 1 + (index % 14) / 2,
          headingDeg: (angle * (180 / Math.PI) + 360) % 360,
          recordedAt,
          receivedAt: recordedAt,
        })
      }
    }
    emitTick()
    const interval = window.setInterval(emitTick, 1_000)
    return () => {
      window.clearInterval(interval)
      useLivePositionStore.getState().removePositions(ids)
    }
  }, [benchmarkCount, drivers])

  useEffect(() => {
    localStorage.setItem('routecommand-map-left', leftOpen ? 'open' : 'closed')
  }, [leftOpen])
  useEffect(() => {
    localStorage.setItem('routecommand-map-right', rightOpen ? 'open' : 'closed')
  }, [rightOpen])

  const filteredDrivers = useMemo(
    () =>
      drivers.filter((driver) => {
        if (driverStatus && driver.status !== driverStatus) return false
        if (vehicleType && driver.vehicleType !== vehicleType) return false
        if (
          query &&
          !`${driver.name} ${driver.vehiclePlate ?? ''} ${driver.licenseNo}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          return false
        if (zoneId) {
          const feature = zoneFeatures.find((candidate) => candidate.id === zoneId)
          if (!feature) return false
          const position = useLivePositionStore.getState().byDriverId[driver.id]
          const point = position
            ? { lat: position.lat, lng: position.lng }
            : driver.lat !== null && driver.lng !== null
              ? { lat: driver.lat, lng: driver.lng }
              : null
          if (!point || !pointInZone(point, feature)) return false
        }
        return true
      }),
    [drivers, driverStatus, vehicleType, query, zoneId, zoneFeatures],
  )
  const filteredShipments = useMemo(
    () =>
      shipments.filter((shipment) => {
        if (shipmentStatus && shipment.status !== shipmentStatus) return false
        return (
          !query ||
          `${shipment.trackingCode} ${shipment.pickupAddress} ${shipment.dropoffAddress} ${shipment.customerName}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
      }),
    [shipments, shipmentStatus, query],
  )

  const activeDrivers = drivers.filter((driver) =>
    ['AVAILABLE', 'BUSY'].includes(driver.status),
  ).length
  const inTransit = shipments.filter((shipment) =>
    ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED'].includes(shipment.status),
  ).length
  const unassigned = shipments.filter(
    (shipment) =>
      !shipment.driverId && !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(shipment.status),
  ).length
  const openAlerts = alertStatsQuery.data?.byStatus.OPEN ?? alertsQuery.data?.total ?? 0

  const lastCursorUpdate = useRef(0)
  const onCursor = useCallback((point: Coordinate) => {
    if (performance.now() - lastCursorUpdate.current < 80) return
    lastCursorUpdate.current = performance.now()
    cursorRef.current = point
    if (!cursorStarted.current) {
      cursorStarted.current = true
      setHasCursor(true)
    }
    if (cursorTextRef.current) {
      cursorTextRef.current.textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
    }
  }, [])
  const onMeasureClick = useCallback(
    (point: Coordinate) => {
      if (!measureMode) return
      if (!measureStart) {
        setMeasureStart(point)
        setMeasureDistanceM(null)
        return
      }
      setMeasureDistanceM(
        L.latLng(measureStart.lat, measureStart.lng).distanceTo([point.lat, point.lng]),
      )
      setMeasureStart(null)
    },
    [measureMode, measureStart],
  )

  const fitFleet = useCallback(() => {
    const points = drivers
      .map((driver) => {
        const livePosition = useLivePositionStore.getState().byDriverId[driver.id]
        if (livePosition) return [livePosition.lat, livePosition.lng] as [number, number]
        if (driver.lat !== null && driver.lng !== null)
          return [driver.lat, driver.lng] as [number, number]
        return null
      })
      .filter((point): point is [number, number] => point !== null)
    if (points.length === 1) mapRef.current?.setView(points[0]!, 14)
    else if (points.length > 1)
      mapRef.current?.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 14 })
  }, [drivers])

  useEffect(() => {
    if (hasAutoFitted.current || drivers.length === 0) return
    const hasMappedDriver = drivers.some((driver) => {
      const event = useLivePositionStore.getState().byDriverId[driver.id]
      return Boolean(event || (driver.lat !== null && driver.lng !== null))
    })
    if (!hasMappedDriver) return
    fitFleet()
    hasAutoFitted.current = true
  }, [drivers, fitFleet])

  const selectDriver = useCallback(
    (driverId: string) => {
      setSelectedDriverId(driverId)
      setSelectedShipmentId(null)
      const event = useLivePositionStore.getState().byDriverId[driverId]
      const driver = drivers.find((item) => item.id === driverId)
      const position = event
        ? ([event.lat, event.lng] as [number, number])
        : driver?.lat !== null && driver?.lat !== undefined && driver.lng !== null
          ? ([driver.lat, driver.lng] as [number, number])
          : null
      if (position)
        mapRef.current?.flyTo(position, Math.max(mapRef.current.getZoom(), 14), { duration: 0.5 })
      setRightOpen(true)
    },
    [drivers],
  )

  const selectShipment = useCallback(
    (shipmentId: string) => {
      setSelectedShipmentId(shipmentId)
      setSelectedDriverId(null)
      const shipment = shipments.find((item) => item.id === shipmentId)
      if (shipment) {
        mapRef.current?.fitBounds(
          L.latLngBounds(
            [shipment.pickup.lat, shipment.pickup.lng],
            [shipment.dropoff.lat, shipment.dropoff.lng],
          ),
          { padding: [70, 70], maxZoom: 14 },
        )
      }
      setRightOpen(true)
    },
    [shipments],
  )

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return
      if (event.key.toLowerCase() === 'f') fitFleet()
      if (event.key.toLowerCase() === 'm') setMeasureMode((previous) => !previous)
      if (event.key === 'Escape') {
        setSelectedDriverId(null)
        setSelectedShipmentId(null)
        setMeasureMode(false)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [fitFleet])

  async function copyCursor() {
    const cursor = cursorRef.current
    if (!cursor) return
    await navigator.clipboard.writeText(`${cursor.lat.toFixed(6)}, ${cursor.lng.toFixed(6)}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  function togglePanel(side: 'left' | 'right') {
    if (side === 'left') setLeftOpen((open) => !open)
    else setRightOpen((open) => !open)
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <MapCanvas retryKey={tileRetry} onTileError={() => setTileIssue(true)}>
        <MapBridge
          mapRef={mapRef}
          measureMode={measureMode}
          onCursor={onCursor}
          onMeasureClick={onMeasureClick}
          followDriverId={followSelected ? selectedDriverId : null}
        />
        <DriversLayer
          drivers={filteredDrivers}
          selectedDriverId={selectedDriverId}
          onSelect={selectDriver}
          live={live}
        />
        <ShipmentsLayer
          shipments={filteredShipments}
          selectedShipmentId={selectedShipmentId}
          onSelect={selectShipment}
          selectedDriverId={selectedShipment?.driverId ?? null}
        />
        <ActiveNavigationRoute route={activeNavigation} />
        {zonesVisible && <ZonesLayer features={zoneFeatures} hiddenIds={new Set()} />}
      </MapCanvas>

      <div className="pointer-events-none absolute inset-x-0 top-2 z-[500] flex justify-center px-2">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-box border border-base-content/10 bg-base-100/95 px-3 py-2 shadow-lg backdrop-blur">
          <Kpi label="Active drivers" value={activeDrivers} />
          <Kpi label="In transit" value={inTransit} />
          <Kpi label="Unassigned" value={unassigned} />
          <Link
            className="flex items-center gap-1 border-l border-base-content/10 pl-3 text-xs hover:text-primary"
            to="/app/alerts"
          >
            <Activity className="size-3.5" aria-hidden="true" /> {openAlerts} alerts
          </Link>
          {benchmarkCount > 0 && (
            <span className="border-l border-base-content/10 pl-3 text-xs font-medium text-warning">
              {benchmarkCount} simulated drivers · 1 Hz
            </span>
          )}
        </div>
      </div>
      {activeNavigation && (
        <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-[500] w-[min(25rem,calc(100vw-1.5rem))] -translate-x-1/2 px-2 sm:top-[4.5rem]">
          <div
            className={`rounded-box border bg-base-100/95 px-3 py-2 shadow-lg backdrop-blur ${activeNavigation.status === 'OFF_ROUTE' ? 'border-warning' : 'border-primary/40'}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Live driver navigation{activeNavigation.status === 'OFF_ROUTE' ? ' · off route' : ''}
            </p>
            <p className="mt-1 truncate text-xs">
              {activeNavigation.route.legs[0]?.steps[activeNavigation.currentStepIndex]
                ?.instruction ?? 'Route active'}{' '}
              · {Math.round(activeNavigation.distanceM / 100) / 10} km remaining ·{' '}
              {Math.ceil(activeNavigation.durationS / 60)} min
            </p>
            <p className="mt-1 text-[10px] text-base-content/50">
              © OpenStreetMap contributors · ODbL
            </p>
          </div>
        </div>
      )}
      <div className="absolute right-3 top-[4.5rem] z-[500] sm:right-5">
        <RealtimeConnectionBanner />
      </div>

      <div className="absolute left-3 top-16 z-[500] flex flex-col gap-2 sm:left-4 sm:top-20">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => togglePanel('left')}
          aria-label={leftOpen ? 'Collapse lists' : 'Open lists'}
        >
          {leftOpen ? (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Lists</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => togglePanel('right')}
          aria-label={rightOpen ? 'Collapse details' : 'Open details'}
        >
          {rightOpen ? (
            <PanelRightClose className="size-4" aria-hidden="true" />
          ) : (
            <PanelRightOpen className="size-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Details</span>
        </Button>
      </div>

      {leftOpen && (
        <aside className="absolute bottom-3 left-3 top-28 z-[450] flex max-h-[calc(100%-8rem)] w-[min(21rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-box border border-base-content/10 bg-base-100/95 shadow-xl backdrop-blur sm:bottom-4 sm:left-16 sm:top-20">
          <div className="flex items-start justify-between border-b border-base-content/10 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                Operations picture
              </p>
              <p className="mt-1 text-xs text-base-content/55">
                Find a driver or shipment, then select it on the map.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Collapse lists"
              onClick={() => togglePanel('left')}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 border-b border-base-content/10 p-3">
            <Button
              size="sm"
              variant={listTab === 'drivers' ? 'primary' : 'outline'}
              onClick={() => setListTab('drivers')}
            >
              Drivers ({drivers.length})
            </Button>
            <Button
              size="sm"
              variant={listTab === 'shipments' ? 'primary' : 'outline'}
              onClick={() => setListTab('shipments')}
            >
              Shipments ({shipments.length})
            </Button>
          </div>
          <div className="space-y-2 border-b border-base-content/10 p-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-base-content/40"
                aria-hidden="true"
              />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  listTab === 'drivers'
                    ? 'Driver, plate, or license'
                    : 'Tracking, customer, address'
                }
              />
            </div>
            {listTab === 'drivers' ? (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label="Filter driver status"
                  value={driverStatus}
                  onChange={(event) => setDriverStatus(event.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="AVAILABLE">Available</option>
                  <option value="BUSY">Busy</option>
                  <option value="OFFLINE">Offline</option>
                  <option value="ON_BREAK">On break</option>
                </Select>
                <Select
                  aria-label="Filter vehicle type"
                  value={vehicleType}
                  onChange={(event) => setVehicleType(event.target.value)}
                >
                  <option value="">All vehicles</option>
                  <option value="BIKE">Bike</option>
                  <option value="CAR">Car</option>
                  <option value="VAN">Van</option>
                  <option value="TRUCK">Truck</option>
                </Select>
                <Select
                  className="col-span-2"
                  aria-label="Filter driver zone"
                  value={zoneId}
                  onChange={(event) => setZoneId(event.target.value)}
                >
                  <option value="">All zones</option>
                  {(zonesQuery.data ?? []).map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name} · {zone.type.toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <Select
                aria-label="Filter shipment status"
                value={shipmentStatus}
                onChange={(event) => setShipmentStatus(event.target.value)}
              >
                <option value="">All active shipments</option>
                <option value="CREATED">Created</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="PICKED_UP">Picked up</option>
                <option value="IN_TRANSIT">In transit</option>
                <option value="ARRIVED">Arrived</option>
              </Select>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {listTab === 'drivers'
              ? filteredDrivers.map((driver) => (
                  <DriverRow
                    key={driver.id}
                    driver={driver}
                    selected={selectedDriverId === driver.id}
                    onClick={() => selectDriver(driver.id)}
                  />
                ))
              : filteredShipments.map((shipment) => (
                  <ShipmentRow
                    key={shipment.id}
                    shipment={shipment}
                    selected={selectedShipmentId === shipment.id}
                    onClick={() => selectShipment(shipment.id)}
                  />
                ))}
            {((listTab === 'drivers' && filteredDrivers.length === 0) ||
              (listTab === 'shipments' && filteredShipments.length === 0)) && (
              <p className="py-6 text-center text-sm text-base-content/55">
                No matching {listTab}.
              </p>
            )}
          </div>
        </aside>
      )}

      {rightOpen && (
        <aside className="absolute bottom-3 right-3 top-auto z-[450] max-h-[40vh] w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto rounded-box border border-base-content/10 bg-base-100/95 shadow-xl backdrop-blur sm:bottom-4 sm:right-4 sm:top-20 sm:max-h-[calc(100%-6rem)]">
          <div className="flex items-center justify-between border-b border-base-content/10 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                Selected asset
              </p>
              <p className="mt-1 text-xs text-base-content/55">
                Live telemetry and operational context
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Collapse details"
              onClick={() => togglePanel('right')}
            >
              <X className="size-4" />
            </Button>
          </div>
          {selectedDriver ? (
            <DriverDetails
              driver={selectedDriver}
              followSelected={followSelected}
              setFollowSelected={setFollowSelected}
              clearSelection={() => setSelectedDriverId(null)}
            />
          ) : selectedShipment ? (
            <ShipmentDetails
              shipment={selectedShipment}
              onClear={() => setSelectedShipmentId(null)}
            />
          ) : (
            <div className="space-y-3 p-4 text-sm text-base-content/60">
              <p>Select a driver or shipment from the list or map.</p>
              <p className="text-xs">Active alerts: {alertsQuery.data?.data.length ?? 0}</p>
              <Link
                className="link link-primary inline-flex items-center gap-1 text-xs"
                to="/app/dispatch"
              >
                Open dispatch board <ExternalLink className="size-3" />
              </Link>
            </div>
          )}
        </aside>
      )}

      <div className="absolute bottom-3 left-1/2 z-[500] flex -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-box border border-base-content/10 bg-base-100/95 p-1.5 shadow-lg backdrop-blur sm:bottom-4">
        <Button size="sm" variant="ghost" onClick={fitFleet} title="Fit fleet (F)">
          <Crosshair className="size-4" />
          <span className="hidden sm:inline">Fit fleet</span>
        </Button>
        <Button
          size="sm"
          variant={followSelected ? 'primary' : 'ghost'}
          disabled={!selectedDriverId}
          onClick={() => setFollowSelected((value) => !value)}
          title="Follow selected driver"
        >
          <LocateFixed className="size-4" />
          <span className="hidden sm:inline">Follow</span>
        </Button>
        <Button
          size="sm"
          variant={zonesVisible ? 'secondary' : 'ghost'}
          onClick={() => setZonesVisible((value) => !value)}
        >
          Zones
        </Button>
        <Button
          size="sm"
          variant={measureMode ? 'primary' : 'ghost'}
          onClick={() => {
            setMeasureMode((value) => !value)
            setMeasureStart(null)
            setMeasureDistanceM(null)
          }}
          title="Measure distance (M)"
        >
          <Ruler className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const container = mapRef.current?.getContainer()
            if (!container) return
            if (document.fullscreenElement) void document.exitFullscreen()
            else void container.requestFullscreen()
          }}
          title="Fullscreen"
        >
          <Maximize className="size-4" />
          <span className="sr-only">Fullscreen</span>
        </Button>
      </div>

      {(measureMode || measureDistanceM !== null || hasCursor) && (
        <div className="absolute bottom-16 left-1/2 z-[500] -translate-x-1/2 rounded-box border border-base-content/10 bg-base-100/95 px-3 py-2 font-data text-xs shadow-lg backdrop-blur sm:bottom-16">
          {measureMode ? (
            <span>
              {measureStart ? 'Click a second point' : 'Click the map to measure'} · Esc to exit
            </span>
          ) : measureDistanceM !== null ? (
            <span>Distance: {(measureDistanceM / 1000).toFixed(2)} km</span>
          ) : null}
          {hasCursor && (
            <span ref={cursorTextRef} className="ml-2 border-l border-base-content/15 pl-2">
              —
            </span>
          )}
          {hasCursor && (
            <button className="ml-2 text-primary hover:underline" onClick={() => void copyCursor()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}

      {tileIssue && (
        <div className="absolute bottom-16 right-3 z-[550] max-w-xs rounded-box border border-warning/30 bg-base-100/95 p-3 text-xs shadow-lg sm:right-4">
          <p>Map tiles failed to load. Check your connection or switch the base layer.</p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() => {
              setTileIssue(false)
              setTileRetry((value) => value + 1)
            }}
          >
            Retry tiles
          </Button>
        </div>
      )}

      {!allDriversQuery.isPending && drivers.length === 0 && (
        <div className="absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 rounded-box border border-base-content/10 bg-base-100/95 p-4 text-center shadow-lg">
          <p className="text-sm font-medium">No drivers to display</p>
          <Link
            className="mt-1 inline-block text-xs text-primary hover:underline"
            to="/app/drivers"
          >
            Open fleet
          </Link>
        </div>
      )}
      {allDriversQuery.isError && (
        <div className="absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 rounded-box bg-base-100 p-4 text-sm text-error shadow-lg">
          Drivers could not be loaded.
        </div>
      )}
      {allDriversQuery.isPending && benchmarkCount === 0 && (
        <div className="absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 rounded-box border border-base-content/10 bg-base-100/95 px-4 py-3 text-sm shadow-lg">
          Loading live fleet…
        </div>
      )}
      {shipmentsQuery.isError && (
        <div className="absolute bottom-16 left-3 z-[400] rounded-box bg-base-100 p-3 text-xs text-error shadow-lg">
          Shipment overlay could not be loaded.
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2 text-center">
      <p className="font-data text-sm font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-base-content/55">{label}</p>
    </div>
  )
}

function DetailLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-base-content/5 py-2 last:border-0">
      <span className="text-xs text-base-content/55">{label}</span>
      <span className="max-w-[65%] truncate text-right text-xs font-medium">{value}</span>
    </div>
  )
}

function DriverDetails({
  driver,
  followSelected,
  setFollowSelected,
  clearSelection,
}: {
  driver: Driver
  followSelected: boolean
  setFollowSelected: (value: (previous: boolean) => boolean) => void
  clearSelection: () => void
}) {
  const position = useLivePosition(driver.id)
  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{driver.name}</h2>
          <p className="mt-1 font-data text-xs text-base-content/50">
            {driver.vehiclePlate ?? driver.licenseNo}
          </p>
        </div>
        <StatusPill
          category="driver"
          status={driver.signalState === 'SIGNAL_LOST' ? 'OFFLINE' : driver.status}
        />
      </div>
      <DetailLine
        label="Vehicle"
        value={`${driver.vehicleType ?? 'Unassigned'} · ${driver.vehiclePlate ?? '—'}`}
      />
      <DetailLine
        label="Last fix"
        value={
          position?.receivedAt
            ? new Date(position.receivedAt).toLocaleString()
            : formatAge(driver.lastSeenAt)
        }
      />
      <DetailLine label="Accuracy" value={position ? `${position.accuracyM.toFixed(0)} m` : '—'} />
      <DetailLine
        label="Speed"
        value={position?.speedMps == null ? '—' : `${(position.speedMps * 3.6).toFixed(1)} km/h`}
      />
      <DetailLine
        label="Heading"
        value={position?.headingDeg == null ? '—' : `${position.headingDeg.toFixed(0)}°`}
      />
      <DetailLine
        label="Signal"
        value={
          driver.signalState === 'SIGNAL_LOST'
            ? 'Signal lost'
            : driver.signalState === 'LIVE'
              ? 'Live'
              : 'No signal'
        }
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant={followSelected ? 'primary' : 'outline'}
          onClick={() => setFollowSelected((value) => !value)}
        >
          <LocateFixed className="size-3.5" /> {followSelected ? 'Following' : 'Follow'}
        </Button>
        <Link
          className="btn btn-outline btn-sm"
          to="/app/dispatch"
          state={{ selectedDriverId: driver.id }}
        >
          Assign job
        </Link>
        <Link
          className="btn btn-ghost btn-sm"
          to="/app/drivers"
          state={{ selectedDriverId: driver.id, selectedDriverName: driver.name }}
        >
          Fleet profile
        </Link>
        {driver.email && (
          <a className="btn btn-ghost btn-sm" href={`mailto:${encodeURIComponent(driver.email)}`}>
            Message
          </a>
        )}
      </div>
      <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={clearSelection}>
        Clear selection
      </Button>
    </div>
  )
}

function ShipmentDetails({ shipment, onClear }: { shipment: Shipment; onClear: () => void }) {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-data text-sm font-semibold">{shipment.trackingCode}</h2>
          <p className="mt-1 text-xs text-base-content/55">{shipment.customerName}</p>
        </div>
        <StatusPill category="shipment" status={shipment.status} />
      </div>
      <DetailLine label="Pickup" value={shipment.pickupAddress} />
      <DetailLine label="Dropoff" value={shipment.dropoffAddress} />
      <DetailLine label="Driver" value={shipment.driverName ?? 'Unassigned'} />
      <DetailLine
        label="ETA"
        value={shipment.eta ? new Date(shipment.eta).toLocaleString() : 'Not available'}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link className="btn btn-primary btn-sm" to="/app/dispatch">
          Dispatch
        </Link>
        <Link className="btn btn-outline btn-sm" to="/app/shipments">
          Shipment details
        </Link>
      </div>
      <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  )
}
