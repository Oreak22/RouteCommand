import {
  createVehicleSchema,
  driverStatusUpdateSchema,
  listDriversQuerySchema,
  nearbyDriversQuerySchema,
  updateDriverSchema,
} from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

describe('fleet API contracts', () => {
  it('bounds nearby searches and the result count', () => {
    expect(nearbyDriversQuerySchema.parse({ lng: 3.4, lat: 6.5 }).limit).toBe(50)
    expect(nearbyDriversQuerySchema.safeParse({ lng: 181, lat: 6 }).success).toBe(false)
    expect(nearbyDriversQuerySchema.safeParse({ lng: 3, lat: 6, radiusM: 100_001 }).success).toBe(
      false,
    )
    expect(nearbyDriversQuerySchema.safeParse({ lng: 3, lat: 6, limit: 51 }).success).toBe(false)
  })

  it('supports bounded driver filters and pagination defaults', () => {
    expect(listDriversQuerySchema.parse({}).limit).toBe(25)
    expect(listDriversQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(listDriversQuerySchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false)
  })

  it('keeps BUSY system-controlled while requiring a non-empty update', () => {
    expect(driverStatusUpdateSchema.safeParse({ status: 'BUSY' }).success).toBe(false)
    expect(updateDriverSchema.safeParse({ status: 'BUSY' }).success).toBe(false)
    expect(updateDriverSchema.safeParse({}).success).toBe(false)
    expect(updateDriverSchema.safeParse({ status: 'ON_BREAK' }).success).toBe(true)
  })

  it('validates a unique-plate vehicle payload shape and positive capacity', () => {
    expect(
      createVehicleSchema.parse({ plate: ' AB-123 ', type: 'VAN', capacityKg: 800 }).plate,
    ).toBe('AB-123')
    expect(
      createVehicleSchema.safeParse({ plate: 'AB-123', type: 'VAN', capacityKg: 0 }).success,
    ).toBe(false)
  })
})
