import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

import type { LoginInput, RegisterInput } from '@routecommand/shared'
import argon2 from 'argon2'
import { SignJWT, jwtVerify } from 'jose'

import {
  createCustomer,
  findRefreshTokenForUpdate,
  findLatestDeviceFingerprint,
  findPublicUserById,
  isSessionActive,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  revokeFamily,
  revokeSession,
  revokeUserSessions,
  rotateRefreshToken,
  updatePasswordHash,
  type UserWithPassword,
} from './repository.js'
import type { AuthRequestContext, AuthUser } from './types.js'
import { env } from '../../config/env.js'
import { BadRequestError, ConflictError, UnauthorizedError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { withTransaction, type DatabaseExecutor } from '../../db/pool.js'
import { queueTransactionalEmail, renderActionEmail } from '../../infra/email-queue.js'
import { approximateIpGeolocation } from '../../infra/geoip.js'
import { redisClient } from '../../infra/redis.js'
import { resolveTelemetryIdentityForUser } from '../drivers/service.js'

const issuer = 'routecommand-api'
const audience = 'routecommand-client'
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET)
const attemptsSecret = env.JWT_REFRESH_SECRET
const maxLoginAttempts = 5
const lockoutSeconds = 15 * 60

export interface AuthSession {
  user: AuthUser
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
}

const publicUser = (user: UserWithPassword): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  isActive: user.isActive,
  emailVerifiedAt: user.emailVerifiedAt,
})

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, password).catch(() => false)
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex')

function coarseIp(ip: string | undefined): string {
  if (!ip) return 'unknown'
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':')
  return ip.split('.').slice(0, 3).join('.')
}

function fingerprint(context: AuthRequestContext): string {
  return createHash('sha256')
    .update(`${context.userAgent ?? 'unknown'}|${coarseIp(context.ip)}`)
    .digest('hex')
}

function attemptKey(kind: string, value: string): string {
  const digest = createHmac('sha256', attemptsSecret).update(value).digest('hex')
  return `routecommand:auth:attempt:${kind}:${digest}`
}

async function enforceLoginLimit(email: string, ip: string | undefined): Promise<void> {
  const keys = [attemptKey('email', email.toLowerCase()), attemptKey('ip', ip ?? 'unknown')]
  const values = await Promise.all(keys.map((key) => redisClient.get(key)))
  if (values.some((value) => Number(value ?? 0) >= maxLoginAttempts)) {
    throw new UnauthorizedError('Invalid email or password.')
  }
}

async function recordFailedLogin(email: string, ip: string | undefined): Promise<number> {
  const keys = [attemptKey('email', email.toLowerCase()), attemptKey('ip', ip ?? 'unknown')]
  const counts = await Promise.all(
    keys.map(async (key) => {
      const count = await redisClient.incr(key)
      if (count === 1) await redisClient.expire(key, lockoutSeconds)
      return count
    }),
  )
  return Math.max(...counts)
}

async function clearLoginFailures(email: string, ip: string | undefined): Promise<void> {
  await redisClient.del([
    attemptKey('email', email.toLowerCase()),
    attemptKey('ip', ip ?? 'unknown'),
  ])
}

