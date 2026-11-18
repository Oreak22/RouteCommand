import type { ListAlertsQuery } from '@routecommand/shared'

import {
  alertStats,
  countAlerts,
  getAlertForUpdate,
  listAlerts,
  updateAlertStatus,
} from './repository.js'
import type { AlertRecord } from './repository.js'
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { withTransaction } from '../../db/pool.js'
import type { AuthRequestContext } from '../auth/types.js'

export async function listAlertRecords(input: ListAlertsQuery) {
  const [data, total] = await Promise.all([listAlerts(input), countAlerts(input)])
  return { data, total }
}

export function getAlertStats() {
  return alertStats()
}

export async function updateAlertRecord(
  alertId: string,
  action: 'ACKNOWLEDGED' | 'RESOLVED',
  actorId: string,
  note: string | undefined,
  context: AuthRequestContext,
): Promise<AlertRecord> {
  return withTransaction(async (executor, afterCommit) => {
    const current = await getAlertForUpdate(alertId, executor)
    if (!current) throw new NotFoundError('Alert was not found.')
    if (current.status === action) return current
    if (current.status === 'RESOLVED') {
      throw new ConflictError('A resolved alert cannot be changed.')
    }
    if (action === 'ACKNOWLEDGED' && current.status !== 'OPEN') {
      throw new ConflictError('Only open alerts can be acknowledged.')
    }

    const updated = await updateAlertStatus(alertId, action, actorId, note, executor)
    if (!updated) throw new NotFoundError('Alert was not found.')
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, $2, 'alert', $3, $4::jsonb, $5)`,
      [
        actorId,
        action === 'ACKNOWLEDGED' ? 'alerts.acknowledged' : 'alerts.resolved',
        alertId,
        JSON.stringify({ previousStatus: current.status, note: note ?? null }),
        context.ip ?? null,
      ],
    )
    domainEventBus.publishAfterCommit(afterCommit, 'alert.updated', {
      alertId,
      status: action,
      actorId,
    })
    return updated
  })
}
