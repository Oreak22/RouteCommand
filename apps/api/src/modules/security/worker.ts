import type { UserRole } from '@routecommand/shared'

import { env } from '../../config/env.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { withTransaction } from '../../db/pool.js'
import { queueTransactionalEmail } from '../../infra/email-queue.js'
import { renderNotice } from '../notifications/templates.js'

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
type SecuritySignal = {
  type: string
  actorId?: string
  userId?: string
  email?: string
  ip?: string
  userAgent?: string
  occurredAt: string
  evidence?: Record<string, string | number | boolean>
}

interface ClassifiedSignal {
  type: string
  severity: Severity
  userId?: string
  ip?: string
  userAgent?: string
  evidence: Record<string, unknown>
  emailUser?: boolean
}

async function classifySignal(signal: SecuritySignal): Promise<ClassifiedSignal | null> {
  const evidence = signal.evidence ?? {}
  if (
    (signal.type === 'customer_shipment_created' ||
      signal.type === 'customer_shipment_cancelled') &&
    signal.userId
  ) {
    const isCancellation = signal.type === 'customer_shipment_cancelled'
    const count = await withTransaction(async (executor) => {
      const result = await executor.query<{ count: string }>(
        isCancellation
          ? `SELECT count(*)::text AS count
             FROM shipment_events
             WHERE actor_id = $1 AND status = 'CANCELLED'
               AND created_at >= now() - ($2::int * interval '1 minute')`
          : `SELECT count(*)::text AS count
             FROM shipments
             WHERE customer_id = $1
               AND created_at >= now() - ($2::int * interval '1 minute')`,
        [signal.userId, env.SECURITY_ACTIVITY_WINDOW_MINUTES],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
    const threshold = isCancellation
      ? env.SECURITY_CUSTOMER_CANCELLATION_THRESHOLD
      : env.SECURITY_CUSTOMER_REQUEST_THRESHOLD
    if (count < threshold) return null
    const type = isCancellation ? 'MASS_SHIPMENT_CANCELLATIONS' : 'MASS_SHIPMENT_REQUESTS'
    return {
      ...signal,
      type,
      severity: 'MEDIUM',
      evidence: {
        ...evidence,
        count,
        threshold,
        windowMinutes: env.SECURITY_ACTIVITY_WINDOW_MINUTES,
      },
    }
  }
  if (signal.type === 'login_failed') {
    if (Number(evidence.failedAttempts ?? 0) < env.SECURITY_BRUTE_FORCE_THRESHOLD) return null
    return { ...signal, type: 'BRUTE_FORCE_LOGIN', severity: 'HIGH', evidence }
  }
  if (signal.type === 'account_lockout') {
    return { ...signal, type: 'ACCOUNT_LOCKED', severity: 'MEDIUM', evidence, emailUser: true }
  }
  if (signal.type === 'refresh_token_reuse') {
    return { ...signal, type: 'REFRESH_TOKEN_REUSE', severity: 'CRITICAL', evidence }
  }
  if (signal.type === 'unauthorized_burst' || signal.type === 'forbidden_burst') {
    return {
      ...signal,
      type:
        signal.type === 'forbidden_burst' ? 'PRIVILEGE_ESCALATION_ATTEMPT' : 'UNAUTHORIZED_BURST',
      severity: 'HIGH',
      evidence,
    }
  }
  if (signal.type === 'user_role_changed' && signal.userId && signal.actorId === signal.userId) {
    return { ...signal, type: 'PRIVILEGE_ESCALATION_ATTEMPT', severity: 'HIGH', evidence }
  }
  if (signal.type === 'new_device_login') {
    let role: UserRole | undefined
    if (signal.userId) {
      const user = await withTransaction(async (executor) => {
        const result = await executor.query<{ role: UserRole }>(
          'SELECT role FROM users WHERE id = $1',
          [signal.userId],
        )
        return result.rows[0]?.role
      })
      role = user
    }
    return {
      ...signal,
      type: 'NEW_DEVICE_LOGIN',
      severity: role === 'ADMIN' || role === 'DISPATCHER' ? 'MEDIUM' : 'LOW',
      evidence,
      emailUser: true,
    }
  }
  if (signal.type === 'password_changed' && signal.userId) {
    const assessment = await withTransaction(async (executor) => {
      const [recentNewDevice, changes] = await Promise.all([
        executor.query<{ detected: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM security_events
             WHERE user_id = $1 AND type = 'NEW_DEVICE_LOGIN'
               AND created_at >= now() - ($2::int * interval '1 minute')
           ) AS detected`,
          [signal.userId, env.SECURITY_ACTIVITY_WINDOW_MINUTES],
        ),
        executor.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM audit_logs
           WHERE entity = 'auth' AND entity_id = $1 AND action = 'auth.password.changed'
             AND created_at >= now() - ($2::int * interval '1 minute')`,
          [signal.userId, env.SECURITY_ACTIVITY_WINDOW_MINUTES],
        ),
      ])
      return {
        afterNewDevice: recentNewDevice.rows[0]?.detected ?? false,
        count: Number(changes.rows[0]?.count ?? 0),
      }
    })
    if (assessment.afterNewDevice) {
      return {
        ...signal,
        type: 'CREDENTIAL_CHANGE_AFTER_NEW_DEVICE',
        severity: 'HIGH',
        evidence: { ...evidence, windowMinutes: env.SECURITY_ACTIVITY_WINDOW_MINUTES },
        emailUser: true,
      }
    }
    if (assessment.count >= env.SECURITY_CREDENTIAL_CHANGE_THRESHOLD) {
      return {
        ...signal,
        type: 'CREDENTIAL_CHANGE_BURST',
        severity: 'HIGH',
        evidence: {
          ...evidence,
          count: assessment.count,
          threshold: env.SECURITY_CREDENTIAL_CHANGE_THRESHOLD,
          windowMinutes: env.SECURITY_ACTIVITY_WINDOW_MINUTES,
        },
        emailUser: true,
      }
    }
    return {
      ...signal,
      type: 'PASSWORD_CHANGED',
      severity: 'LOW',
      evidence,
      emailUser: true,
    }
  }
  if (signal.type === 'login_location_changed' && signal.userId) {
    try {
      const previous = JSON.parse(String(evidence.previousGeolocation)) as { country?: string }
      const current = JSON.parse(String(evidence.currentGeolocation)) as { country?: string }
      const previousAt = new Date(String(evidence.previousLoginAt)).getTime()
      const elapsedMinutes = (Date.now() - previousAt) / 60_000
      if (
        previous.country &&
        current.country &&
        previous.country !== current.country &&
        Number.isFinite(elapsedMinutes) &&
        elapsedMinutes >= 0 &&
        elapsedMinutes <= env.SECURITY_IMPOSSIBLE_TRAVEL_WINDOW_MINUTES
      ) {
        return {
          ...signal,
          type: 'IMPOSSIBLE_TRAVEL',
          severity: 'HIGH',
          evidence: {
            previousCountry: previous.country,
            currentCountry: current.country,
            elapsedMinutes: Math.round(elapsedMinutes),
            thresholdMinutes: env.SECURITY_IMPOSSIBLE_TRAVEL_WINDOW_MINUTES,
          },
        }
      }
    } catch {
      return null
    }
    return null
  }
  return null
}

async function persistSecurityEvent(signal: ClassifiedSignal): Promise<string | null> {
  const scope =
    signal.type === 'BRUTE_FORCE_LOGIN' && signal.ip
      ? signal.ip
      : (signal.userId ?? signal.ip ?? 'global')
  return withTransaction(async (executor, afterCommit) => {
    await executor.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      signal.type,
      scope,
    ])
    const existing = await executor.query<{ id: string; evidence: Record<string, unknown> }>(
      `SELECT id, evidence FROM security_events
       WHERE type = $1 AND (
           ($1 = 'BRUTE_FORCE_LOGIN' AND $3::inet IS NOT NULL AND ip = $3::inet)
           OR ($1 <> 'BRUTE_FORCE_LOGIN' AND user_id IS NOT DISTINCT FROM $2::uuid
             AND ($2::uuid IS NOT NULL OR ip IS NOT DISTINCT FROM $3::inet))
         )
         AND created_at > now() - ($4::int * interval '1 second')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [signal.type, signal.userId ?? null, signal.ip ?? null, env.SECURITY_DEDUPE_WINDOW_SECONDS],
    )
    const prior = existing.rows[0]
    if (prior) {
      const count = Number(prior.evidence.count ?? 1) + 1
      await executor.query(
        `UPDATE security_events SET evidence = evidence || $2::jsonb || jsonb_build_object('count', $3::int)
         WHERE id = $1`,
        [prior.id, JSON.stringify(signal.evidence), count],
      )
      return null
    }
    const inserted = await executor.query<{ id: string }>(
      `INSERT INTO security_events (type, severity, user_id, ip, user_agent, evidence)
       VALUES ($1, $2::alert_severity, $3, $4::inet, $5, $6::jsonb) RETURNING id`,
      [
        signal.type,
        signal.severity,
        signal.userId ?? null,
        signal.ip ?? null,
        signal.userAgent ?? null,
        JSON.stringify({ ...signal.evidence, count: 1, rationale: rationale(signal.type) }),
      ],
    )
    const securityEventId = inserted.rows[0]!.id
    if (signal.emailUser && signal.userId) {
      const user = await executor.query<{ name: string; email: string }>(
        `SELECT name, email::text AS email FROM users
         WHERE id = $1 AND is_active AND email_verified_at IS NOT NULL`,
        [signal.userId],
      )
      const recipient = user.rows[0]
      if (recipient) {
        const isLocked = signal.type === 'ACCOUNT_LOCKED'
        const isPasswordChange =
          signal.type === 'PASSWORD_CHANGED' ||
          signal.type === 'CREDENTIAL_CHANGE_BURST' ||
          signal.type === 'CREDENTIAL_CHANGE_AFTER_NEW_DEVICE'
        const rendered = renderNotice({
          subject: isLocked
            ? 'Your RouteCommand account is temporarily locked'
            : isPasswordChange
              ? 'Your RouteCommand password was changed'
              : 'New sign-in to your RouteCommand account',
          greeting: recipient.name.split(/\s+/)[0] || 'there',
          lines: [
            ...(isLocked
              ? ['Your account was temporarily locked after repeated failed sign-in attempts.']
              : isPasswordChange
                ? [
                    'The password for your account was changed. If you did not do this, reset it now.',
                  ]
                : ['Your account was accessed from a new device.']),
            ...(signal.ip ? [`IP address: ${signal.ip}`] : []),
            ...(signal.userAgent ? [`Device: ${signal.userAgent}`] : []),
          ],
          actionLabel: isLocked ? 'Reset your password' : 'Review account security',
          actionUrl: `${env.WEB_ORIGIN}${isLocked ? '/forgot-password' : '/account/password'}`,
        })
        await queueTransactionalEmail(executor, afterCommit, {
          userId: signal.userId,
          entity: 'security_event',
          entityId: securityEventId,
          recipient: recipient.email,
          template: isLocked
            ? 'security_account_locked'
            : isPasswordChange
              ? 'security_password_changed'
              : 'security_new_device_login',
          dedupeKey: `security-event:${securityEventId}:user:${signal.userId}`,
          ...rendered,
          payload: { securityEventId },
        })
      }
    }
    domainEventBus.publishAfterCommit(afterCommit, 'security.event', {
      securityEventId,
      type: signal.type,
      severity: signal.severity,
    })
    return securityEventId
  })
}

function rationale(type: string): string {
  const rationales: Record<string, string> = {
    BRUTE_FORCE_LOGIN: 'Repeated failed authentication attempts reached the configured threshold.',
    ACCOUNT_LOCKED: 'Authentication lockout was triggered by repeated failures.',
    REFRESH_TOKEN_REUSE: 'A previously rotated refresh token was presented again.',
    PRIVILEGE_ESCALATION_ATTEMPT: 'A burst of forbidden requests or role changes was detected.',
    UNAUTHORIZED_BURST: 'A burst of requests without a valid session was detected.',
    PRIVILEGED_ACCOUNT_DEACTIVATED: 'A privileged account was deactivated.',
    NEW_DEVICE_LOGIN: 'The account authenticated using an unrecognized device fingerprint.',
    PASSWORD_CHANGED: 'The account password was changed.',
    CREDENTIAL_CHANGE_BURST: 'Password changes exceeded the configured rate threshold.',
    CREDENTIAL_CHANGE_AFTER_NEW_DEVICE:
      'A password was changed soon after an unrecognized device accessed the account.',
    IMPOSSIBLE_TRAVEL:
      'A login from another country followed a recent login too quickly to be plausible.',
    MASS_SHIPMENT_REQUESTS: 'A customer created shipments above the configured rate threshold.',
    MASS_SHIPMENT_CANCELLATIONS:
      'A customer cancelled shipments above the configured rate threshold.',
  }
  return rationales[type] ?? 'A configured security signal was detected.'
}

async function handleSecuritySignal(signal: SecuritySignal): Promise<void> {
  const classified = await classifySignal(signal)
  if (!classified) return
  const eventId = await persistSecurityEvent(classified)
  if (eventId) {
    logger.warn(
      { securityEventId: eventId, type: classified.type, severity: classified.severity },
      'Security event recorded',
    )
  }
}

export function startSecuritySignalWorker(): () => void {
  return domainEventBus.subscribe('security.signal', (signal) => {
    void handleSecuritySignal(signal).catch((error: unknown) => {
      logger.error(
        { err: error, signalType: signal.type },
        'Security signal could not be processed',
      )
    })
  })
}