async function accessTokenFor(user: AuthUser, sessionId: string): Promise<string> {
  const driverIdentity =
    user.role === 'DRIVER' ? await resolveTelemetryIdentityForUser(user.id) : null
  return new SignJWT({
    role: user.role,
    sid: sessionId,
    ...(driverIdentity
      ? {
          driverId: driverIdentity.driverId,
          ...(driverIdentity.vehicleType ? { vehicleType: driverIdentity.vehicleType } : {}),
        }
      : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_SECONDS}s`)
    .sign(accessKey)
}

async function persistRefreshToken(
  user: AuthUser,
  familyId: string,
  token: string,
  context: AuthRequestContext,
  executor: DatabaseExecutor,
): Promise<Date> {
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000)
  await insertRefreshToken(
    {
      id: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(token),
      familyId,
      expiresAt,
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
      deviceFingerprintHash: fingerprint(context),
      ipGeolocation: await approximateIpGeolocation(context.ip),
    },
    executor,
  )
  return expiresAt
}

async function issueSession(
  user: AuthUser,
  context: AuthRequestContext,
  familyId = randomUUID(),
): Promise<AuthSession> {
  const refreshToken = randomBytes(32).toString('base64url')
  const refreshExpiresAt = await withTransaction(async (executor) =>
    persistRefreshToken(user, familyId, refreshToken, context, executor),
  )
  return { user, accessToken: await accessTokenFor(user, familyId), refreshToken, refreshExpiresAt }
}

async function recordAudit(
  executor: DatabaseExecutor,
  action: string,
  entityId: string | null,
  context: AuthRequestContext,
  actorId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await executor.query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
     VALUES ($1, $2, 'auth', $3, $4::jsonb, $5)`,
    [actorId, action, entityId, JSON.stringify(metadata), context.ip ?? null],
  )
}

function emitSecuritySignal(
  afterCommit: (handler: () => void) => void,
  type: string,
  user: Pick<AuthUser, 'id'> | null,
  email: string | undefined,
  context: AuthRequestContext,
  evidence: Record<string, string | number | boolean> = {},
): void {
  domainEventBus.publishAfterCommit(afterCommit, 'security.signal', {
    type,
    occurredAt: new Date().toISOString(),
    evidence,
    ...(user?.id ? { userId: user.id } : {}),
    ...(email ? { email } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  })
}

export async function registerCustomer(
  input: RegisterInput,
  context: AuthRequestContext,
): Promise<AuthSession> {
  const passwordHash = await hashPassword(input.password)
  let user: AuthUser
  try {
    user = await withTransaction(async (executor, afterCommit) => {
      const created = await createCustomer(
        {
          email: input.email,
          name: input.name,
          passwordHash,
          ...(input.phone ? { phone: input.phone } : {}),
        },
        executor,
      )
      await executor.query(
        'UPDATE users SET last_login_at = now(), last_login_ip = $2 WHERE id = $1',
        [created.id, context.ip ?? null],
      )
      await recordAudit(executor, 'auth.register', created.id, context, created.id)
      await createActionEmail(executor, afterCommit, created, 'EMAIL_VERIFICATION', context)
      emitSecuritySignal(afterCommit, 'account_registered', created, created.email, context)
      return created
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new ConflictError('An account with this email already exists.')
    }
    throw error
  }
  return issueSession(user, context)
}

type ActionPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

async function createActionEmail(
  executor: DatabaseExecutor,
  afterCommit: (handler: () => void | Promise<void>) => void,
  user: AuthUser,
  purpose: ActionPurpose,
  context: AuthRequestContext,
): Promise<void> {
  await executor.query(
    `UPDATE auth_action_tokens SET consumed_at = now()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [user.id, purpose],
  )
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHashValue = tokenHash(rawToken)
  const expiresAt = new Date(
    Date.now() + (purpose === 'EMAIL_VERIFICATION' ? 24 : 1) * 60 * 60 * 1000,
  )
  const inserted = await executor.query<{ id: string }>(
    `INSERT INTO auth_action_tokens (user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, tokenHashValue, purpose, expiresAt],
  )
  const action =
    purpose === 'EMAIL_VERIFICATION'
      ? 'Verify your RouteCommand email'
      : 'Reset your RouteCommand password'
  const path = purpose === 'EMAIL_VERIFICATION' ? '/verify-email' : '/reset-password'
  const url = `${env.WEB_ORIGIN}${path}#token=${encodeURIComponent(rawToken)}`
  const rendered = renderActionEmail({
    greeting: user.name,
    action,
    url,
    expiresIn: purpose === 'EMAIL_VERIFICATION' ? '24 hours' : '1 hour',
  })
  await queueTransactionalEmail(executor, afterCommit, {
    userId: user.id,
    recipient: user.email,
    template: purpose.toLowerCase(),
    dedupeKey: `${purpose.toLowerCase()}:${inserted.rows[0]!.id}`,
    subject: action,
    ...rendered,
    payload: { actionTokenId: inserted.rows[0]!.id },
  })
  emitSecuritySignal(afterCommit, purpose.toLowerCase(), user, user.email, context)
}

export async function resendVerification(
  email: string,
  context: AuthRequestContext,
): Promise<void> {
  const user = await findUserByEmail(email.toLowerCase())
  if (!user?.isActive || user.emailVerifiedAt) return
  await withTransaction(async (executor, afterCommit) => {
    await createActionEmail(executor, afterCommit, publicUser(user), 'EMAIL_VERIFICATION', context)
  })
}

export async function verifyEmail(token: string, context: AuthRequestContext): Promise<void> {
  const hash = tokenHash(token)
  await withTransaction(async (executor, afterCommit) => {
    const result = await executor.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM auth_action_tokens
       WHERE token_hash = $1 AND purpose = 'EMAIL_VERIFICATION' AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hash],
    )
    const record = result.rows[0]
    if (!record) throw new BadRequestError('This verification link is invalid or expired.')
    await executor.query('UPDATE auth_action_tokens SET consumed_at = now() WHERE id = $1', [
      record.id,
    ])
    await executor.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
      [record.user_id],
    )
    await recordAudit(executor, 'auth.email.verified', record.user_id, context, record.user_id)
    emitSecuritySignal(afterCommit, 'email_verified', { id: record.user_id }, undefined, context)
  })
}

