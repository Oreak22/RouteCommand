import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { env } from '../src/config/env.js'
import { hashPassword, verifyAccessToken, verifyPassword } from '../src/modules/auth/service.js'

describe('auth cryptography', () => {
  it('stores passwords with Argon2id and verifies only the matching password', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(hash).toMatch(/^\$argon2id\$/)
    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('accepts a correctly signed JWT with the required claims and rejects tampering', async () => {
    const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET)
    const token = await new SignJWT({ role: 'DISPATCHER', sid: 'session-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('routecommand-api')
      .setAudience('routecommand-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key)

    const claims = await verifyAccessToken(token)
    expect(claims).toMatchObject({
      userId: 'user-1',
      role: 'DISPATCHER',
      sessionId: 'session-1',
    })
    expect(claims.expiresAt).toBeGreaterThan(Date.now())
    await expect(verifyAccessToken(`${token}tampered`)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects tokens signed with an unapproved algorithm', async () => {
    const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET)
    const token = await new SignJWT({ role: 'ADMIN', sid: 'session-2' })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('user-1')
      .setIssuer('routecommand-api')
      .setAudience('routecommand-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key)

    await expect(verifyAccessToken(token)).rejects.toMatchObject({ statusCode: 401 })
  })
})
