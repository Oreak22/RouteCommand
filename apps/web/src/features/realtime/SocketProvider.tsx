import type { ServerToClientEvents } from '@routecommand/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { io } from 'socket.io-client'

import { SocketContext } from './socket-context'
import type { AppSocket, RealtimeStatus } from './socket-context'
import { useLivePositionStore } from './store/live-position-store'
import { accessTokenExpiresAt, currentAccessToken, refreshRequest } from '../auth/auth-client'
import { useAuth } from '../auth/auth-context'

const singleton: AppSocket = io(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000', {
  autoConnect: false,
  auth: (callback) => callback({ accessToken: currentAccessToken() }),
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
  transports: ['websocket', 'polling'],
})

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const [status, setStatus] = useState<RealtimeStatus>('offline')
  const [shipmentRooms] = useState(() => new Set<string>())
  const [publicRooms] = useState(() => new Set<string>())
  const socket = user ? singleton : null

  const subscribeShipment = useCallback(
    (shipmentId: string) => {
      shipmentRooms.add(shipmentId)
      if (singleton?.connected)
        singleton.emit('subscribe:shipment', { shipmentId }, () => undefined)
    },
    [shipmentRooms],
  )
  const unsubscribeShipment = useCallback(
    (shipmentId: string) => {
      shipmentRooms.delete(shipmentId)
      if (singleton?.connected)
        singleton.emit('unsubscribe:shipment', { shipmentId }, () => undefined)
    },
    [shipmentRooms],
  )
  const subscribePublicTracking = useCallback(
    (trackingCode: string) => {
      publicRooms.add(trackingCode)
      if (singleton?.connected)
        singleton.emit('public:subscribe', { trackingCode }, () => undefined)
    },
    [publicRooms],
  )
  const unsubscribePublicTracking = useCallback(
    (trackingCode: string) => {
      publicRooms.delete(trackingCode)
      if (singleton?.connected)
        singleton.emit('public:unsubscribe', { trackingCode }, () => undefined)
    },
    [publicRooms],
  )

  useEffect(() => {
    if (loading) return
    if (!user) {
      singleton.disconnect()
      useLivePositionStore.getState().clear()
      return
    }

    singleton.auth = { accessToken: currentAccessToken() }

    const onConnect = () => {
      setStatus('connected')
      if (user.role === 'ADMIN' || user.role === 'DISPATCHER') {
        singleton.emit('ops:snapshot:request', () => undefined)
      }
      for (const shipmentId of shipmentRooms) {
        singleton.emit('subscribe:shipment', { shipmentId }, () => undefined)
      }
      for (const trackingCode of publicRooms) {
        singleton.emit('public:subscribe', { trackingCode }, () => undefined)
      }
    }
    const onDisconnect = () => setStatus('reconnecting')
    const onConnectError = () => setStatus('reconnecting')
    const onPosition: ServerToClientEvents['driver:position'] = (event) =>
      useLivePositionStore.getState().applyPosition(event)
    const onSnapshot: ServerToClientEvents['ops:snapshot'] = (event) =>
      useLivePositionStore.getState().applySnapshot(event)
    const onNotice: ServerToClientEvents['system:notice'] = (event) => {
      if (event.code === 'AUTH_EXPIRED') setStatus('reconnecting')
    }

    singleton.on('connect', onConnect)
    singleton.on('disconnect', onDisconnect)
    singleton.on('connect_error', onConnectError)
    singleton.on('driver:position', onPosition)
    singleton.on('ops:snapshot', onSnapshot)
    singleton.on('system:notice', onNotice)
    singleton.connect()

    const expiresAt = accessTokenExpiresAt()
    const refreshTimer = expiresAt
      ? setTimeout(
          () => {
            void refreshRequest().then((refreshedUser) => {
              const accessToken = currentAccessToken()
              if (!refreshedUser || !accessToken || !singleton.connected) return
              singleton.emit('auth:refresh', { accessToken }, (result) => {
                if (!result.ok) singleton.disconnect()
              })
            })
          },
          Math.max(0, expiresAt - Date.now() - 60_000),
        )
      : undefined

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      singleton.off('connect', onConnect)
      singleton.off('disconnect', onDisconnect)
      singleton.off('connect_error', onConnectError)
      singleton.off('driver:position', onPosition)
      singleton.off('ops:snapshot', onSnapshot)
      singleton.off('system:notice', onNotice)
    }
  }, [loading, user, shipmentRooms, publicRooms])

  const visibleStatus: RealtimeStatus = user
    ? status === 'offline'
      ? 'connecting'
      : status
    : 'offline'
  const value = useMemo(
    () => ({
      socket,
      status: visibleStatus,
      subscribeShipment,
      unsubscribeShipment,
      subscribePublicTracking,
      unsubscribePublicTracking,
    }),
    [
      socket,
      visibleStatus,
      subscribeShipment,
      unsubscribeShipment,
      subscribePublicTracking,
      unsubscribePublicTracking,
    ],
  )
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}