export async function requestPasswordReset(
  email: string,
  context: AuthRequestContext,
): Promise<void> {
  const user = await findUserByEmail(email.toLowerCase())
  if (!user?.isActive) return
  await withTransaction(async (executor, afterCommit) => {
    await createActionEmail(executor, afterCommit, publicUser(user), 'PASSWORD_RESET', context)
    await recordAudit(executor, 'auth.password.reset_requested', user.id, context, user.id)
  })
}

export async function resetPassword(
  token: string,
  password: string,
  context: AuthRequestContext,
): Promise<void> {
  const newPasswordHash = await hashPassword(password)
  const hash = tokenHash(token)
  await withTransaction(async (executor, afterCommit) => {
    const result = await executor.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM auth_action_tokens
       WHERE token_hash = $1 AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hash],
    )
    const record = result.rows[0]
    if (!record) throw new BadRequestError('This password reset link is invalid or expired.')
    const user = await findUserById(record.user_id, executor)
    if (!user?.isActive)
      throw new BadRequestError('This password reset link is invalid or expired.')
    await executor.query('UPDATE auth_action_tokens SET consumed_at = now() WHERE id = $1', [
      record.id,
    ])
    await updatePasswordHash(user.id, newPasswordHash, executor)
    await revokeUserSessions(user.id, executor)
    await recordAudit(executor, 'auth.password.reset', user.id, context, user.id)
    emitSecuritySignal(afterCommit, 'password_reset', user, user.email, context)
  })
}

export async function login(input: LoginInput, context: AuthRequestContext): Promise<AuthSession> {
  const email = input.email.toLowerCase()
  await enforceLoginLimit(email, context.ip)
  const user = await findUserByEmail(email)
  const passwordHash =
    user?.passwordHash ?? (await argon2.hash('routecommand-invalid-account-password'))
  const passwordMatches = await verifyPassword(input.password, passwordHash)

  if (!user || !passwordMatches || !user.isActive) {
    const failedAttempts = await recordFailedLogin(email, context.ip)
    await withTransaction(async (executor, afterCommit) => {
      await recordAudit(
        executor,
        'auth.login.failed',
        user?.id ?? null,
        context,
        user?.id ?? null,
        {
          failedAttempts,
        },
      )
      emitSecuritySignal(
        afterCommit,
        failedAttempts >= maxLoginAttempts ? 'account_lockout' : 'login_failed',
        user,
        email,
        context,
        { failedAttempts },
      )
    })
    throw new UnauthorizedError('Invalid email or password.')
  }

  await clearLoginFailures(email, context.ip)
  const previousFingerprint = await findLatestDeviceFingerprint(user.id)
  const session = await issueSession(publicUser(user), context)
  await withTransaction(async (executor, afterCommit) => {
    await executor.query(
      'UPDATE users SET last_login_at = now(), last_login_ip = $2 WHERE id = $1',
      [user.id, context.ip ?? null],
    )
    await recordAudit(executor, 'auth.login.succeeded', user.id, context, user.id)
    if (previousFingerprint && previousFingerprint !== fingerprint(context)) {
      emitSecuritySignal(afterCommit, 'new_device_login', user, user.email, context)
    }
  })
  logger.info({ userId: user.id, role: user.role }, 'Authentication succeeded')
  return session
}

export async function rotateSession(
  token: string,
  context: AuthRequestContext,
): Promise<AuthSession> {
  const oldHash = tokenHash(token)
  const result = await withTransaction(async (executor, afterCommit) => {
    const record = await findRefreshTokenForUpdate(oldHash, executor)
    if (!record) return { session: null, reused: false }

    if (record.revoked_at) {
      await revokeFamily(record.family_id, executor)
      await recordAudit(
        executor,
        'auth.refresh.reuse_detected',
        record.user_id,
        context,
        record.user_id,
      )
      emitSecuritySignal(
        afterCommit,
        'refresh_token_reuse',
        { id: record.user_id },
        undefined,
        context,
      )
      return { session: null, reused: true }
    }
    if (record.expires_at <= new Date()) {
      await revokeFamily(record.family_id, executor)
      return { session: null, reused: false }
    }

    const user = await findUserById(record.user_id, executor)
    if (!user?.isActive) {
      await revokeFamily(record.family_id, executor)
      return { session: null, reused: false }
    }

    const nextToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000)
    const nextRecord = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(nextToken),
      familyId: record.family_id,
      expiresAt,
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
      deviceFingerprintHash: fingerprint(context),
      ipGeolocation: await approximateIpGeolocation(context.ip),
    }
    await rotateRefreshToken(record.id, record.family_id, nextRecord, executor)
    if (record.device_fingerprint_hash && record.device_fingerprint_hash !== fingerprint(context)) {
      emitSecuritySignal(afterCommit, 'new_device_login', user, user.email, context)
    }
    return {
      session: {
        user: publicUser(user),
        accessToken: await accessTokenFor(publicUser(user), record.family_id),
        refreshToken: nextToken,
        refreshExpiresAt: expiresAt,
      },
      reused: false,
    }
  })
  if (result.reused)
    throw new UnauthorizedError('Refresh token reuse detected. Please sign in again.')
  if (!result.session) throw new UnauthorizedError('Refresh session is invalid or expired.')
  return result.session
}

