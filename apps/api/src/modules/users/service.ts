import type { createManagedUserSchema, updateManagedUserSchema } from '@routecommand/shared'
import type { z } from 'zod'

import {
  getManagedUser,
  insertManagedUser,
  lockActiveAdministrators,
  listManagedUsers,
  patchManagedUser,
  upsertDriverProfile,
  type ManagedUser,
} from './repository.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { withTransaction } from '../../db/pool.js'
import { hashPassword } from '../auth/service.js'
import { requestPasswordReset, resendVerification } from '../auth/service.js'
import type { AuthRequestContext } from '../auth/types.js'

type CreateInput = z.infer<typeof createManagedUserSchema>
type UpdateInput = z.infer<typeof updateManagedUserSchema>

export async function listUsers(input: Parameters<typeof listManagedUsers>[0]) {
  return listManagedUsers(input)
}

export async function getUser(userId: string): Promise<ManagedUser> {
  const user = await getManagedUser(userId)
  if (!user) throw new NotFoundError('User was not found.')
  return user
}

export async function createUser(
  input: CreateInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<ManagedUser> {
  const passwordHash = await hashPassword(input.password)
  let user: ManagedUser
  try {
    user = await withTransaction(async (executor, afterCommit) => {
      const created = await insertManagedUser(
        {
          email: input.email,
          name: input.name,
          role: input.role,
          passwordHash,
          ...(input.phone ? { phone: input.phone } : {}),
        },
        executor,
      )
      if (input.role === 'DRIVER' && input.licenseNo) {
        await upsertDriverProfile(created.id, input.licenseNo, executor)
      }
      await executor.query(
        `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
         VALUES ($1, 'users.created', 'user', $2, $3::jsonb, $4)`,
        [actorId, created.id, JSON.stringify({ role: input.role }), context.ip ?? null],
      )
      domainEventBus.publishAfterCommit(afterCommit, 'security.signal', {
        type: 'user_created',
        userId: created.id,
        occurredAt: new Date().toISOString(),
        evidence: { role: input.role },
        ...(context.ip ? { ip: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      })
      return created
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new ConflictError('A user with that email or license number already exists.')
    }
    throw error
  }
  await resendVerification(user.email, context)
  return user
}

export async function updateUser(
  userId: string,
  input: UpdateInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<ManagedUser> {
  if (actorId === userId && input.role !== undefined && input.role !== 'ADMIN') {
    domainEventBus.publish('security.signal', {
      type: 'user_role_changed',
      actorId,
      userId,
      occurredAt: new Date().toISOString(),
      evidence: { requestedRole: input.role, selfServiceAttempt: true },
      ...(context.ip ? { ip: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    })
  }
  if (actorId === userId && (input.isActive === false || (input.role && input.role !== 'ADMIN'))) {
    throw new ForbiddenError('You cannot deactivate or remove your own administrator access.')
  }
  if (input.role === 'DRIVER' && !input.licenseNo) {
    const existing = await getManagedUser(userId)
    if (existing?.role !== 'DRIVER') {
      throw new ConflictError('A license number is required when assigning the driver role.')
    }
  }
  const user = await withTransaction(async (executor, afterCommit) => {
    const existing = await getManagedUser(userId, executor)
    if (!existing) throw new NotFoundError('User was not found.')
    const removesAdmin =
      existing.role === 'ADMIN' &&
      existing.isActive &&
      (input.isActive === false || (input.role !== undefined && input.role !== 'ADMIN'))
    if (removesAdmin && (await lockActiveAdministrators(executor)).length <= 1) {
      throw new ConflictError('The last active administrator cannot be removed.')
    }
    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    }
    const updated = await patchManagedUser(userId, patch, executor)
    if (!updated) throw new NotFoundError('User was not found.')
    if (updated.role === 'DRIVER' && input.licenseNo) {
      await upsertDriverProfile(updated.id, input.licenseNo, executor)
    }
    if (input.isActive === false) {
      await executor.query(
        'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1',
        [userId],
      )
      await executor.query("UPDATE drivers SET status = 'OFFLINE' WHERE user_id = $1", [userId])
    }
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, 'users.updated', 'user', $2, $3::jsonb, $4)`,
      [
        actorId,
        userId,
        JSON.stringify({ role: input.role, isActive: input.isActive }),
        context.ip ?? null,
      ],
    )
    if (input.role !== undefined || input.isActive !== undefined) {
      domainEventBus.publishAfterCommit(afterCommit, 'security.signal', {
        type: input.role !== undefined ? 'user_role_changed' : 'user_deactivated',
        actorId,
        userId,
        occurredAt: new Date().toISOString(),
        evidence: {
          ...(input.role ? { role: input.role } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        ...(context.ip ? { ip: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      })
    }
    return updated
  })
  return user
}

export async function forcePasswordReset(
  userId: string,
  actorId: string,
  context: AuthRequestContext,
): Promise<void> {
  const user = await getUser(userId)
  await requestPasswordReset(user.email, context)
  await withTransaction(async (executor) => {
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, 'users.password_reset_forced', 'user', $2, '{}'::jsonb, $3)`,
      [actorId, userId, context.ip ?? null],
    )
  })
}
