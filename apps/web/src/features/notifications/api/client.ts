import type {
  NotificationEmailPreference,
  NotificationEmailPreferenceType,
} from '@routecommand/shared'

import { authenticatedFetch } from '../../auth/auth-client'

export interface NotificationPreferences {
  preferences: NotificationEmailPreference[]
  mandatory: { type: 'ACCOUNT_SECURITY'; emailEnabled: true }
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? 'Notification preferences could not be loaded.')
  }
  return body.data
}

export const notificationPreferencesApi = {
  async get() {
    return readData<NotificationPreferences>(
      await authenticatedFetch('/api/v1/notifications/preferences'),
    )
  },
  async update(preferences: NotificationEmailPreference[]) {
    return readData<NotificationPreferences>(
      await authenticatedFetch('/api/v1/notifications/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferences }),
      }),
    )
  },
  label(type: NotificationEmailPreferenceType) {
    const labels: Record<NotificationEmailPreferenceType, string> = {
      CUSTOMER_SHIPMENT_UPDATES: 'Shipment status updates',
      DRIVER_REQUEST_INVITATIONS: 'New delivery request invitations',
      DISPATCHER_NEW_REQUESTS: 'New customer requests',
    }
    return labels[type]
  },
  description(type: NotificationEmailPreferenceType) {
    const descriptions: Record<NotificationEmailPreferenceType, string> = {
      CUSTOMER_SHIPMENT_UPDATES: 'Updates about pickup, transit, and delivery for your shipments.',
      DRIVER_REQUEST_INVITATIONS: 'Optional invitations to review nearby delivery work.',
      DISPATCHER_NEW_REQUESTS: 'Email notices when customers create delivery requests.',
    }
    return descriptions[type]
  },
}
