import { createHash } from 'node:crypto'

import type { NotificationEmailPreferenceType } from '@routecommand/shared'
import { Queue, UnrecoverableError, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { Redis } from 'ioredis'

import { createEmailProvider, type EmailProvider } from './email-provider.js'
import { env } from '../config/env.js'
import { logger } from '../core/logger.js'
import { query, type DatabaseExecutor, type RegisterAfterCommit } from '../db/pool.js'

const queueName = 'routecommand-email'
const circuitFailureKey = 'routecommand:email:circuit:failures'
const circuitOpenKey = 'routecommand:email:circuit:open'

export interface OutboundEmail {
  logId: string
  recipient: string
  subject: string
  text: string
  html: string
}

let emailQueue: Queue<OutboundEmail> | undefined
let emailWorker: Worker<OutboundEmail> | undefined
let queueConnection: Redis | undefined
let workerConnection: Redis | undefined
let emailProvider: EmailProvider | undefined
let providerVerified = false

function connection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true })
}

async function consumeHourlyQuota(key: string, limit: number): Promise<boolean> {
  if (!workerConnection) throw new Error('Email worker connection is not ready.')
  const count = await workerConnection.incr(key)
  if (count === 1) await workerConnection.expire(key, 3_600)
  return count <= limit
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return replacements[character]!
  })
}

export function renderActionEmail(input: {
  greeting: string
  action: string
  url: string
  expiresIn: string
}): { text: string; html: string } {
  const greeting = htmlEscape(input.greeting)
  const action = htmlEscape(input.action)
  const url = htmlEscape(input.url)
  const expiry = htmlEscape(input.expiresIn)
  return {
    text: `${input.greeting}\n\n${input.action}: ${input.url}\n\nThis link expires in ${input.expiresIn}. If you did not request this, ignore this email.`,
    html: `<main><p>Hello ${greeting},</p><p>${action}:</p><p><a href="${url}">Continue securely</a></p><p>This link expires in ${expiry}. If you did not request this, ignore this email.</p></main>`,
  }
}

export async function startEmailInfrastructure(): Promise<void> {
  if (emailWorker) return
  queueConnection = connection()
  workerConnection = connection()
  emailQueue = new Queue<OutboundEmail>(queueName, { connection: queueConnection })
  emailProvider = createEmailProvider()
  await Promise.all([emailQueue.waitUntilReady(), emailProvider.verify()])
  providerVerified = true
  logger.info({ provider: emailProvider.name }, 'Email provider verified')
  emailWorker = new Worker<OutboundEmail>(
    queueName,
    async (job: Job<OutboundEmail>) => {
      const { logId, recipient, subject, text, html } = job.data
      const suppressed = await query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM email_suppressions WHERE email = $1) AS exists',
        [recipient],
      )
      if (suppressed.rows[0]?.exists) {
        await query(
          "UPDATE email_logs SET status = 'SUPPRESSED', last_error = 'Recipient address is suppressed.' WHERE id = $1",
          [logId],
        )
        return
      }
      const recipientKey = createHash('sha256').update(recipient.trim().toLowerCase()).digest('hex')
      const [recipientAllowed, globalAllowed] = await Promise.all([
        consumeHourlyQuota(
          `routecommand:email:recipient:${recipientKey}:${Math.floor(Date.now() / 3_600_000)}`,
          env.EMAIL_RECIPIENT_MAX_PER_HOUR,
        ),
        consumeHourlyQuota(
          `routecommand:email:global:${Math.floor(Date.now() / 3_600_000)}`,
          env.EMAIL_GLOBAL_MAX_PER_HOUR,
        ),
      ])
      if (!recipientAllowed || !globalAllowed) {
        await query(
          "UPDATE email_logs SET status = 'FAILED', last_error = 'Email send rate limit reached.' WHERE id = $1",
          [logId],
        )
        throw new UnrecoverableError('Email send rate limit reached.')
      }
      await query("UPDATE email_logs SET status = 'SENDING', attempts = $2 WHERE id = $1", [
        logId,
        job.attemptsMade + 1,
      ])
      if (await workerConnection!.exists(circuitOpenKey)) {
        throw new Error('Email provider circuit breaker is open.')
      }
      let result: { providerMessageId: string }
      try {
        result = await emailProvider!.send({
          to: recipient,
          subject,
          text,
          html,
          idempotencyKey: logId,
          headers: { 'X-RouteCommand-Email-Log-ID': logId },
        })
      } catch (error) {
        const responseCode =
          typeof error === 'object' && error !== null && 'responseCode' in error
            ? Number(error.responseCode)
            : undefined
        if (responseCode !== undefined && responseCode >= 500 && responseCode < 600) {
          await query(
            `INSERT INTO email_suppressions (email, reason) VALUES ($1, 'HARD_BOUNCE')
             ON CONFLICT (email) DO NOTHING`,
            [recipient],
          )
          await query(
            "UPDATE email_logs SET status = 'BOUNCED', last_error = 'SMTP permanently rejected this recipient.' WHERE id = $1",
            [logId],
          )
          throw new UnrecoverableError('SMTP permanently rejected the recipient.')
        }
        const failures = await workerConnection!.incr(circuitFailureKey)
        if (failures === 1) await workerConnection!.expire(circuitFailureKey, 60)
        if (failures >= env.EMAIL_CIRCUIT_FAILURE_THRESHOLD) {
          await workerConnection!.set(circuitOpenKey, '1', 'EX', 60)
          logger.error({ failures }, 'Email provider circuit breaker opened')
        }
        throw error
      }
      await workerConnection!.del(circuitFailureKey, circuitOpenKey)
      await query(
        "UPDATE email_logs SET status = 'SENT', provider = $2, provider_message_id = $3, sent_at = now(), last_error = NULL WHERE id = $1",
        [logId, emailProvider!.name, result.providerMessageId],
      )
    },
    { connection: workerConnection, concurrency: 4 },
  )
  emailWorker.on('failed', (job, error) => {
    logger.warn(
      { err: error, emailLogId: job?.data.logId, attempt: job?.attemptsMade },
      'Email delivery attempt failed',
    )
    if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
      void query(
        "UPDATE email_logs SET status = 'FAILED', last_error = $2 WHERE id = $1 AND status = 'SENDING'",
        [job.data.logId, 'SMTP delivery failed after retries.'],
      )
    }
  })
  emailWorker.on('error', (error) => logger.error({ err: error }, 'Email worker error'))
}

