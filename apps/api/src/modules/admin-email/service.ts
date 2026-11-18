import {
  countEmailLogs,
  getRetryRecord,
  listEmailLogs,
  listSuppressions,
  markEmailQueued,
  removeSuppression,
} from './repository.js'
import type { EmailLogQuery } from './schemas.js'
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js'
import { withTransaction } from '../../db/pool.js'
import { retryFailedEmailJob } from '../../infra/email-queue.js'
import type { AuthRequestContext } from '../auth/types.js'

export async function getEmailLogPage(input: EmailLogQuery) {
  const [data, total] = await Promise.all([listEmailLogs(input), countEmailLogs(input)])
  return { data, total }
}

export function getEmailSuppressions() {
  return listSuppressions()
}

export async function clearEmailSuppression(
  email: string,
  actorId: string,
  context: AuthRequestContext,
): Promise<void> {
  await withTransaction(async (executor) => {
    const removed = await removeSuppression(email, executor)
    if (!removed.rowCount) throw new NotFoundError('Email suppression was not found.')
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, metadata, ip)
       VALUES ($1, 'email_suppression.cleared', 'email_suppression', $2::jsonb, $3)`,
      [actorId, JSON.stringify({ email, reason: removed.rows[0]?.reason }), context.ip ?? null],
    )
  })
}

export async function retryEmailLog(
  emailId: string,
  actorId: string,
  context: AuthRequestContext,
): Promise<void> {
  const record = await getRetryRecord(emailId)
  if (!record) throw new NotFoundError('Email log entry was not found.')
  if (!['FAILED', 'BOUNCED'].includes(record.status)) {
    throw new ConflictError('Only failed or bounced email entries can be retried.')
  }
  if (record.suppressed) {
    throw new ConflictError('Clear the recipient suppression before retrying this email.')
  }
  if (!record.dedupe_key) throw new ConflictError('This email does not have a retryable queue key.')

  await withTransaction(async (executor) => {
    const updated = await markEmailQueued(emailId, executor)
    if (!updated.rowCount)
      throw new ConflictError('The email status changed before it could be retried.')
  })

  try {
    await retryFailedEmailJob(record.dedupe_key)
  } catch {
    await withTransaction(async (executor) => {
      await executor.query(
        "UPDATE email_logs SET status = $2 WHERE id = $1 AND status = 'QUEUED'",
        [emailId, record.status],
      )
    })
    throw new ConflictError('The failed queue job is no longer retained and cannot be retried.')
  }

  await withTransaction(async (executor) => {
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, 'email_log.retried', 'email_log', $2, $3::jsonb, $4)`,
      [actorId, emailId, JSON.stringify({ previousStatus: record.status }), context.ip ?? null],
    )
  })
}
