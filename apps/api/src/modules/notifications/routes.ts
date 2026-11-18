import { updateNotificationPreferencesSchema } from '@routecommand/shared'
import { Router } from 'express'

import { getPreferences, putPreferences } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate } from '../auth/authenticate.js'

export const notificationsRouter = Router()
notificationsRouter.use(authenticate)
notificationsRouter.get('/preferences', getPreferences)
notificationsRouter.put(
  '/preferences',
  validate('body', updateNotificationPreferencesSchema),
  putPreferences,
)