export async function logout(
  sessionId: string,
  userId: string,
  context: AuthRequestContext,
): Promise<void> {
  await withTransaction(async (executor) => {
    await revokeSession(sessionId, executor)
    await recordAudit(executor, 'auth.logout', sessionId, context, userId)
  })
}

export async function logoutAll(userId: string, context: AuthRequestContext): Promise<void> {
  await withTransaction(async (executor) => {
    await revokeUserSessions(userId, executor)
    await recordAudit(executor, 'auth.logout_all', null, context, userId)
  })
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  context: AuthRequestContext,
): Promise<void> {
  const user = await findUserById(userId)
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new UnauthorizedError('Current password is incorrect.')
  }
  const newHash = await hashPassword(input.newPassword)
  await withTransaction(async (executor, afterCommit) => {
    await updatePasswordHash(userId, newHash, executor)
    await revokeUserSessions(userId, executor)
    await recordAudit(executor, 'auth.password.changed', userId, context, userId)
    emitSecuritySignal(afterCommit, 'password_changed', user, user.email, context)
  })
}

export async function getCurrentUser(userId: string): Promise<AuthUser> {
  const user = await findPublicUserById(userId)
  if (!user || !user.isActive) throw new UnauthorizedError('Authentication is required.')
  return user
}

export async function verifyAccessToken(token: string): Promise<{
  userId: string
  role: AuthUser['role']
  sessionId: string
  expiresAt: number
  driverId?: string
  vehicleType?: 'BIKE' | 'CAR' | 'VAN' | 'TRUCK'
}> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      algorithms: ['HS256'],
      issuer,
      audience,
      clockTolerance: 5,
    })
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Required JWT claims are missing.')
    }
    if (!['ADMIN', 'DISPATCHER', 'DRIVER', 'CUSTOMER'].includes(payload.role)) {
      throw new Error('JWT role is invalid.')
    }
    if (payload.driverId !== undefined && typeof payload.driverId !== 'string') {
      throw new Error('JWT driver identity is invalid.')
    }
    if (
      payload.vehicleType !== undefined &&
      !['BIKE', 'CAR', 'VAN', 'TRUCK'].includes(String(payload.vehicleType))
    ) {
      throw new Error('JWT vehicle type is invalid.')
    }
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      role: payload.role as AuthUser['role'],
      expiresAt: payload.exp * 1000,
      ...(typeof payload.driverId === 'string' ? { driverId: payload.driverId } : {}),
      ...(typeof payload.vehicleType === 'string'
        ? { vehicleType: payload.vehicleType as 'BIKE' | 'CAR' | 'VAN' | 'TRUCK' }
        : {}),
    }
  } catch {
    throw new UnauthorizedError('Authentication is required.')
  }
}

/** Validate an access token plus its live session for HTTP middleware and later socket handshakes. */
export async function authenticateAccessToken(token: string): Promise<{
  user: AuthUser
  sessionId: string
  expiresAt: number
  driverId?: string
  vehicleType?: 'BIKE' | 'CAR' | 'VAN' | 'TRUCK'
}> {
  const claims = await verifyAccessToken(token)
  if (!(await isSessionActive(claims.sessionId, claims.userId))) throw new UnauthorizedError()
  const user = await findPublicUserById(claims.userId)
  if (!user?.isActive) throw new UnauthorizedError()
  return {
    user,
    sessionId: claims.sessionId,
    expiresAt: claims.expiresAt,
    ...(claims.driverId ? { driverId: claims.driverId } : {}),
    ...(claims.vehicleType ? { vehicleType: claims.vehicleType } : {}),
  }
}
