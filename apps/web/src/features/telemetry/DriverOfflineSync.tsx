import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { useAuth } from '../auth/auth-context'
import { useRealtime } from '../realtime/useRealtime'
import { shipmentsApi } from '../shipments/api/client'
import { shipmentKeys } from '../shipments/api/hooks'
import {
  markShipmentActionFailed,
  offlineQueueChangedEvent,
  readQueuedShipmentActions,
  removeQueuedShipmentAction,
} from './offline-telemetry-store'

interface ApiError extends Error {
  status?: unknown
}

export function DriverOfflineSync() {
  const { user } = useAuth()
  const { status: realtimeStatus } = useRealtime()
  const queryClient = useQueryClient()
  const syncing = useRef(false)
  const retryDelay = useRef(2_000)
  const retryAt = useRef(0)
  const retryTimer = useRef<number | null>(null)
  const syncRef = useRef<() => Promise<void>>(async () => undefined)

  const sync = useCallback(async () => {
    if (!user?.id || !navigator.onLine || syncing.current || Date.now() < retryAt.current) return
    syncing.current = true
    try {
      const actions = await readQueuedShipmentActions(user.id)
      for (const action of actions) {
        try {
          await shipmentsApi.transition(
            action.shipmentId,
            { toStatus: action.toStatus, ...(action.note ? { note: action.note } : {}) },
            action.idempotencyKey,
          )
          await removeQueuedShipmentAction(action.id)
          await queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
        } catch (error) {
          const status = (error as ApiError).status
          if (typeof status === 'number' && status >= 400 && status < 500) {
            await markShipmentActionFailed(
              action.id,
              error instanceof Error ? error.message : 'This saved job action needs review.',
            )
            continue
          }
          throw error
        }
      }
      retryDelay.current = 2_000
      retryAt.current = 0
    } catch {
      const delay = retryDelay.current
      retryDelay.current = Math.min(delay * 2, 5 * 60_000)
      retryAt.current = Date.now() + delay
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      retryTimer.current = window.setTimeout(() => void syncRef.current(), delay)
    } finally {
      syncing.current = false
    }
  }, [queryClient, user?.id])

  useEffect(() => {
    syncRef.current = sync
  }, [sync])

  useEffect(() => {
    const onOnline = () => {
      retryAt.current = 0
      void syncRef.current()
    }
    const onQueueChanged = () => void syncRef.current()
    window.addEventListener('online', onOnline)
    window.addEventListener(offlineQueueChangedEvent, onQueueChanged)
    const interval = window.setInterval(() => void syncRef.current(), 15_000)
    void syncRef.current()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener(offlineQueueChangedEvent, onQueueChanged)
      window.clearInterval(interval)
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    }
  }, [])

  useEffect(() => {
    if (realtimeStatus === 'connected') void sync()
  }, [realtimeStatus, sync])

  return null
}
