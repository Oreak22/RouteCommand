import { EventEmitter } from 'node:events'

import type { RegisterAfterCommit } from '../../db/pool.js'

export interface DomainEventMap {
  'driver.statusChanged': {
    driverId: string
    userId: string
    previousStatus: string
    status: string
    occurredAt: string
    actorId: string | null
  }
  'driver.vehicleAssigned': {
    driverId: string
    vehicleId: string | null
    actorId: string
    occurredAt: string
  }
  'telemetry.received': {
    driverId: string
    lat: number
    lng: number
    accuracyM: number
    speedMps: number | null
    headingDeg: number | null
    recordedAt: string
    receivedAt: string
  }
  'geofence.crossed': { driverId: string; zoneId: string; direction: 'ENTER' | 'EXIT' }
  'shipment.requested': {
    shipmentId: string
    customerId: string
    trackingCode: string
    eventId: string
  }
  'shipment.assigned': {
    shipmentId: string
    driverId: string
    dispatcherId: string
    trackingCode: string
    eventId: string
  }
  'shipment.statusChanged': {
    shipmentId: string
    eventId: string
    previousStatus: string
    status: string
    actorId: string | null
  }
  'shipment.cancelled': {
    shipmentId: string
    actorId: string
    actorRole: string
    reason: string
    previousStatus: string
    previousDriverId: string | null
    eventId: string
  }
  'shipment.suggested': {
    shipmentId: string
    driverId: string
    suggestedStatus: 'PICKED_UP' | 'ARRIVED'
    reason: 'DEPOT_GEOFENCE' | 'NEAR_DROPOFF'
  }
  'alert.created': { alertId: string; type: string; severity: string }
  'alert.updated': { alertId: string; status: string; actorId: string }
  'zone.updated': {
    zoneId: string
    action: 'created' | 'updated' | 'deactivated'
    updatedAt: string
  }
  'security.event': { securityEventId: string; type: string; severity: string }
  'security.signal': {
    type: string
    actorId?: string
    userId?: string
    email?: string
    ip?: string
    userAgent?: string
    occurredAt: string
    evidence?: Record<string, string | number | boolean>
  }
  'navigation.offRoute': { navigationSessionId: string; driverId: string; shipmentId: string }
  'navigation.arrived': { navigationSessionId: string; driverId: string; shipmentId: string }
  'navigation.route': {
    id: string
    driverId: string
    shipmentId: string
    trackingCode: string
    status: string
    route: unknown
    distanceM: number
    durationS: number
  }
  'navigation.progress': {
    navigationSessionId: string
    driverId: string
    shipmentId: string
    trackingCode: string
    stepIndex: number
    remainingDistanceM: number
    etaSeconds: number
    offRoute: boolean
    status: 'ON_ROUTE' | 'OFF_ROUTE' | 'ESTIMATED' | 'ARRIVED'
    occurredAt: string
    changed: boolean
  }
  'navigation.rerouted': {
    id: string
    driverId: string
    shipmentId: string
    route: unknown
    status: string
  }
  'navigation.ended': {
    id: string
    driverId: string
    shipmentId: string
    reason: string
    status?: string
  }
}

export type DomainEventName = keyof DomainEventMap
export type DomainEventListener<EventName extends DomainEventName> = (
  payload: DomainEventMap[EventName],
) => void

export class DomainEventBus {
  private readonly emitter = new EventEmitter()

  subscribe<EventName extends DomainEventName>(
    eventName: EventName,
    listener: DomainEventListener<EventName>,
  ): () => void {
    this.emitter.on(eventName, listener)
    return () => this.emitter.off(eventName, listener)
  }

  publish<EventName extends DomainEventName>(
    eventName: EventName,
    payload: DomainEventMap[EventName],
  ): void {
    this.emitter.emit(eventName, payload)
  }

  publishAfterCommit<EventName extends DomainEventName>(
    afterCommit: RegisterAfterCommit,
    eventName: EventName,
    payload: DomainEventMap[EventName],
  ): void {
    afterCommit(() => {
      this.emitter.emit(eventName, payload)
    })
  }
}

export const domainEventBus = new DomainEventBus()
