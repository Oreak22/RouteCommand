import {
  getSecurityEvent,
  listSecurityEvents,
  updateSecurityEventStatus,
} from './admin-repository.js'
import type { SecurityEventListInput } from './admin-schemas.js'
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js'
import { withTransaction } from '../../db/pool.js'
import type { AuthRequestContext } from '../auth/types.js'

export function listSecurityEventRecords(input: SecurityEventListInput) {
  return listSecurityEvents(input)
}

export async function getSecurityEventRecord(eventId: string) {
  const event = await getSecurityEvent(eventId)
  if (!event) throw new NotFoundError('Security event was not found.')
  return event
}

export async function reviewSecurityEvent(
  eventId: string,
  status: 'REVIEWED' | 'DISMISSED',
  actorId: string,
  context: AuthRequestContext,
) {
  return withTransaction(async (executor) => {
    const current = await getSecurityEvent(eventId, executor)
    if (!current) throw new NotFoundError('Security event was not found.')
    if (current.status !== 'OPEN')
      throw new ConflictError('Only open security events can be updated.')
    const updated = await updateSecurityEventStatus(eventId, status, actorId, executor)
    if (!updated) throw new ConflictError('The security event changed before it could be updated.')
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, $2, 'security_event', $3, $4::jsonb, $5)`,
      [
        actorId,
        status === 'REVIEWED' ? 'security_event.reviewed' : 'security_event.dismissed',
        eventId,
        JSON.stringify({ previousStatus: current.status }),
        context.ip ?? null,
      ],
    )
    return { ...current, status, reviewedBy: actorId, updatedAt: new Date().toISOString() }
  })
}
