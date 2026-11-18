import nodemailer, { type Transporter } from 'nodemailer'

import { env } from '../config/env.js'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  idempotencyKey?: string
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<{ providerMessageId: string }>
  verify(): Promise<void>
  close(): void
}

export class NodemailerSmtpProvider implements EmailProvider {
  readonly name = 'smtp'
  private readonly transport: Transporter

  constructor() {
    const auth = env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: env.NODE_ENV === 'production' && !env.SMTP_SECURE,
      pool: true,
      maxConnections: env.SMTP_MAX_CONNECTIONS,
      maxMessages: env.SMTP_MAX_MESSAGES,
      ...(auth ? { auth } : {}),
    })
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const result = await this.transport.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.idempotencyKey
        ? { messageId: `<${message.idempotencyKey}@routecommand.local>` }
        : {}),
    })
    return { providerMessageId: result.messageId }
  }

  async verify(): Promise<void> {
    await this.transport.verify()
  }

  close(): void {
    this.transport.close()
  }
}

/** Console output is intentionally available only to tests. */
export class ConsoleProvider implements EmailProvider {
  readonly name = 'console'

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `console-${Date.now()}`
    console.info('Test email captured', {
      to: message.to,
      subject: message.subject,
      providerMessageId,
    })
    return { providerMessageId }
  }

  async verify(): Promise<void> {}
  close(): void {}
}

export function createEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'console') {
    if (env.NODE_ENV !== 'test') {
      throw new Error('EMAIL_PROVIDER=console is only allowed in tests.')
    }
    return new ConsoleProvider()
  }
  return new NodemailerSmtpProvider()
}
