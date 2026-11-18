import type { TelemetryPointInput } from '@routecommand/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { authenticatedFetch } from '../auth/auth-client'
import { useAuth } from '../auth/auth-context'
import type { AppSocket } from '../realtime/socket-context'
import { useRealtime } from '../realtime/useRealtime'
import {
  countQueuedTelemetry,
  queueTelemetryPoint,
  readQueuedTelemetry,
  removeQueuedTelemetry,
} from './offline-telemetry-store'

type CaptureState = 'idle' | 'watching' | 'denied' | 'unsupported' | 'error'
type PermissionState = 'prompt' | 'granted' | 'denied' | 'unknown'
type SyncState = 'idle' | 'syncing' | 'error'
type BatteryStatus = {
  level: number
  charging: boolean
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}
type WakeLockSentinel = {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
  removeEventListener: (type: 'release', listener: () => void) => void
}

export interface GnssFix {
  lat: number
  lng: number
  accuracyM: number
  speedMps: number | null
  headingDeg: number | null
  recordedAt: string
}

function distanceMeters(first: GnssFix, second: GnssFix): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latDelta = radians(second.lat - first.lat)
  const lngDelta = radians(second.lng - first.lng)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(lngDelta / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function sendWithHttp(points: TelemetryPointInput[]) {
  const response = await authenticatedFetch('/api/v1/telemetry/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points }),
  })
  const payload = (await response.json()) as {
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(payload.error?.message ?? 'Telemetry could not be synchronized.')
  }
}

function sendWithSocket(socket: AppSocket, points: TelemetryPointInput[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Telemetry sync timed out.')), 12_000)
    socket.emit('telemetry:batch', { points }, (result) => {
      window.clearTimeout(timeout)
      if (result.ok) resolve()
      else reject(new Error(result.message ?? 'Telemetry could not be synchronized.'))
    })
  })
}

