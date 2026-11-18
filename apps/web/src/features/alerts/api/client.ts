import type { AlertSeverity, AlertStatus, AlertType } from '@routecommand/shared'

import { authenticatedFetch } from '../../auth/auth-client'

export interface AlertRecord {
  id: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  driverId: string | null
  driverName: string | null
  zoneId: string | null
  zoneName: string | null
  shipmentId: string | null
  trackingCode: string | null
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface AlertStats {
  total: number
  byStatus: Record<AlertStatus, number>
  bySeverity: Record<AlertSeverity, number>
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T; error?: { message?: string } }
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? 'The alert request could not be completed.')
  }
  return body.data
}

export const alertsApi = {
  async list(filters: { status?: AlertStatus; severity?: AlertSeverity } = {}) {
    const search = new URLSearchParams({ limit: '100', ...filters })
    const response = await authenticatedFetch(`/api/v1/alerts?${search}`)
    const body = (await response.json()) as {
      data?: AlertRecord[]
      error?: { message?: string }
      meta?: { total?: number }
    }
    if (!response.ok || !body.data)
      throw new Error(body.error?.message ?? 'Alerts could not be loaded.')
    return { data: body.data, total: body.meta?.total ?? body.data.length }
  },
  async stats() {
    return readData<AlertStats>(await authenticatedFetch('/api/v1/alerts/stats'))
  },
  async acknowledge(id: string) {
    return readData<AlertRecord>(
      await authenticatedFetch(`/api/v1/alerts/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
  },
  async resolve(id: string) {
    return readData<AlertRecord>(
      await authenticatedFetch(`/api/v1/alerts/${id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
  },
}