export async function queueTransactionalEmail(
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
  input: {
    userId: string
    entity?: 'shipment' | 'user' | 'security_event'
    entityId?: string
    recipient: string
    template: string
    dedupeKey: string
    subject: string
    text: string
    html: string
    preferenceType?: NotificationEmailPreferenceType
    payload?: Record<string, unknown>
  },
): Promise<void> {
  if (input.preferenceType) {
    const preference = await executor.query<{ email_enabled: boolean }>(
      'SELECT email_enabled FROM notification_preferences WHERE user_id = $1 AND type = $2',
      [input.userId, input.preferenceType],
    )
    if (preference.rows[0]?.email_enabled === false) return
  }

  const notification = await executor.query<{ id: string }>(
    `INSERT INTO notification_events (type, entity, entity_id, dedupe_key, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      input.template,
      input.entity ?? 'user',
      input.entityId ?? input.userId,
      `email-event:${input.dedupeKey}`,
      JSON.stringify(input.payload ?? {}),
    ],
  )
  let notificationEventId = notification.rows[0]?.id
  if (!notificationEventId) {
    const existing = await executor.query<{ id: string }>(
      'SELECT id FROM notification_events WHERE dedupe_key = $1',
      [`email-event:${input.dedupeKey}`],
    )
    notificationEventId = existing.rows[0]?.id
  }
  if (!notificationEventId) throw new Error('Notification event could not be persisted.')

  const log = await executor.query<{ id: string }>(
    `INSERT INTO email_logs (notification_event_id, recipient_user_id, recipient_email, template, subject, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      notificationEventId,
      input.userId,
      input.recipient,
      input.template,
      input.subject,
      input.dedupeKey,
    ],
  )
  if (!log.rows[0]) return
  const job: OutboundEmail = {
    logId: log.rows[0].id,
    recipient: input.recipient,
    subject: input.subject,
    text: input.text,
    html: input.html,
  }
  const jobId = `email_${createHash('sha256').update(input.dedupeKey).digest('hex')}`
  afterCommit(async () => {
    if (!emailQueue) throw new Error('Email queue has not been started.')
    try {
      await emailQueue.add(input.template, job, {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      })
    } catch (error) {
      await query(
        "UPDATE email_logs SET status = 'FAILED', last_error = 'Queue submission failed.' WHERE id = $1",
        [job.logId],
      )
      throw error
    }
  })
}

export async function closeEmailInfrastructure(): Promise<void> {
  await Promise.allSettled([emailWorker?.close(), emailQueue?.close()])
  await Promise.allSettled([queueConnection?.quit(), workerConnection?.quit()])
  emailProvider?.close()
  emailWorker = undefined
  emailQueue = undefined
  queueConnection = undefined
  workerConnection = undefined
  emailProvider = undefined
  providerVerified = false
}

export async function checkEmailInfrastructureHealth(): Promise<void> {
  if (!emailQueue || !emailWorker || !emailProvider || !providerVerified) {
    throw new Error('Email infrastructure is not ready.')
  }
  await emailQueue.waitUntilReady()
  if (emailWorker.closing) throw new Error('Email worker is not running.')
}

export async function retryFailedEmailJob(dedupeKey: string): Promise<void> {
  if (!emailQueue) throw new Error('Email queue is not ready.')
  const jobId = `email_${createHash('sha256').update(dedupeKey).digest('hex')}`
  const job = await emailQueue.getJob(jobId)
  if (!job || (await job.getState()) !== 'failed') {
    throw new Error('The retained failed email job is not available for retry.')
  }
  await job.retry('failed')
}
