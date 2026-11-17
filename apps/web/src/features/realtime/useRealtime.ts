import type { ServerToClientEvents } from '@routecommand/shared'
import { useContext, useEffect } from 'react'

import { SocketContext } from './socket-context'

export function useRealtime() {
  const context = useContext(SocketContext)
  if (!context) throw new Error('useRealtime must be used inside SocketProvider.')
  return context
}

export function useSocketEvent<EventName extends keyof ServerToClientEvents>(
  eventName: EventName,
  listener: ServerToClientEvents[EventName],
): void {
  const { socket } = useRealtime()
  useEffect(() => {
    if (!socket) return
    socket.on(eventName, listener as never)
    return () => {
      socket.off(eventName, listener as never)
    }
  }, [socket, eventName, listener])
}
