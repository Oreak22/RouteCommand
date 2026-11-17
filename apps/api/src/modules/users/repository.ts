import type { QueryResultRow } from 'pg'

import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'
import type { AuthUser } from '../auth/types.js'

export interface ManagedUser extends AuthUser {
  phone: string | null
  lastLoginAt: string | null
  createdAt: string
}

interface ManagedUserRow extends QueryResultRow {
  id: string
  email: string
  name: string
  phone: string | null
  role: AuthUser['role']
  is_active: boolean
  email_verified_at: Date | null
  last_login_at: Date | null
  created_at: Date
}

function mapUser(row: ManagedUserRow): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: row.role,
    isActive: row.is_active,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

const selectFields = `id, email, name, phone, role, is_active, email_verified_at, last_login_at, created_at`

export async function listManagedUsers(input: {
  search?: string
  role?: AuthUser['role']
  active?: boolean
  limit: number
  offset: number
}): Promise<ManagedUser[]> {
  const result = await query<ManagedUserRow>(
    `SELECT ${selectFields} FROM users
     WHERE ($1::text IS NULL OR email::text ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%')
       AND ($2::user_role IS NULL OR role = $2::user_role)
       AND ($3::boolean IS NULL OR is_active = $3)
     ORDER BY created_at DESC, id
     LIMIT $4 OFFSET $5`,
    [input.search ?? null, input.role ?? null, input.active ?? null, input.limit, input.offset],
  )
  return result.rows.map(mapUser)
}

export async function getManagedUser(
  id: string,
  executor = { query },
): Promise<ManagedUser | null> {
  const result = await executor.query<ManagedUserRow>(
    `SELECT ${selectFields} FROM users WHERE id = $1`,
    [id],
  )
  return result.rows[0] ? mapUser(result.rows[0]) : null
}

export async function lockActiveAdministrators(executor: DatabaseExecutor): Promise<string[]> {
  const result = await executor.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'ADMIN' AND is_active = true FOR UPDATE`,
  )
  return result.rows.map(({ id }) => id)
}

export async function insertManagedUser(
  input: {
    email: string
    name: string
    phone?: string
    passwordHash: string
    role: AuthUser['role']
  },
  executor: DatabaseExecutor,
): Promise<ManagedUser> {
  const result = await executor.query<ManagedUserRow>(
    `INSERT INTO users (email, name, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${selectFields}`,
    [input.email.toLowerCase(), input.name, input.phone ?? null, input.passwordHash, input.role],
  )
  return mapUser(result.rows[0]!)
}

export async function upsertDriverProfile(
  userId: string,
  licenseNo: string,
  executor: DatabaseExecutor,
): Promise<void> {
  await executor.query(
    `INSERT INTO drivers (user_id, license_no) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET license_no = EXCLUDED.license_no`,
    [userId, licenseNo],
  )
}

export async function patchManagedUser(
  id: string,
  patch: {
    name?: string
    phone?: string | null
    role?: AuthUser['role']
    isActive?: boolean
  },
  executor: DatabaseExecutor,
): Promise<ManagedUser | null> {
  const sets: string[] = []
  const values: unknown[] = [id]
  const assignments: [keyof typeof patch, string][] = [
    ['name', 'name'],
    ['phone', 'phone'],
    ['role', 'role'],
    ['isActive', 'is_active'],
  ]
  for (const [key, column] of assignments) {
    if (patch[key] === undefined) continue
    values.push(patch[key])
    sets.push(`${column} = $${values.length}`)
  }
  const result = await executor.query<ManagedUserRow>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${selectFields}`,
    values,
  )
  return result.rows[0] ? mapUser(result.rows[0]) : null
}
