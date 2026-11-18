import type { SecurityEventListInput } from './admin-schemas.js'
import { query, type DatabaseExecutor } from '../../db/pool.js'

export interface SecurityEventRecord {
  id: string
  type: string
  severity: string
  userId: string | null
  userName: string | null
  ip: string | null
  userAgent: string | null
  evidence: Record<string, unknown>
  status: string
  reviewedBy: string | null
  createdAt: string
  updatedAt: string
}

function filters(input: SecurityEventListInput) {
  const values: unknown[] = []
  const conditions: string[] = []
  const add = (value: unknown, clause: (index: number) => string) => {
    values.push(value)
    conditions.push(clause(values.length))
  }
  if (input.status) add(input.status, (i) => `event.status = $${i}`)
  if (input.severity) add(input.severity, (i) => `event.severity = $${i}::alert_severity`)
  if (input.type) add(input.type, (i) => `event.type = $${i}`)
  if (input.userId) add(input.userId, (i) => `event.user_id = $${i}`)
  return { values, where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '' }
}

function mapRecord(row: {
  id: string
  type: string
  severity: string
  user_id: string | null
  user_name: string | null
  ip: string | null
  user_agent: string | null
  evidence: Record<string, unknown>
  status: string
  reviewed_by: string | null
  created_at: Date
  updated_at: Date
}): SecurityEventRecord {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    userId: row.user_id,
    userName: row.user_name,
    ip: row.ip,
    userAgent: row.user_agent,
    evidence: row.evidence,
    status: row.status,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const select = `SELECT event.id, event.type, event.severity::text, event.user_id,
       user_record.name AS user_name, event.ip::text AS ip, event.user_agent,
       event.evidence, event.status, event.reviewed_by, event.created_at, event.updated_at
     FROM security_events event LEFT JOIN users user_record ON user_record.id = event.user_id`

export async function listSecurityEvents(input: SecurityEventListInput) {
  const { values, where } = filters(input)
  values.push(input.limit, input.offset)
  const result = await query<Parameters<typeof mapRecord>[0]>(
    `${select} ${where} ORDER BY event.created_at DESC, event.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )
  const total = await countSecurityEvents(input)
  return { data: result.rows.map(mapRecord), total }
}

export async function countSecurityEvents(input: SecurityEventListInput): Promise<number> {
  const { values, where } = filters(input)
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM security_events event ${where}`,
    values,
  )
  return Number(result.rows[0]?.count ?? 0)
}

export async function getSecurityEvent(eventId: string, executor: DatabaseExecutor = { query }) {
  const result = await executor.query<Parameters<typeof mapRecord>[0]>(
    `${select} WHERE event.id = $1`,
    [eventId],
  )
  return result.rows[0] ? mapRecord(result.rows[0]) : null
}

export async function updateSecurityEventStatus(
  eventId: string,
  status: 'REVIEWED' | 'DISMISSED',
  reviewerId: string,
  executor: DatabaseExecutor,
) {
  const result = await executor.query(
    `UPDATE security_events SET status = $2, reviewed_by = $3
     WHERE id = $1 AND status = 'OPEN'`,
    [eventId, status, reviewerId],
  )
  return result.rowCount ?? 0
}
