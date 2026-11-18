import type { ShipmentStatus, UserRole } from '@routecommand/shared'

import { ConflictError } from '../../core/errors/app-error.js'

export type ShipmentTransition = {
  from: ShipmentStatus
  to: ShipmentStatus
  roles: readonly UserRole[]
  assignedDriverOnly?: boolean
}

const dispatcherRoles = ['ADMIN', 'DISPATCHER'] as const
const driverRole = ['DRIVER'] as const

export const shipmentTransitions: readonly ShipmentTransition[] = [
  { from: 'CREATED', to: 'ASSIGNED', roles: dispatcherRoles },
  { from: 'ASSIGNED', to: 'ACCEPTED', roles: driverRole, assignedDriverOnly: true },
  { from: 'ASSIGNED', to: 'CREATED', roles: driverRole, assignedDriverOnly: true },
  { from: 'ACCEPTED', to: 'PICKED_UP', roles: driverRole, assignedDriverOnly: true },
  { from: 'ACCEPTED', to: 'CREATED', roles: driverRole, assignedDriverOnly: true },
  { from: 'PICKED_UP', to: 'IN_TRANSIT', roles: driverRole, assignedDriverOnly: true },
  { from: 'IN_TRANSIT', to: 'ARRIVED', roles: driverRole, assignedDriverOnly: true },
  { from: 'IN_TRANSIT', to: 'RETURNED', roles: driverRole, assignedDriverOnly: true },
  { from: 'ARRIVED', to: 'DELIVERED', roles: driverRole, assignedDriverOnly: true },
  { from: 'DELIVERED', to: 'FAILED_DELIVERY', roles: dispatcherRoles },
  { from: 'FAILED_DELIVERY', to: 'IN_TRANSIT', roles: driverRole, assignedDriverOnly: true },
  {
    from: 'FAILED_DELIVERY',
    to: 'RETURNED',
    roles: [...dispatcherRoles, ...driverRole],
    assignedDriverOnly: true,
  },
]

export function getAllowedShipmentTransitions(
  status: ShipmentStatus,
  role: UserRole,
  isAssignedDriver: boolean,
): ShipmentStatus[] {
  return shipmentTransitions
    .filter(
      (transition) =>
        transition.from === status &&
        transition.roles.includes(role) &&
        (!transition.assignedDriverOnly || role !== 'DRIVER' || isAssignedDriver),
    )
    .map((transition) => transition.to)
}

export function canCancelShipment(
  status: ShipmentStatus,
  role: UserRole,
  ownsShipment: boolean,
): boolean {
  if (role === 'CUSTOMER') {
    return ownsShipment && ['CREATED', 'ASSIGNED', 'ACCEPTED'].includes(status)
  }
  if (role === 'ADMIN' || role === 'DISPATCHER') {
    return !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(status)
  }
  return false
}

export function assertShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
  role: UserRole,
  isAssignedDriver: boolean,
): void {
  const allowedStatuses = getAllowedShipmentTransitions(from, role, isAssignedDriver)
  if (!allowedStatuses.includes(to)) {
    throw new ConflictError('This shipment transition is not allowed.', {
      from,
      requested: to,
      allowedStatuses,
    })
  }
}

export function assertSystemShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (from !== 'ASSIGNED' || to !== 'CREATED') {
    throw new ConflictError('This automated shipment transition is not allowed.', { from, to })
  }
}
