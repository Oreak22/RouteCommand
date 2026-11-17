import { createHash } from 'node:crypto'

import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { Redis } from 'ioredis'
import nodemailer from 'nodemailer'

import { env } from '../config/env.js'
import { logger } from '../core/logger.js'
import { query, type DatabaseExecutor, type RegisterAfterCommit } from '../db/pool.js'

const queueName = 'routecommand-email'

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

function connection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true })
}

function createMailer() {
  const auth = env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(auth ? { auth } : {}),
  })
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
  const mailer = createMailer()
  emailWorker = new Worker<OutboundEmail>(
    queueName,
    async (job: Job<OutboundEmail>) => {
      const { logId, recipient, subject, text, html } = job.data
      await query("UPDATE email_logs SET status = 'SENDING', attempts = $2 WHERE id = $1", [
        logId,
        job.attemptsMade + 1,
      ])
      const result = await mailer.sendMail({
        from: env.SMTP_FROM,
        to: recipient,
        subject,
        text,
        html,
      })
      await query(
        "UPDATE email_logs SET status = 'SENT', provider = 'smtp', provider_message_id = $2, sent_at = now(), last_error = NULL WHERE id = $1",
        [logId, result.messageId],
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
      void query("UPDATE email_logs SET status = 'FAILED', last_error = $2 WHERE id = $1", [
        job.data.logId,
        'SMTP delivery failed after retries.',
      ])
    }
  })
  emailWorker.on('error', (error) => logger.error({ err: error }, 'Email worker error'))
}

export async function queueTransactionalEmail(
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
  input: {
    userId: string
    recipient: string
    template: string
    dedupeKey: string
    subject: string
    text: string
    html: string
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const notification = await executor.query<{ id: string }>(
    `INSERT INTO notification_events (type, entity, entity_id, dedupe_key, payload)
     VALUES ($1, 'user', $2, $3, $4::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
     RETURNING id`,
    [
      input.template,
      input.userId,
      `email-event:${input.dedupeKey}`,
      JSON.stringify(input.payload ?? {}),
    ],
  )
  const log = await executor.query<{ id: string }>(
    `INSERT INTO email_logs (notification_event_id, recipient_user_id, recipient_email, template, subject, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
     RETURNING id`,
    [
      notification.rows[0]!.id,
      input.userId,
      input.recipient,
      input.template,
      input.subject,
      input.dedupeKey,
    ],
  )
  const job: OutboundEmail = {
    logId: log.rows[0]!.id,
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
        backoff: { type: 'exponential', delay: 2_000 },
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
  emailWorker = undefined
  emailQueue = undefined
  queueConnection = undefined
  workerConnection = undefined
}
