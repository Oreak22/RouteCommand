import { alertActionSchema, alertIdParamsSchema, listAlertsQuerySchema } from '@routecommand/shared'
import { Router } from 'express'

import { acknowledge, list, resolve, stats } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const alertsRouter = Router()
alertsRouter.use(authenticate, authorize('ADMIN', 'DISPATCHER'))
alertsRouter.get('/stats', stats)
alertsRouter.get('/', validate('query', listAlertsQuerySchema), list)
alertsRouter.post(
  '/:alertId/acknowledge',
  validate('params', alertIdParamsSchema),
  validate('body', alertActionSchema),
  acknowledge,
)
alertsRouter.post(
  '/:alertId/resolve',
  validate('params', alertIdParamsSchema),
  validate('body', alertActionSchema),
  resolve,
)
