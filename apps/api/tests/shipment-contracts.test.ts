import {
  createShipmentSchema,
  listShipmentsQuerySchema,
  shipmentIdParamsSchema,
  transitionShipmentSchema,
} from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

describe('shipment contracts', () => {
  const validShipment = {
    pickupAddress: 'Ikeja, Lagos',
    pickup: { lat: 6.6018, lng: 3.3515 },
    dropoffAddress: 'Victoria Island, Lagos',
    dropoff: { lat: 6.4281, lng: 3.4219 },
    weightKg: 2.5,
  }

  it('defaults priority and rejects out-of-range or reversed coordinates', () => {
    expect(createShipmentSchema.parse(validShipment).priority).toBe('NORMAL')
    expect(
      createShipmentSchema.safeParse({ ...validShipment, pickup: { lat: 91, lng: 3 } }).success,
    ).toBe(false)
    expect(
      createShipmentSchema.safeParse({ ...validShipment, dropoff: { lat: 6, lng: 181 } }).success,
    ).toBe(false)
  })

  it('rejects negative weight and invalid tracking search dates', () => {
    expect(createShipmentSchema.safeParse({ ...validShipment, weightKg: -1 }).success).toBe(false)
    expect(
      listShipmentsQuerySchema.safeParse({
        from: '2026-11-18T00:00:00.000Z',
        to: '2026-11-17T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })

  it('validates transition statuses and optional event location', () => {
    expect(transitionShipmentSchema.safeParse({ toStatus: 'IN_TRANSIT' }).success).toBe(true)
    expect(
      transitionShipmentSchema.safeParse({ toStatus: 'IN_TRANSIT', location: { lat: 100, lng: 3 } })
        .success,
    ).toBe(false)
  })

  it('accepts canonical PostgreSQL UUID values regardless of RFC version bits', () => {
    expect(
      shipmentIdParamsSchema.safeParse({
        shipmentId: '9a9b12ae-2705-87a2-399d-e7b3e8641809',
      }).success,
    ).toBe(true)
    expect(shipmentIdParamsSchema.safeParse({ shipmentId: 'not-a-uuid' }).success).toBe(false)
  })
})
