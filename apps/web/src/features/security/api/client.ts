import { authenticatedFetch } from '../../auth/auth-client'

export interface SecurityEventRecord {
  id: string
  type: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  userId: string | null
  userName: string | null
  ip: string | null
  userAgent: string | null
  evidence: Record<string, unknown>
  status: 'OPEN' | 'REVIEWED' | 'DISMISSED'
  reviewedBy: string | null
  createdAt: string
  updatedAt: string
}

async function readBody<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? 'Security events could not be loaded.')
  }
  return body.data
}

export const securityEventsApi = {
  async list(filters: { status?: string; severity?: string } = {}) {
    const search = new URLSearchParams({ limit: '50', ...filters })
    const response = await authenticatedFetch(`/api/v1/admin/security-events?${search}`)
    const body = (await response.json().catch(() => ({}))) as {
      data?: SecurityEventRecord[]
      meta?: { total?: number }
      error?: { message?: string }
    }
    if (!response.ok || !body.data) {
      throw new Error(body.error?.message ?? 'Security events could not be loaded.')
    }
    return { data: body.data, total: body.meta?.total ?? body.data.length }
  },
  async update(id: string, status: 'REVIEWED' | 'DISMISSED') {
    return readBody<SecurityEventRecord>(
      await authenticatedFetch(`/api/v1/admin/security-events/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    )
  },
}
