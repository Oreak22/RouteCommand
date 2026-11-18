import type { EmailLogQuery } from './schemas.js'
import { query, type DatabaseExecutor } from '../../db/pool.js'

export interface AdminEmailLog {
  id: string
  recipientEmail: string
  template: string
  status: string
  provider: string | null
  providerMessageId: string | null
  attempts: number
  lastError: string | null
  queuedAt: string
  sentAt: string | null
}

export interface EmailSuppressionRecord {
  email: string
  reason: string
  createdAt: string
}

export async function listEmailLogs(input: EmailLogQuery): Promise<AdminEmailLog[]> {
  const values: unknown[] = []
  const conditions: string[] = []
  if (input.status) {
    values.push(input.status)
    conditions.push(`status = $${values.length}`)
  }
  if (input.template) {
    values.push(input.template)
    conditions.push(`template = $${values.length}`)
  }
  if (input.recipient) {
    values.push(`%${input.recipient}%`)
    conditions.push(`recipient_email::text ILIKE $${values.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  values.push(input.limit, input.offset)
  const result = await query<{
    id: string
    recipient_email: string
    template: string
    status: string
    provider: string | null
    provider_message_id: string | null
    attempts: number
    last_error: string | null
    queued_at: Date
    sent_at: Date | null
  }>(
    `SELECT id, recipient_email::text, template, status, provider, provider_message_id,
            attempts, last_error, queued_at, sent_at
     FROM email_logs ${where}
     ORDER BY queued_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )
  return result.rows.map((row) => ({
    id: row.id,
    recipientEmail: row.recipient_email,
    template: row.template,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    attempts: row.attempts,
    lastError: row.last_error,
    queuedAt: row.queued_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null,
  }))
}

export async function countEmailLogs(input: EmailLogQuery): Promise<number> {
  const values: unknown[] = []
  const conditions: string[] = []
  if (input.status) {
    values.push(input.status)
    conditions.push(`status = $${values.length}`)
  }
  if (input.template) {
    values.push(input.template)
    conditions.push(`template = $${values.length}`)
  }
  if (input.recipient) {
    values.push(`%${input.recipient}%`)
    conditions.push(`recipient_email::text ILIKE $${values.length}`)
  }
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_logs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
    values,
  )
  return Number(result.rows[0]?.count ?? 0)
}

export async function listSuppressions(): Promise<EmailSuppressionRecord[]> {
  const result = await query<{ email: string; reason: string; created_at: Date }>(
    'SELECT email::text, reason, created_at FROM email_suppressions ORDER BY created_at DESC',
  )
  return result.rows.map((row) => ({
    email: row.email,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }))
}

export async function removeSuppression(email: string, executor: DatabaseExecutor = { query }) {
  return executor.query<{ reason: string }>(
    'DELETE FROM email_suppressions WHERE email = $1 RETURNING reason',
    [email],
  )
}

export async function getRetryRecord(emailId: string) {
  const result = await query<{
    id: string
    status: string
    dedupe_key: string | null
    recipient_email: string
    suppressed: boolean
  }>(
    `SELECT l.id, l.status, l.dedupe_key, l.recipient_email::text,
            EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = l.recipient_email) AS suppressed
     FROM email_logs l WHERE l.id = $1`,
    [emailId],
  )
  return result.rows[0]
}

export async function markEmailQueued(emailId: string, executor: DatabaseExecutor = { query }) {
  return executor.query(
    `UPDATE email_logs SET status = 'QUEUED', attempts = 0, last_error = NULL
     WHERE id = $1 AND status IN ('FAILED', 'BOUNCED')`,
    [emailId],
  )
}
