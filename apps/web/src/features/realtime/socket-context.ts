import type { ClientToServerEvents, ServerToClientEvents } from '@routecommand/shared'
import { createContext } from 'react'
import type { Socket } from 'socket.io-client'

export type RealtimeStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting'
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export interface SocketContextValue {
  socket: AppSocket | null
  status: RealtimeStatus
  subscribeShipment(shipmentId: string): void
  unsubscribeShipment(shipmentId: string): void
  subscribePublicTracking(trackingCode: string): void
  unsubscribePublicTracking(trackingCode: string): void
}

export const SocketContext = createContext<SocketContextValue | null>(null)
