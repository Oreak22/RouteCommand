import { BatteryLow, Download, LocateFixed, MapPin, Signal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { useAuth } from '../../auth/auth-context'
import type { Driver } from '../../drivers/api/client'
import { useDriverTelemetry } from '../driver-telemetry-context'
import {
  getQueuedShipmentActionCounts,
  offlineQueueChangedEvent,
  readFailedShipmentActions,
  removeQueuedShipmentAction,
  type QueuedShipmentAction,
} from '../offline-telemetry-store'
import { promptPwaInstall, usePwaInstallPrompt } from '../pwa-install-prompt'

function formatFixTime(recordedAt: string | null) {
  if (!recordedAt) return 'Waiting for a location fix'
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(recordedAt))
}

function formatFixAge(recordedAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(recordedAt)) / 1_000))
  if (seconds < 60) return 'just now'
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3_600)} hr ago`
}

export function DriverTelemetryCard({ driver }: { driver: Driver }) {
  const { user } = useAuth()
  const shiftActive = driver.status !== 'OFFLINE' && driver.status !== 'ON_BREAK'
  const tracker = useDriverTelemetry()
  const [online, setOnline] = useState(navigator.onLine)
  const installPrompt = usePwaInstallPrompt()
  const [installError, setInstallError] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [actionCounts, setActionCounts] = useState({ pending: 0, failed: 0 })
  const [failedActions, setFailedActions] = useState<QueuedShipmentAction[]>([])

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let active = true
    const updateQueue = async () => {
      if (!user?.id) return
      const [counts, failures] = await Promise.all([
        getQueuedShipmentActionCounts(user.id),
        readFailedShipmentActions(user.id),
      ])
      if (active) {
        setActionCounts(counts)
        setFailedActions(failures)
      }
    }
    void updateQueue().catch(() => undefined)
    window.addEventListener(offlineQueueChangedEvent, updateQueue)
    return () => {
      active = false
      window.removeEventListener(offlineQueueChangedEvent, updateQueue)
    }
  }, [user?.id])

  const qualityColor =
    tracker.quality === 'good'
      ? 'text-success'
      : tracker.quality === 'fair'
        ? 'text-warning'
        : tracker.quality === 'poor'
          ? 'text-error'
          : 'text-base-content/50'
  const captureLabel =
    tracker.captureState === 'watching'
      ? tracker.lastFix
        ? 'Sharing location'
        : 'Waiting for first location fix'
      : tracker.captureState === 'denied'
        ? 'Location permission needed'
        : tracker.captureState === 'unsupported'
          ? 'Location unavailable'
          : 'Location sharing stopped'

  async function installApp() {
    if (!installPrompt) return
    setInstallError(null)
    try {
      await promptPwaInstall(installPrompt)
    } catch {
      setInstallError('The install prompt could not be opened. Use your browser menu to install.')
    }
  }

  const iosInstallHelp =
    !installPrompt &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches
  const staleFix =
    tracker.lastFix !== null && clock - Date.parse(tracker.lastFix.recordedAt) > 45_000

  return (
    <Card aria-label="Driver location and offline sync">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/55">
            Location & sync
          </p>
          <p className="mt-2 flex items-center gap-2 font-medium">
            <Signal className={`size-4 ${qualityColor}`} aria-hidden="true" />
            {captureLabel}
          </p>
          <p className="mt-1 text-xs text-base-content/55">
            {tracker.lastFix
              ? `Updated ${formatFixAge(tracker.lastFix.recordedAt)} · accuracy ±${Math.round(tracker.lastFix.accuracyM)} m`
              : 'Location is shared only while you are on shift and have started sharing.'}
          </p>
          {staleFix && (
            <p className="mt-2 text-xs text-warning" role="status">
              No fresh GPS fix. Check that location is enabled and your device has a clear signal.
            </p>
          )}
          {tracker.permissionState === 'prompt' && tracker.captureState !== 'watching' && (
            <p className="mt-2 text-xs text-base-content/65">
              Your browser will ask for location access when you start sharing.
            </p>
          )}
          {tracker.permissionState === 'denied' && (
            <p className="mt-2 text-xs text-warning">
              Location is blocked. Allow it for this site in browser settings, then retry.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {tracker.captureState === 'watching' ? (
            <Button size="sm" variant="outline" onClick={tracker.stop}>
              Stop sharing
            </Button>
          ) : (
            <Button size="sm" onClick={tracker.start} disabled={!shiftActive}>
              <LocateFixed className="size-4" aria-hidden="true" /> Start sharing
            </Button>
          )}
          {installPrompt && (
            <Button size="sm" variant="outline" onClick={() => void installApp()}>
              <Download className="size-4" aria-hidden="true" /> Install app
            </Button>
          )}
          {iosInstallHelp && (
            <p className="max-w-48 text-xs text-base-content/60">
              Install: tap Share in Safari, then Add to Home Screen.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-base-content/10 pt-3 text-xs">
        <span
          className={`inline-flex items-center gap-1.5 ${online ? 'text-success' : 'text-warning'}`}
        >
          <span className={`size-1.5 rounded-full ${online ? 'bg-success' : 'bg-warning'}`} />
          {online ? 'Online' : 'Offline'}
        </span>
        <span className="inline-flex items-center gap-1.5 text-base-content/65">
          <MapPin className="size-3.5" aria-hidden="true" />
          {tracker.quality === 'unknown'
            ? 'GPS quality pending'
            : `${tracker.quality[0]?.toUpperCase()}${tracker.quality.slice(1)} GPS quality`}
        </span>
        <span className="inline-flex items-center gap-1.5 text-base-content/65">
          <BatteryLow className="size-3.5" aria-hidden="true" />
          {tracker.pendingCount} location updates pending
        </span>
        <span className="text-base-content/50">
          {tracker.syncState === 'syncing'
            ? 'Syncing…'
            : tracker.pendingCount === 0 && tracker.lastSyncedAt
              ? `Synced ${formatFixTime(tracker.lastSyncedAt)}`
              : tracker.realtimeStatus === 'connected'
                ? 'Realtime link ready'
                : 'Will sync when connected'}
        </span>
        {tracker.captureState === 'watching' && (
          <span className="text-base-content/50">
            {tracker.wakeLockActive ? 'Screen kept awake' : 'Screen may sleep while sharing'}
          </span>
        )}
        {tracker.pendingCount > 0 && online && tracker.syncState !== 'syncing' && (
          <Button size="sm" variant="ghost" onClick={() => void tracker.flush()}>
            Sync now
          </Button>
        )}
        {actionCounts.pending > 0 && (
          <Link className="text-primary hover:underline" to="/driver/shipments">
            {actionCounts.pending} job {actionCounts.pending === 1 ? 'update' : 'updates'} waiting
            to sync
          </Link>
        )}
      </div>

      {failedActions.length > 0 && (
        <div className="mt-3 space-y-2" aria-label="Job updates needing review">
          {failedActions.map((action) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-warning/10 p-3 text-sm"
              key={action.id}
            >
              <p className="min-w-0 flex-1" role="alert">
                {action.idempotencyKey &&
                  `Saved ${action.toStatus.toLowerCase().replaceAll('_', ' ')} update could not be applied.`}
                {action.lastError ? ` ${action.lastError}` : ''}
              </p>
              <Link
                className="btn btn-ghost btn-sm"
                to="/driver/shipments"
                state={{ selectedShipmentId: action.shipmentId }}
              >
                Review job
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void removeQueuedShipmentAction(action.id)}
              >
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {!online && (
        <p className="mt-3 rounded-field bg-warning/10 p-3 text-sm text-warning" role="status">
          Offline. Location fixes and job changes stay on this device and will sync when you
          reconnect.
        </p>
      )}

      {tracker.errorMessage && (
        <p className="mt-3 rounded-field bg-warning/10 p-3 text-sm" role="status">
          {tracker.errorMessage}
        </p>
      )}
      {installError && (
        <p className="mt-3 text-sm text-warning" role="status">
          {installError}
        </p>
      )}
    </Card>
  )
}