export function useGnssTracker(shiftActive: boolean) {
  const { user } = useAuth()
  const { socket, status: realtimeStatus } = useRealtime()
  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const [permissionState, setPermissionState] = useState<PermissionState>('unknown')
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [pendingCount, setPendingCount] = useState(0)
  const [lastFix, setLastFix] = useState<GnssFix | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [wakeLockActive, setWakeLockActive] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const watchId = useRef<number | null>(null)
  const captureToken = useRef(0)
  const lastAcceptedFix = useRef<GnssFix | null>(null)
  const lastAcceptedAt = useRef(0)
  const flushing = useRef(false)
  const flushTimer = useRef<number | null>(null)
  const retryTimer = useRef<number | null>(null)
  const retryAfter = useRef(0)
  const retryDelayMs = useRef(2_000)
  const flushCallback = useRef<() => Promise<void>>(async () => undefined)
  const batteryPct = useRef<number | null>(null)
  const lowBattery = useRef(false)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const batteryRef = useRef<BatteryStatus | null>(null)
  const batteryListener = useRef<(() => void) | null>(null)

  const flush = useCallback(async () => {
    if (!user?.id || !navigator.onLine || flushing.current || Date.now() < retryAfter.current)
      return
    flushing.current = true
    setSyncState('syncing')
    try {
      while (navigator.onLine) {
        const entries = await readQueuedTelemetry(user.id, 500)
        if (entries.length === 0) break
        const points = entries.map((entry) => entry.point)
        if (socket?.connected) {
          try {
            await sendWithSocket(socket, points)
          } catch {
            await sendWithHttp(points)
          }
        } else {
          await sendWithHttp(points)
        }
        const remaining = await removeQueuedTelemetry(
          entries.map((entry) => entry.id),
          user.id,
        )
        setPendingCount(remaining)
        setLastSyncedAt(new Date().toISOString())
      }
      setSyncState('idle')
      setErrorMessage(null)
      retryDelayMs.current = 2_000
      retryAfter.current = 0
    } catch (error) {
      setSyncState('error')
      setErrorMessage(
        error instanceof Error ? error.message : 'Offline updates are waiting to sync.',
      )
      const delay = retryDelayMs.current
      retryDelayMs.current = Math.min(retryDelayMs.current * 2, 5 * 60_000)
      retryAfter.current = Date.now() + delay
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      retryTimer.current = window.setTimeout(() => void flushCallback.current(), delay)
    } finally {
      flushing.current = false
    }
  }, [socket, user?.id])

  useEffect(() => {
    if (!('permissions' in navigator)) {
      setPermissionState('unknown')
      return
    }
    let permissionStatus: PermissionStatus | null = null
    let permissionListener: (() => void) | null = null
    let active = true
    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!active) return
        permissionStatus = status
        setPermissionState(status.state === 'prompt' ? 'prompt' : status.state)
        permissionListener = () =>
          setPermissionState(status.state === 'prompt' ? 'prompt' : status.state)
        status.addEventListener('change', permissionListener)
      })
      .catch(() => setPermissionState('unknown'))
    return () => {
      active = false
      if (permissionStatus && permissionListener) {
        permissionStatus.removeEventListener('change', permissionListener)
      }
    }
  }, [])

  useEffect(() => {
    flushCallback.current = flush
  }, [flush])

  useEffect(() => {
    if (user?.id) {
      void countQueuedTelemetry(user.id)
        .then(setPendingCount)
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error ? error.message : 'Offline storage is unavailable.',
          )
        })
    }
    const syncWhenOnline = () => {
      retryAfter.current = 0
      void flushCallback.current()
    }
    window.addEventListener('online', syncWhenOnline)
    const interval = window.setInterval(syncWhenOnline, 15_000)
    return () => {
      window.removeEventListener('online', syncWhenOnline)
      window.clearInterval(interval)
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    }
  }, [user?.id])

  useEffect(() => {
    if (realtimeStatus === 'connected') void flush()
  }, [flush, realtimeStatus])

  const stop = useCallback(() => {
    captureToken.current += 1
    if (watchId.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    if (batteryRef.current && batteryListener.current) {
      batteryRef.current.removeEventListener('levelchange', batteryListener.current)
      batteryRef.current.removeEventListener('chargingchange', batteryListener.current)
      batteryRef.current = null
      batteryListener.current = null
    }
    setCaptureState('idle')
  }, [])

  const start = useCallback(() => {
    if (!shiftActive || user?.role !== 'DRIVER' || !user.id) {
      setErrorMessage('Set your availability to Available before starting location sharing.')
      return
    }
    if (!('geolocation' in navigator)) {
      setCaptureState('unsupported')
      return
    }
    if (watchId.current !== null) return
    captureToken.current += 1
    const token = captureToken.current
    setErrorMessage(null)
    setCaptureState('watching')

    const batteryApi = navigator as Navigator & {
      getBattery?: () => Promise<BatteryStatus>
    }
    void batteryApi
      .getBattery?.()
      .then((battery) => {
        if (token !== captureToken.current) return
        const updateBattery = () => {
          batteryPct.current = Math.round(battery.level * 100)
          lowBattery.current = !battery.charging && battery.level <= 0.2
        }
        updateBattery()
        battery.addEventListener('levelchange', updateBattery)
        battery.addEventListener('chargingchange', updateBattery)
        batteryRef.current = battery
        batteryListener.current = updateBattery
      })
      .catch(() => undefined)

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        if (token !== captureToken.current) return
        setCaptureState('watching')
        setPermissionState('granted')
        const fix: GnssFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          speedMps: position.coords.speed,
          headingDeg: position.coords.heading,
          recordedAt: new Date(
            Math.max(
              position.timestamp,
              (Date.parse(lastAcceptedFix.current?.recordedAt ?? '') || 0) + 1,
            ),
          ).toISOString(),
        }
        setLastFix(fix)
        const now = Date.now()
        const previous = lastAcceptedFix.current
        const elapsedMs = now - lastAcceptedAt.current
        const movedM = previous ? distanceMeters(previous, fix) : Number.POSITIVE_INFINITY
        const minIntervalMs = lowBattery.current ? 4_000 : 2_000
        const minDistanceM = lowBattery.current ? 15 : 5
        const stationaryHeartbeatMs = lowBattery.current ? 30_000 : 15_000
        const shouldRecord =
          !previous ||
          (elapsedMs >= minIntervalMs && movedM >= minDistanceM) ||
          elapsedMs >= stationaryHeartbeatMs
        if (!shouldRecord) return

        lastAcceptedFix.current = fix
        lastAcceptedAt.current = now
        const point: TelemetryPointInput = {
          lat: fix.lat,
          lng: fix.lng,
          accuracyM: fix.accuracyM,
          recordedAt: fix.recordedAt,
          speedMps: fix.speedMps,
          headingDeg: fix.headingDeg,
          ...(batteryPct.current === null ? {} : { batteryPct: batteryPct.current }),
        }
        if (!user?.id) return
        void queueTelemetryPoint(point, user.id)
          .then((count) => {
            setPendingCount(count)
            if (navigator.onLine) {
              if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
              flushTimer.current = window.setTimeout(() => void flushCallback.current(), 1_500)
            }
          })
          .catch((error: unknown) => {
            setSyncState('error')
            setErrorMessage(
              error instanceof Error ? error.message : 'Could not save this fix offline.',
            )
          })
      },
      (error) => {
        if (token !== captureToken.current) return
        if (watchId.current !== null) {
          navigator.geolocation.clearWatch(watchId.current)
          watchId.current = null
        }
        if (batteryRef.current && batteryListener.current) {
          batteryRef.current.removeEventListener('levelchange', batteryListener.current)
          batteryRef.current.removeEventListener('chargingchange', batteryListener.current)
          batteryRef.current = null
          batteryListener.current = null
        }
        const denied = error.code === error.PERMISSION_DENIED
        setCaptureState(denied ? 'denied' : 'error')
        if (denied) setPermissionState('denied')
        setErrorMessage(
          denied
            ? 'Location access is blocked. Allow location access in your browser settings, then try again.'
            : error.code === error.TIMEOUT
              ? 'Location is taking too long. Move to an open area and retry.'
              : 'Your current location is unavailable. Keep the last fix and retry when ready.',
        )
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    )
  }, [shiftActive, user?.id, user?.role])

  useEffect(() => {
    if (captureState !== 'watching') return
    let cancelled = false
    let activeLock: WakeLockSentinel | null = null
    let releaseListener: (() => void) | null = null
    const wakeLockApi = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> }
    }
    const requestWakeLock = () => {
      if (document.visibilityState !== 'visible' || !wakeLockApi.wakeLock || wakeLock.current)
        return
      void wakeLockApi.wakeLock
        .request('screen')
        .then((lock) => {
          if (cancelled) void lock.release()
          else {
            wakeLock.current = lock
            activeLock = lock
            releaseListener = () => {
              if (wakeLock.current === lock) wakeLock.current = null
              setWakeLockActive(false)
              if (document.visibilityState === 'visible') requestWakeLock()
            }
            lock.addEventListener('release', releaseListener)
            setWakeLockActive(true)
          }
        })
        .catch(() => setWakeLockActive(false))
    }
    requestWakeLock()
    document.addEventListener('visibilitychange', requestWakeLock)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', requestWakeLock)
      if (wakeLock.current) {
        const lock = wakeLock.current
        wakeLock.current = null
        if (activeLock === lock && releaseListener) {
          lock.removeEventListener('release', releaseListener)
        }
        void lock.release()
      }
    }
  }, [captureState])

  useEffect(
    () => () => {
      if (watchId.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchId.current)
      }
      if (batteryRef.current && batteryListener.current) {
        batteryRef.current.removeEventListener('levelchange', batteryListener.current)
        batteryRef.current.removeEventListener('chargingchange', batteryListener.current)
      }
    },
    [],
  )

  const quality = !lastFix
    ? 'unknown'
    : lastFix.accuracyM <= 30
      ? 'good'
      : lastFix.accuracyM <= 100
        ? 'fair'
        : 'poor'

  return {
    captureState,
    permissionState,
    syncState,
    pendingCount,
    lastFix,
    lastSyncedAt,
    wakeLockActive,
    errorMessage,
    quality,
    realtimeStatus,
    start,
    stop,
    flush,
  }
}
