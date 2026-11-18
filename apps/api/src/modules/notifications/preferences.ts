import type {
  NotificationEmailPreference,
  NotificationEmailPreferenceType,
  UserRole,
} from '@routecommand/shared'

import { BadRequestError } from '../../core/errors/app-error.js'
import { withTransaction, query } from '../../db/pool.js'
import type { AuthRequestContext } from '../auth/types.js'

const preferenceTypesByRole: Record<UserRole, readonly NotificationEmailPreferenceType[]> = {
  CUSTOMER: ['CUSTOMER_SHIPMENT_UPDATES'],
  DRIVER: ['DRIVER_REQUEST_INVITATIONS'],
  DISPATCHER: ['DISPATCHER_NEW_REQUESTS'],
  ADMIN: ['DISPATCHER_NEW_REQUESTS'],
}

export async function getNotificationPreferences(userId: string, role: UserRole) {
  const allowedTypes = preferenceTypesByRole[role]
  const result = await query<{ type: NotificationEmailPreferenceType; email_enabled: boolean }>(
    'SELECT type, email_enabled FROM notification_preferences WHERE user_id = $1 AND type = ANY($2::text[])',
    [userId, allowedTypes],
  )
  const saved = new Map(result.rows.map((row) => [row.type, row.email_enabled]))
  const preferences: NotificationEmailPreference[] = allowedTypes.map((type) => ({
    type,
    emailEnabled: saved.get(type) ?? true,
  }))
  return { preferences, mandatory: { type: 'ACCOUNT_SECURITY', emailEnabled: true as const } }
}

export async function updateNotificationPreferences(
  userId: string,
  role: UserRole,
  preferences: NotificationEmailPreference[],
  context: AuthRequestContext,
) {
  const allowedTypes = preferenceTypesByRole[role]
  if (preferences.some(({ type }) => !allowedTypes.includes(type))) {
    throw new BadRequestError('One or more preferences are not available for this account role.')
  }

  await withTransaction(async (executor) => {
    for (const preference of preferences) {
      await executor.query(
        `INSERT INTO notification_preferences (user_id, type, email_enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, type) DO UPDATE
           SET email_enabled = EXCLUDED.email_enabled, updated_at = now()`,
        [userId, preference.type, preference.emailEnabled],
      )
    }
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, 'notifications.preferences_updated', 'notification_preferences', $1, $2::jsonb, $3)`,
      [userId, JSON.stringify({ preferences }), context.ip ?? null],
    )
  })
  return getNotificationPreferences(userId, role)
}
