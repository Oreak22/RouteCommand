import type { TelemetryBatchInput, TelemetryPointInput, UserRole } from './index.js'

export interface DriverPositionEvent extends TelemetryPointInput {
  driverId: string
  sequence: number
  receivedAt: string
}

export interface DriverStatusEvent {
  driverId: string
  status: string
  occurredAt: string
}

export interface ShipmentUpdatedEvent {
  shipmentId: string
  status?: string
  trackingCode?: string
}

export interface ZoneUpdatedEvent {
  zoneId: string
  action: 'created' | 'updated' | 'deactivated'
  updatedAt: string
}

export interface OpsSnapshotEvent {
  generatedAt: string
  positions: DriverPositionEvent[]
}

export interface SystemNoticeEvent {
  code: string
  message: string
}

export interface TelemetryAck {
  ok: boolean
  queued?: number
  filtered?: number
  liveUpdated?: number
  code?: string
  message?: string
}

export interface RoomAck {
  ok: boolean
  code?: string
}

export interface ServerToClientEvents {
  'driver:position': (event: DriverPositionEvent) => void
  'driver:status': (event: DriverStatusEvent) => void
  'shipment:updated': (event: ShipmentUpdatedEvent) => void
  'alert:created': (event: { alertId: string; type: string; severity: string }) => void
  'alert:updated': (event: { alertId: string; status: string }) => void
  'zone:updated': (event: ZoneUpdatedEvent) => void
  'system:notice': (event: SystemNoticeEvent) => void
  'ops:snapshot': (event: OpsSnapshotEvent) => void
}

export interface ClientToServerEvents {
  'telemetry:update': (point: TelemetryPointInput, ack: (result: TelemetryAck) => void) => void
  'telemetry:batch': (batch: TelemetryBatchInput, ack: (result: TelemetryAck) => void) => void
  'subscribe:shipment': (input: { shipmentId: string }, ack: (result: RoomAck) => void) => void
  'unsubscribe:shipment': (input: { shipmentId: string }, ack: (result: RoomAck) => void) => void
  'public:subscribe': (input: { trackingCode: string }, ack: (result: RoomAck) => void) => void
  'public:unsubscribe': (input: { trackingCode: string }, ack: (result: RoomAck) => void) => void
  'ops:snapshot:request': (ack?: (result: RoomAck) => void) => void
  'auth:refresh': (input: { accessToken: string }, ack: (result: RoomAck) => void) => void
  ping: (ack?: (result: { pong: number }) => void) => void
}

export interface SocketIdentity {
  userId: string
  role: UserRole
  driverId?: string
}
