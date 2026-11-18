import { authenticatedFetch } from '../../auth/auth-client'

export type EmailLogStatus =
  'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'SUPPRESSED'

export interface AdminEmailLog {
  id: string
  recipientEmail: string
  template: string
  status: EmailLogStatus
  provider: string | null
  providerMessageId: string | null
  attempts: number
  lastError: string | null
  queuedAt: string
  sentAt: string | null
}

export interface EmailSuppression {
  email: string
  reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL'
  createdAt: string
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? 'The email admin request could not be completed.')
  }
  return body.data
}

export const adminEmailApi = {
  async listLogs(filters: { status?: EmailLogStatus; recipient?: string } = {}) {
    const search = new URLSearchParams({ limit: '50', ...filters })
    const response = await authenticatedFetch(`/api/v1/admin/email-log?${search}`)
    const body = (await response.json().catch(() => ({}))) as {
      data?: AdminEmailLog[]
      total?: number
      error?: { message?: string }
    }
    if (!response.ok || !body.data) {
      throw new Error(body.error?.message ?? 'Email logs could not be loaded.')
    }
    return { data: body.data, total: body.total ?? body.data.length }
  },
  async suppressions() {
    return readData<EmailSuppression[]>(
      await authenticatedFetch('/api/v1/admin/email-suppressions'),
    )
  },
  async retry(emailId: string) {
    await readData(
      await authenticatedFetch(`/api/v1/admin/email-log/${emailId}/retry`, { method: 'POST' }),
    )
  },
  async clearSuppression(email: string) {
    const response = await authenticatedFetch(
      `/api/v1/admin/email-suppressions/${encodeURIComponent(email)}`,
      { method: 'DELETE' },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'The suppression could not be cleared.')
    }
  },
}
