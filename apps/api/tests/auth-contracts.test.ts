import {
  createManagedUserSchema,
  registerSchema,
  updateManagedUserSchema,
} from '@routecommand/shared'
import { describe, expect, it } from 'vitest'

describe('auth and account contracts', () => {
  it('only accepts public self-registration fields and strips unknown fields', () => {
    const parsed = registerSchema.parse({
      email: 'customer@example.test',
      password: 'customer-password-123',
      name: 'Customer Example',
      role: 'ADMIN',
      ignored: true,
    })
    expect(parsed).toEqual({
      email: 'customer@example.test',
      password: 'customer-password-123',
      name: 'Customer Example',
    })
  })

  it('requires a driver license when an administrator provisions a driver', () => {
    const result = createManagedUserSchema.safeParse({
      email: 'driver@example.test',
      password: 'driver-password-123',
      name: 'Driver Example',
      role: 'DRIVER',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['licenseNo'])
  })

  it('does not allow a patch containing only driver metadata', () => {
    expect(updateManagedUserSchema.safeParse({ licenseNo: 'LIC-1' }).success).toBe(false)
  })
})
