import type { AuthUser } from './types.js'
import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'

interface UserRow {
  id: string
  email: string
  name: string
  role: AuthUser['role']
  is_active: boolean
  email_verified_at: Date | null
  password_hash: string
}

export interface UserWithPassword extends AuthUser {
  passwordHash: string
}

function mapUser(row: UserRow): UserWithPassword {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    passwordHash: row.password_hash,
  }
}

export async function findUserByEmail(
  email: string,
  executor = { query },
): Promise<UserWithPassword | null> {
  const result = await executor.query<UserRow>(
    `SELECT id, email, name, role, is_active, email_verified_at, password_hash
     FROM users WHERE email = $1 LIMIT 1`,
    [email],
  )
  return result.rows[0] ? mapUser(result.rows[0]) : null
}

export async function findUserById(
  id: string,
  executor = { query },
): Promise<UserWithPassword | null> {
  const result = await executor.query<UserRow>(
    `SELECT id, email, name, role, is_active, email_verified_at, password_hash
     FROM users WHERE id = $1 LIMIT 1`,
    [id],
  )
  return result.rows[0] ? mapUser(result.rows[0]) : null
}

export async function findPublicUserById(
  id: string,
  executor = { query },
): Promise<AuthUser | null> {
  const result = await executor.query<Omit<UserRow, 'password_hash'>>(
    `SELECT id, email, name, role, is_active, email_verified_at FROM users WHERE id = $1 LIMIT 1`,
    [id],
  )
  const row = result.rows[0]
  return row
    ? {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        isActive: row.is_active,
        emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
      }
    : null
}

export async function createCustomer(
  input: { email: string; name: string; phone?: string; passwordHash: string },
  executor: DatabaseExecutor,
): Promise<AuthUser> {
  const result = await executor.query<UserRow>(
    `INSERT INTO users (email, name, phone, role, password_hash)
     VALUES ($1, $2, $3, 'CUSTOMER', $4)
     RETURNING id, email, name, role, is_active, email_verified_at, password_hash`,
    [input.email.toLowerCase(), input.name, input.phone ?? null, input.passwordHash],
  )
  const user = mapUser(result.rows[0]!)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    emailVerifiedAt: user.emailVerifiedAt,
  }
}

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash])
}

export async function insertRefreshToken(
  record: {
    id: string
    userId: string
    tokenHash: string
    familyId: string
    expiresAt: Date
    userAgent?: string
    ip?: string
    deviceFingerprintHash: string
    ipGeolocation?: string | null
  },
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query(
    `INSERT INTO refresh_tokens
      (id, user_id, token_hash, family_id, expires_at, user_agent, ip, device_fingerprint_hash, ip_geolocation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.id,
      record.userId,
      record.tokenHash,
      record.familyId,
      record.expiresAt,
      record.userAgent ?? null,
      record.ip ?? null,
      record.deviceFingerprintHash,
      record.ipGeolocation ?? null,
    ],
  )
}

export async function findRefreshTokenForUpdate(tokenHash: string, executor: DatabaseExecutor) {
  const result = await executor.query<{
    id: string
    user_id: string
    family_id: string
    expires_at: Date
    revoked_at: Date | null
    user_agent: string | null
    ip: string | null
    device_fingerprint_hash: string | null
  }>(
    `SELECT id, user_id, family_id, expires_at, revoked_at, user_agent, ip, device_fingerprint_hash
     FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash],
  )
  return result.rows[0] ?? null
}

export async function rotateRefreshToken(
  previousId: string,
  previousFamilyId: string,
  next: Parameters<typeof insertRefreshToken>[0],
  executor: DatabaseExecutor,
): Promise<void> {
  await insertRefreshToken(next, executor)
  await executor.query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2, last_used_at = now()
     WHERE id = $1 AND family_id = $3`,
    [previousId, next.id, previousFamilyId],
  )
}

export async function revokeFamily(familyId: string, executor: DatabaseExecutor): Promise<void> {
  await executor.query(
    'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1',
    [familyId],
  )
}

export async function revokeUserSessions(
  userId: string,
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query(
    'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1',
    [userId],
  )
}

export async function revokeSession(sessionId: string, executor: DatabaseExecutor): Promise<void> {
  await executor.query(
    'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1',
    [sessionId],
  )
}

export async function isSessionActive(sessionId: string, userId: string): Promise<boolean> {
  const result = await query<{ active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM refresh_tokens
       WHERE family_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()
     ) AS active`,
    [sessionId, userId],
  )
  return result.rows[0]?.active ?? false
}

export async function findLatestDeviceFingerprint(userId: string): Promise<string | null> {
  const result = await query<{ device_fingerprint_hash: string | null }>(
    `SELECT device_fingerprint_hash FROM refresh_tokens
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  )
  return result.rows[0]?.device_fingerprint_hash ?? null
}
