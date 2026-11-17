import { driverStatuses, zoneTypes } from '@routecommand/shared'
import type { ZoneType } from '@routecommand/shared'

export { driverStatuses }
export type { ZoneType }
export const shipmentStatuses = [
  'CREATED',
  'ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED',
  'DELIVERED',
  'CANCELLED',
  'FAILED_DELIVERY',
  'RETURNED',
] as const
export const alertSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type DriverStatus = (typeof driverStatuses)[number]
export type ShipmentStatus = (typeof shipmentStatuses)[number]
export type AlertSeverity = (typeof alertSeverities)[number]
export { zoneTypes }

const tokens: Record<string, string> = {
  'driver:AVAILABLE': 'bg-driver-available/15 text-driver-available ring-driver-available/25',
  'driver:BUSY': 'bg-driver-busy/15 text-driver-busy ring-driver-busy/25',
  'driver:OFFLINE': 'bg-driver-offline/15 text-driver-offline ring-driver-offline/25',
  'driver:ON_BREAK': 'bg-driver-break/15 text-driver-break ring-driver-break/25',
  'shipment:CREATED': 'bg-shipment-created/15 text-shipment-created ring-shipment-created/25',
  'shipment:ASSIGNED': 'bg-shipment-assigned/15 text-shipment-assigned ring-shipment-assigned/25',
  'shipment:ACCEPTED': 'bg-shipment-assigned/15 text-shipment-assigned ring-shipment-assigned/25',
  'shipment:PICKED_UP': 'bg-shipment-transit/15 text-shipment-transit ring-shipment-transit/25',
  'shipment:IN_TRANSIT': 'bg-shipment-transit/15 text-shipment-transit ring-shipment-transit/25',
  'shipment:ARRIVED': 'bg-shipment-transit/15 text-shipment-transit ring-shipment-transit/25',
  'shipment:DELIVERED':
    'bg-shipment-delivered/15 text-shipment-delivered ring-shipment-delivered/25',
  'shipment:CANCELLED':
    'bg-shipment-cancelled/15 text-shipment-cancelled ring-shipment-cancelled/25',
  'shipment:FAILED_DELIVERY':
    'bg-shipment-cancelled/15 text-shipment-cancelled ring-shipment-cancelled/25',
  'shipment:RETURNED':
    'bg-shipment-cancelled/15 text-shipment-cancelled ring-shipment-cancelled/25',
  'alert:LOW': 'bg-alert-low/15 text-alert-low ring-alert-low/25',
  'alert:MEDIUM': 'bg-alert-medium/15 text-alert-medium ring-alert-medium/25',
  'alert:HIGH': 'bg-alert-high/15 text-alert-high ring-alert-high/25',
  'alert:CRITICAL': 'bg-alert-critical/15 text-alert-critical ring-alert-critical/25',
  'zone:DELIVERY': 'bg-zone-delivery/15 text-zone-delivery ring-zone-delivery/25',
  'zone:RESTRICTED': 'bg-zone-restricted/15 text-zone-restricted ring-zone-restricted/25',
  'zone:DEPOT': 'bg-zone-depot/15 text-zone-depot ring-zone-depot/25',
  'zone:CUSTOM': 'bg-zone-custom/15 text-zone-custom ring-zone-custom/25',
}

export function getStatusColor(category: 'driver', status: DriverStatus): string
export function getStatusColor(category: 'shipment', status: ShipmentStatus): string
export function getStatusColor(category: 'alert', status: AlertSeverity): string
export function getStatusColor(category: 'zone', status: ZoneType): string
export function getStatusColor(
  category: 'driver' | 'shipment' | 'alert' | 'zone',
  status: DriverStatus | ShipmentStatus | AlertSeverity | ZoneType,
): string
export function getStatusColor(
  category: 'driver' | 'shipment' | 'alert' | 'zone',
  status: DriverStatus | ShipmentStatus | AlertSeverity | ZoneType,
): string {
  return tokens[`${category}:${status}`] ?? 'bg-neutral text-neutral-content ring-neutral/25'
}
