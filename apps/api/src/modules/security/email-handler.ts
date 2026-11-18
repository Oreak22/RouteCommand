import { env } from '../../config/env.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { query, withTransaction } from '../../db/pool.js'
import { queueTransactionalEmail } from '../../infra/email-queue.js'
import { approximateIpGeolocation } from '../../infra/geoip.js'
import { renderNotice } from '../notifications/templates.js'

async function notifyAdmins(event: {
  securityEventId: string
  type: string
  severity: string
}): Promise<void> {
  if (!['HIGH', 'CRITICAL'].includes(event.severity)) return
  const detail = await query<{
    user_id: string | null
    user_name: string | null
    ip: string | null
    user_agent: string | null
    evidence: Record<string, unknown>
    created_at: Date
  }>(
    `SELECT event.user_id, user_record.name AS user_name, event.ip::text AS ip,
            event.user_agent, event.evidence, event.created_at
     FROM security_events event LEFT JOIN users user_record ON user_record.id = event.user_id
     WHERE event.id = $1`,
    [event.securityEventId],
  )
  const item = detail.rows[0]
  if (!item) return
  const administrators = await query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email::text AS email FROM users
     WHERE role = 'ADMIN' AND is_active AND email_verified_at IS NOT NULL
     ORDER BY id`,
  )
  if (!administrators.rowCount) return
  const location = await approximateIpGeolocation(item.ip ?? undefined)
  const safeEvidence = Object.entries(item.evidence)
    .filter(([key]) => !/(token|password|coordinate|latitude|longitude)/i.test(key))
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}: ${String(value).slice(0, 180)}`)
    .slice(0, 8)
  const lines = [
    `Rule: ${event.type}`,
    `Severity: ${event.severity}`,
    `Account: ${item.user_name ?? 'Unknown account'}`,
    ...(item.ip ? [`IP address: ${item.ip}`] : []),
    ...(location ? [`Approximate IP location: ${location}`] : []),
    ...(item.user_agent ? [`Device: ${item.user_agent.slice(0, 250)}`] : []),
    `Time: ${item.created_at.toISOString()}`,
    ...(safeEvidence.length ? [`Evidence: ${safeEvidence.join('; ')}`] : []),
  ]
  for (const administrator of administrators.rows) {
    const rendered = renderNotice({
      subject: `Security alert: ${event.type.toLowerCase().replaceAll('_', ' ')}`,
      greeting: administrator.name.split(/\s+/)[0] || 'there',
      lines,
      actionLabel: 'Review security event',
      actionUrl: `${env.WEB_ORIGIN}/app/admin/security?event=${event.securityEventId}`,
    })
    await withTransaction(async (executor, afterCommit) => {
      await queueTransactionalEmail(executor, afterCommit, {
        userId: administrator.id,
        entity: 'security_event',
        entityId: event.securityEventId,
        recipient: administrator.email,
        template: 'security_admin_alert',
        dedupeKey: `security-event:${event.securityEventId}:admin:${administrator.id}`,
        ...rendered,
        payload: { securityEventId: event.securityEventId, severity: event.severity },
      })
    })
  }
}

export function startSecurityEventEmailHandler(): () => void {
  return domainEventBus.subscribe('security.event', (event) => {
    void notifyAdmins(event).catch((error: unknown) => {
      logger.error(
        { err: error, securityEventId: event.securityEventId },
        'Security alert email failed to queue',
      )
    })
  })
}
