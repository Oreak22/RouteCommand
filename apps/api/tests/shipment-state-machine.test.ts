import { shipmentStatuses, userRoles } from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

import { ConflictError } from '../src/core/errors/app-error.js'
import {
  assertShipmentTransition,
  canCancelShipment,
  getAllowedShipmentTransitions,
} from '../src/modules/shipments/state-machine.js'

const expectedTransitionCases = [
  ['CREATED', 'ASSIGNED', 'ADMIN', false],
  ['CREATED', 'ASSIGNED', 'DISPATCHER', false],
  ['ASSIGNED', 'ACCEPTED', 'DRIVER', true],
  ['ASSIGNED', 'CREATED', 'DRIVER', true],
  ['ACCEPTED', 'PICKED_UP', 'DRIVER', true],
  ['ACCEPTED', 'CREATED', 'DRIVER', true],
  ['PICKED_UP', 'IN_TRANSIT', 'DRIVER', true],
  ['IN_TRANSIT', 'ARRIVED', 'DRIVER', true],
  ['IN_TRANSIT', 'RETURNED', 'DRIVER', true],
  ['ARRIVED', 'DELIVERED', 'DRIVER', true],
  ['DELIVERED', 'FAILED_DELIVERY', 'ADMIN', false],
  ['DELIVERED', 'FAILED_DELIVERY', 'DISPATCHER', false],
  ['FAILED_DELIVERY', 'IN_TRANSIT', 'DRIVER', true],
  ['FAILED_DELIVERY', 'RETURNED', 'DRIVER', true],
  ['FAILED_DELIVERY', 'RETURNED', 'ADMIN', false],
  ['FAILED_DELIVERY', 'RETURNED', 'DISPATCHER', false],
] as const

describe('shipment state machine', () => {
  it('allows every table-defined transition for each permitted role', () => {
    for (const [from, to, role, isAssignedDriver] of expectedTransitionCases) {
      expect(() => assertShipmentTransition(from, to, role, isAssignedDriver)).not.toThrow()
    }
  })

  it('rejects every transition that is absent from the role and state table', () => {
    for (const from of shipmentStatuses) {
      for (const role of userRoles) {
        for (const to of shipmentStatuses) {
          const expectedAllowed = expectedTransitionCases.some(
            ([expectedFrom, expectedTo, expectedRole]) =>
              expectedFrom === from && expectedTo === to && expectedRole === role,
          )
          if (expectedAllowed) {
            expect(() => assertShipmentTransition(from, to, role, true)).not.toThrow()
          } else {
            expect(() => assertShipmentTransition(from, to, role, true)).toThrow(ConflictError)
          }
        }
      }
    }
  })

  it('only exposes assigned-driver actions to the owner of the assigned shipment', () => {
    expect(getAllowedShipmentTransitions('ASSIGNED', 'DRIVER', false)).toEqual([])
    expect(getAllowedShipmentTransitions('ASSIGNED', 'DRIVER', true)).toEqual([
      'ACCEPTED',
      'CREATED',
    ])
    expect(() => assertShipmentTransition('ASSIGNED', 'ACCEPTED', 'DRIVER', false)).toThrow(
      ConflictError,
    )
  })

  it('returns the role-appropriate next states for action controls', () => {
    expect(getAllowedShipmentTransitions('CREATED', 'DISPATCHER', false)).toEqual(['ASSIGNED'])
    expect(getAllowedShipmentTransitions('CREATED', 'CUSTOMER', false)).toEqual([])
    expect(getAllowedShipmentTransitions('IN_TRANSIT', 'DRIVER', true)).toEqual([
      'ARRIVED',
      'RETURNED',
    ])
  })

  it('applies separate customer and dispatcher cancellation windows', () => {
    for (const status of ['CREATED', 'ASSIGNED', 'ACCEPTED'] as const) {
      expect(canCancelShipment(status, 'CUSTOMER', true)).toBe(true)
      expect(canCancelShipment(status, 'CUSTOMER', false)).toBe(false)
      expect(canCancelShipment(status, 'DISPATCHER', false)).toBe(true)
    }
    for (const status of ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FAILED_DELIVERY'] as const) {
      expect(canCancelShipment(status, 'CUSTOMER', true)).toBe(false)
      expect(canCancelShipment(status, 'DISPATCHER', false)).toBe(true)
    }
    for (const status of ['DELIVERED', 'CANCELLED', 'RETURNED'] as const) {
      expect(canCancelShipment(status, 'ADMIN', false)).toBe(false)
    }
    expect(canCancelShipment('ASSIGNED', 'DRIVER', true)).toBe(false)
  })
})
