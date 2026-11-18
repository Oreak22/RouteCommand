import type {
  NavigationCoordinate,
  NavigationRoute,
  NavigationState,
  NavigationTargetType,
} from '@routecommand/shared'
import { NavigationEngine } from '@routecommand/shared'
import { divIcon, marker as createLeafletMarker } from 'leaflet'
import type { LatLngExpression, Marker as LeafletMarker } from 'leaflet'
import { ArrowLeft, LocateFixed, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { ErrorState } from '../../../components/ui/ErrorState'
import { useToast } from '../../../components/ui/toast-context'
import { useAuth } from '../../auth/auth-context'
import { MapCanvas } from '../../map/MapCanvas'
import { useSocketEvent } from '../../realtime/useRealtime'
import { shipmentsApi } from '../../shipments/api/client'
import { useDriverTelemetry } from '../../telemetry/DriverTelemetryProvider'
import {
  cacheNavigationSession,
  clearCachedNavigationSession,
  readCachedNavigationSession,
} from '../../telemetry/offline-telemetry-store'
import { navigationApi } from '../api/client'
import type { NavigationSession } from '../api/client'

function meters(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} km` : `${Math.round(value)} m`
}

function FollowControls({ onManualPan }: { onManualPan: () => void }) {
  useMapEvents({ dragstart: onManualPan })
  return null
}

function FitRoute({ route }: { route: NavigationRoute }) {
  const map = useMap()
  useEffect(() => {
    const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
    if (points.length > 1) map.fitBounds(points, { padding: [48, 48], maxZoom: 16 })
  }, [map, route])
  return null
}

const driverMarkerIcon = divIcon({
  className: 'navigation-driver-marker',
  html: '<span class="navigation-driver-arrow" aria-hidden="true">▲</span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
})

const destinationMarkerIcon = divIcon({
  className: 'navigation-destination-marker',
  html: '<span aria-hidden="true"><b>D</b></span>',
  iconSize: [34, 42],
  iconAnchor: [17, 38],
})

const pickupMarkerIcon = divIcon({
  className: 'navigation-destination-marker',
  html: '<span aria-hidden="true"><b>P</b></span>',
  iconSize: [34, 42],
  iconAnchor: [17, 38],
})

function SmoothDriverMarker({
  position,
  recordedAt,
  heading,
}: {
  position: NavigationCoordinate | null
  recordedAt: string | null
  heading: number | null
}) {
  const map = useMap()
  const markerRef = useRef<LeafletMarker | null>(null)
  const frameRef = useRef<number | null>(null)
  const previousFixAt = useRef<number | null>(null)
  const positionRef = useRef(position)
  const headingRef = useRef(heading)
  const positionLat = position?.lat
  const positionLng = position?.lng

  useEffect(() => {
    positionRef.current =
      positionLat === undefined || positionLng === undefined
        ? null
        : { lat: positionLat, lng: positionLng }
  }, [positionLat, positionLng])

  useEffect(() => {
    headingRef.current = heading
    const instance = markerRef.current
    if (!instance) return
    const arrow = instance.getElement()?.querySelector<HTMLElement>('.navigation-driver-arrow')
    arrow?.style.setProperty('--driver-heading', `${heading ?? 0}deg`)
  }, [heading])

  useEffect(() => {
    const target = positionRef.current
    if (!target) return
    let instance = markerRef.current
    if (!instance) {
      instance = createLeafletMarker([target.lat, target.lng], {
        icon: driverMarkerIcon,
        keyboard: false,
        zIndexOffset: 1_000,
        title: 'Current driver position',
      }).addTo(map)
      markerRef.current = instance
      instance
        .getElement()
        ?.querySelector<HTMLElement>('.navigation-driver-arrow')
        ?.style.setProperty('--driver-heading', `${headingRef.current ?? 0}deg`)
      previousFixAt.current = recordedAt ? Date.parse(recordedAt) : null
      return
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    const from = instance.getLatLng()
    const start = { lat: from.lat, lng: from.lng }
    const end = target
    const fixTime = recordedAt ? Date.parse(recordedAt) : Date.now()
    const elapsed = previousFixAt.current === null ? 700 : fixTime - previousFixAt.current
    previousFixAt.current = fixTime
    const duration = Math.max(350, Math.min(1_200, Number.isFinite(elapsed) ? elapsed : 700))

    if (document.visibilityState === 'hidden') {
      instance.setLatLng([end.lat, end.lng])
      return
    }

    let animationStart: number | null = null
    const animate = (time: number) => {
      if (document.visibilityState === 'hidden') {
        frameRef.current = null
        return
      }
      animationStart ??= time
      const progress = Math.min(1, (time - animationStart) / duration)
      const eased = progress * (2 - progress)
      instance?.setLatLng([
        start.lat + (end.lat - start.lat) * eased,
        start.lng + (end.lng - start.lng) * eased,
      ])
      if (progress < 1) frameRef.current = requestAnimationFrame(animate)
      else frameRef.current = null
    }
    frameRef.current = requestAnimationFrame(animate)
  }, [map, position?.lat, position?.lng, recordedAt])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      markerRef.current?.remove()
      markerRef.current = null
    },
    [map],
  )

  return null
}

function MapFollowController({
  center,
  follow,
  speedMps,
}: {
  center: LatLngExpression
  follow: boolean
  speedMps: number | null
}) {
  const map = useMap()
  useEffect(() => {
    if (!follow) return
    const zoom =
      speedMps !== null && speedMps > 15 ? 16 : speedMps !== null && speedMps > 5 ? 17 : 18
    const driverPoint = map.project(center, zoom)
    const targetCenter = map.unproject(
      [driverPoint.x, driverPoint.y - map.getSize().y * 0.15],
      zoom,
    )
    map.setView(targetCenter, zoom, { animate: true, duration: 0.5 })
  }, [center, follow, map, speedMps])
  return null
}

function RouteLayer({
  route,
  state,
  destination,
  targetType,
}: {
  route: NavigationRoute
  state: NavigationState | null
  destination: NavigationCoordinate
  targetType: NavigationTargetType
}) {
  const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as const)
  const progressM = state?.distanceAlongRouteM ?? 0
  let walkedM = 0
  let split = 1
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lat1, lng1] = coordinates[index - 1]!
    const [lat2, lng2] = coordinates[index]!
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
    walkedM += 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (walkedM >= progressM) {
      split = index
      break
    }
    split = index
  }
  return (
    <>
      <Polyline
        positions={coordinates.slice(0, split + 1)}
        pathOptions={{ color: 'var(--color-base-content)', weight: 5, opacity: 0.45 }}
      />
      <Polyline
        positions={coordinates.slice(split)}
        pathOptions={{
          color: route.degraded ? 'var(--color-warning)' : 'var(--color-primary)',
          weight: 6,
          opacity: 0.95,
        }}
      />
      {coordinates.length > 1 && (
        <Marker
          position={[destination.lat, destination.lng]}
          icon={targetType === 'PICKUP' ? pickupMarkerIcon : destinationMarkerIcon}
          keyboard={false}
          zIndexOffset={900}
          title={targetType === 'PICKUP' ? 'Pickup location' : 'Delivery destination'}
        />
      )}
    </>
  )
}

export function NavigationScreen() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { lastFix } = useDriverTelemetry()
  const { user } = useAuth()
  const { pushToast } = useToast()
  const userId = user?.id
  const [session, setSession] = useState<NavigationSession | null>(null)
  const [state, setState] = useState<NavigationState | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false)
  const [confirmingArrival, setConfirmingArrival] = useState(false)
  const [confirmingPickup, setConfirmingPickup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [wallClockMs, setWallClockMs] = useState(0)
  const engine = useRef<NavigationEngine | null>(null)
  const restoredState = useRef<NavigationState | null>(null)
  const lastProgressAt = useRef(0)
  const lastRerouteAt = useRef(0)
  const resumeFollowTimer = useRef<number | null>(null)
  const advancingStop = useRef(false)
  const shipmentId = searchParams.get('shipmentId')

  useEffect(() => {
    let active = true
    void navigationApi
      .active()
      .then((value) => {
        if (active) {
          setSession(value)
          if (value && userId) void cacheNavigationSession(value, userId)
          setLoading(false)
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? `${cause.message} Showing the saved route while offline.`
              : 'Showing the saved route while offline.',
          )
          if (userId)
            void readCachedNavigationSession(userId).then((value) => {
              if (!active || !value) return
              restoredState.current = value.state
              setSession(value.session)
            })
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [userId])

  useEffect(() => {
    if (!session) return
    engine.current = new NavigationEngine(session.route)
    setState(restoredState.current)
    restoredState.current = null
  }, [session])

  useEffect(() => {
    const timer = window.setInterval(() => setWallClockMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const applyRoute = useCallback(
    (next: NavigationSession) => {
      setSession(next)
      engine.current?.resetRoute(next.route)
      setState(null)
      setError(null)
      if (userId) void cacheNavigationSession(next, userId)
    },
    [userId],
  )
  const advanceToDelivery = useCallback(async () => {
    if (!session || session.targetType !== 'PICKUP' || advancingStop.current) return
    advancingStop.current = true
    const [lng, lat] = session.route.geometry.coordinates[0] ?? [3.3792, 6.5244]
    const position = lastFix ?? {
      lat: state?.snappedPosition.lat ?? lat,
      lng: state?.snappedPosition.lng ?? lng,
      accuracyM: 100,
      speedMps: null,
      headingDeg: null,
      recordedAt: new Date().toISOString(),
    }
    try {
      const next = await navigationApi.reroute(
        session.id,
        position,
        position.accuracyM,
        position.headingDeg,
        'STOP_ADVANCED',
      )
      applyRoute(next)
      pushToast('Pickup confirmed. Navigation now guides you to delivery.', 'success')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Pickup is confirmed, but the delivery route could not be updated.',
      )
    } finally {
      advancingStop.current = false
      setConfirmingPickup(false)
    }
  }, [applyRoute, lastFix, pushToast, session, state?.snappedPosition])
  useSocketEvent('navigation:rerouted', (event) => {
    if (session?.id === event.sessionId)
      applyRoute({
        ...session,
        route: event.route,
        targetType: event.targetType,
        status: event.status,
        distanceM: event.distanceM,
        durationS: event.durationS,
      })
  })
  useSocketEvent('shipment:updated', (event) => {
    if (!session || event.shipmentId !== session.shipmentId || event.status !== 'PICKED_UP') return
    void advanceToDelivery()
  })

  useEffect(() => {
    if (!session || !lastFix || !engine.current) return
    const next = engine.current.update(lastFix)
    if (!next) return
    setState(next)
    if (userId) void cacheNavigationSession(session, userId, next).catch(() => undefined)
    for (const announcement of next.announcements) {
      if (voiceEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(announcement.text)
        utterance.rate = 1
        window.speechSynthesis.speak(utterance)
      }
    }
    if (
      next.status === 'OFF_ROUTE' &&
      navigator.onLine &&
      Date.now() - lastRerouteAt.current > 8_000
    ) {
      lastRerouteAt.current = Date.now()
      void navigationApi
        .reroute(session.id, lastFix, lastFix.accuracyM, lastFix.headingDeg)
        .then(applyRoute)
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : 'Reroute failed.'),
        )
    } else if (next.status === 'OFF_ROUTE' && !navigator.onLine) {
      setError(
        'No connection. Follow the previous route or return to it; rerouting will retry when you are online.',
      )
    }
    if (Date.now() - lastProgressAt.current >= 5_000 && navigator.onLine) {
      lastProgressAt.current = Date.now()
      void navigationApi.progress(session.id, next, lastFix).catch(() => undefined)
    }
  }, [applyRoute, lastFix, session, userId, voiceEnabled])

  useEffect(() => {
    const onOnline = () => {
      lastRerouteAt.current = 0
      if (session && lastFix && state?.status === 'OFF_ROUTE') {
        lastRerouteAt.current = Date.now()
        void navigationApi
          .reroute(session.id, lastFix, lastFix.accuracyM, lastFix.headingDeg)
          .then(applyRoute)
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : 'Reroute failed.'),
          )
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [applyRoute, lastFix, session, state?.status])

  useEffect(
    () => () => {
      if (resumeFollowTimer.current !== null) window.clearTimeout(resumeFollowTimer.current)
    },
    [],
  )

  const onManualPan = () => {
    setFollow(false)
    if (resumeFollowTimer.current !== null) window.clearTimeout(resumeFollowTimer.current)
    resumeFollowTimer.current = window.setTimeout(() => setFollow(true), 15_000)
  }

  useEffect(() => {
    if (!session || !lastFix) return
    const timer = window.setInterval(() => {
      if (Date.now() - Date.parse(lastFix.recordedAt) < 3_000 || !engine.current) return
      const estimated = engine.current.update({ ...lastFix, accuracyM: 1_001 })
      if (!estimated) return
      setState(estimated)
      if (Date.now() - lastProgressAt.current >= 5_000 && navigator.onLine) {
        lastProgressAt.current = Date.now()
        void navigationApi.progress(session.id, estimated, lastFix).catch(() => undefined)
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [lastFix, session])

  const startNavigation = async () => {
    if (!shipmentId) {
      setError('Open navigation from one of your active jobs.')
      return
    }
    setStarting(true)
    setError(null)
    try {
      const next = await navigationApi.start(shipmentId)
      setSession(next)
      engine.current = new NavigationEngine(next.route)
      if (userId) await cacheNavigationSession(next, userId)
      if ('speechSynthesis' in window) {
        const unlock = new SpeechSynthesisUtterance(
          next.route.degraded
            ? 'Road routing is unavailable. Follow the displayed direction carefully.'
            : 'Navigation started.',
        )
        window.speechSynthesis.speak(unlock)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Navigation could not start.')
    } finally {
      setStarting(false)
    }
  }

  const endNavigation = async () => {
    if (!session || ending) return
    setEnding(true)
    setError(null)
    try {
      const ended = await navigationApi.end(
        session.id,
        state?.status === 'ARRIVED' ? 'ARRIVED' : 'MANUAL',
      )
      if (userId) void clearCachedNavigationSession(userId).catch(() => undefined)
      window.speechSynthesis?.cancel()
      engine.current = null
      setState(null)
      setSession(null)
      setEndConfirmationOpen(false)
      pushToast('Navigation ended. The shipment is still assigned to you.', 'success')
      navigate('/driver/shipments', { state: { selectedShipmentId: ended.shipmentId } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Navigation could not end.')
    } finally {
      setEnding(false)
    }
  }

  const confirmPickup = async () => {
    if (!session || confirmingPickup) return
    setConfirmingPickup(true)
    setError(null)
    try {
      const shipment = await shipmentsApi.detail(session.shipmentId)
      let status = shipment.status
      if (status === 'ASSIGNED') {
        await shipmentsApi.accept(session.shipmentId)
        status = 'ACCEPTED'
      }
      if (status === 'ACCEPTED') {
        await shipmentsApi.transition(
          session.shipmentId,
          { toStatus: 'PICKED_UP', note: 'Driver confirmed pickup from navigation.' },
          `navigation-pickup-${session.id}`,
        )
      } else if (status !== 'PICKED_UP') {
        throw new Error('This shipment is not ready to confirm pickup.')
      }
      await advanceToDelivery()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pickup could not be confirmed.')
      setConfirmingPickup(false)
    }
  }

  const confirmArrival = async () => {
    if (!session || !window.confirm('Confirm that you have arrived at the delivery location?'))
      return
    setConfirmingArrival(true)
    setError(null)
    try {
      await shipmentsApi.transition(
        session.shipmentId,
        {
          toStatus: 'ARRIVED',
          note: 'Driver confirmed arrival from turn-by-turn navigation.',
        },
        `navigation-arrival-${session.id}`,
      )
      await navigationApi.end(session.id, 'ARRIVED')
      if (userId) await clearCachedNavigationSession(userId)
      setSession(null)
      window.speechSynthesis?.cancel()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Arrival could not be confirmed. Check the job status and try again.',
      )
    } finally {
      setConfirmingArrival(false)
    }
  }

  const routeStart: NavigationCoordinate = useMemo(() => {
    const [lng, lat] = session?.route.geometry.coordinates[0] ?? [3.3792, 6.5244]
    return { lat, lng }
  }, [session?.route])
  const center: LatLngExpression = useMemo(() => {
    if (state) return [state.snappedPosition.lat, state.snappedPosition.lng]
    return [routeStart.lat, routeStart.lng]
  }, [routeStart, state])

  if (loading) return <p className="p-6 text-sm text-base-content/60">Restoring navigation…</p>
  if (!session)
    return (
      <Card className="mx-auto max-w-xl">
        <Link className="btn btn-ghost btn-sm" to="/driver">
          <ArrowLeft className="size-4" /> Back to jobs
        </Link>
        <h1 className="mt-5 text-xl font-semibold">Turn-by-turn navigation</h1>
        <p className="mt-2 text-sm text-base-content/60">
          Start navigation from an active shipment. Keep your phone mounted and follow road signs
          and local traffic rules.
        </p>
        {error && (
          <p className="mt-4 text-sm text-error" role="alert">
            {error}
          </p>
        )}
        {shipmentId && (
          <Button
            className="mt-5 min-h-12 w-full"
            disabled={starting}
            onClick={() => void startNavigation()}
          >
            {starting ? 'Preparing route…' : 'Start navigation'}
          </Button>
        )}
        {!shipmentId && (
          <Link className="btn btn-primary mt-5" to="/driver/shipments">
            Choose an active job
          </Link>
        )}
      </Card>
    )

  const steps = session.route.legs.flatMap((leg) => leg.steps)
  const current = steps[state?.currentStepIndex ?? session.currentStepIndex]
  const next = steps[(state?.currentStepIndex ?? session.currentStepIndex) + 1]
  const gpsStale = Boolean(
    lastFix && wallClockMs > 0 && wallClockMs - Date.parse(lastFix.recordedAt) > 15_000,
  )
  const driverPosition =
    state?.snappedPosition ?? (lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : routeStart)
  return (
    <div className="-m-3 flex h-[calc(100dvh-7.5rem)] min-h-[32rem] flex-col overflow-hidden bg-base-200 sm:-m-6 sm:h-[calc(100dvh-6rem)]">
      <div className="z-[1] grid gap-2 bg-base-100 p-3 shadow-md sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {state?.status === 'OFF_ROUTE'
                ? 'Off route · rerouting'
                : current?.streetNames.join(', ') || 'Follow the route'}
            </p>
            {lastFix && (
              <span
                className={`badge badge-sm ${gpsStale || lastFix.accuracyM > 100 ? 'badge-warning' : 'badge-success'}`}
              >
                GPS ±{Math.round(lastFix.accuracyM)} m{gpsStale ? ' · stale' : ''}
              </span>
            )}
            {!lastFix && (
              <span className="badge badge-warning badge-sm">
                Waiting for GPS · showing route start
              </span>
            )}
            <span className="badge badge-info badge-sm">
              Next stop · {session.targetType === 'PICKUP' ? 'Pickup' : 'Delivery'}
            </span>
          </div>
          <h1 className="mt-1 truncate text-lg font-bold sm:text-xl">
            {current?.instruction ?? 'Continue to destination'}
          </h1>
          {next && (
            <p className="mt-1 truncate text-xs text-base-content/60">Then: {next.instruction}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="font-data text-sm font-semibold">
            {meters(state?.distanceToNextManeuverM ?? 0)} ·{' '}
            {meters(state?.remainingDistanceM ?? session.distanceM)} ·{' '}
            {Math.ceil((state?.etaSeconds ?? session.durationS) / 60)} min
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={voiceEnabled ? 'Mute instructions' : 'Enable voice instructions'}
            onClick={() => setVoiceEnabled((enabled) => !enabled)}
          >
            {voiceEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </Button>
        </div>
      </div>
      {session.route.degraded && (
        <p className="bg-warning/20 px-3 py-2 text-center text-xs font-medium text-warning-content">
          Road routing unavailable · straight-line guidance only
        </p>
      )}
      {error && (
        <ErrorState
          title="Navigation update failed"
          description={error}
          onRetry={() => setError(null)}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <MapCanvas center={center}>
          <FitRoute route={session.route} />
          <MapFollowController
            center={center}
            follow={follow}
            speedMps={lastFix?.speedMps ?? null}
          />
          <RouteLayer
            route={session.route}
            state={state}
            targetType={session.targetType}
            destination={
              session.waypoints.at(-1) ?? {
                lng: session.route.geometry.coordinates.at(-1)![0],
                lat: session.route.geometry.coordinates.at(-1)![1],
              }
            }
          />
          <SmoothDriverMarker
            position={driverPosition}
            recordedAt={lastFix?.recordedAt ?? null}
            heading={lastFix?.headingDeg ?? null}
          />
          <FollowControls onManualPan={onManualPan} />
        </MapCanvas>
        <div className="absolute bottom-4 right-3 z-[500] flex flex-col gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 shadow-lg"
            onClick={() => setFollow(true)}
          >
            <LocateFixed className="size-4" /> {follow ? 'Following' : 'Recenter'}
          </Button>
          {state?.status === 'ARRIVED' && session.targetType === 'PICKUP' ? (
            <Button
              size="sm"
              className="min-h-11 shadow-lg"
              loading={confirmingPickup}
              onClick={() => void confirmPickup()}
            >
              Confirm pickup
            </Button>
          ) : state?.status === 'ARRIVED' ? (
            <Button
              size="sm"
              className="min-h-11 shadow-lg"
              loading={confirmingArrival}
              onClick={() => void confirmArrival()}
            >
              Confirm arrival
            </Button>
          ) : (
            <Button
              variant="danger"
              size="sm"
              className="min-h-11 shadow-lg"
              onClick={() => setEndConfirmationOpen(true)}
            >
              End navigation
            </Button>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-[400] -translate-x-1/2 rounded bg-base-100/90 px-2 py-1 text-[10px] text-base-content/70">
          © OpenStreetMap contributors · ODbL
        </div>
      </div>
      <p className="bg-base-100 px-3 py-2 text-center text-[11px] text-base-content/55">
        Driver aid only. Follow posted signs and traffic laws; this is not certified navigation
        software.
      </p>
      <ConfirmDialog
        open={endConfirmationOpen}
        title="End navigation?"
        message="This stops route guidance and returns you to the shipment. The delivery remains assigned to you, and its status will not change."
        confirmLabel="End navigation"
        cancelLabel="Keep navigating"
        busy={ending}
        onCancel={() => {
          if (!ending) setEndConfirmationOpen(false)
        }}
        onConfirm={() => void endNavigation()}
      />
    </div>
  )
}
