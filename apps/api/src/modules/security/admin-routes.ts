import { Router } from 'express'

import { getSecurityEvent, listSecurityEvents, patchSecurityEvent } from './admin-controller.js'
import {
  securityEventListSchema,
  securityEventParamsSchema,
  securityEventStatusSchema,
} from './admin-schemas.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const securityAdminRouter = Router()
securityAdminRouter.use(authenticate, authorize('ADMIN'))
securityAdminRouter.get('/', validate('query', securityEventListSchema), listSecurityEvents)
securityAdminRouter.get(
  '/:eventId',
  validate('params', securityEventParamsSchema),
  getSecurityEvent,
)
securityAdminRouter.patch(
  '/:eventId',
  validate('params', securityEventParamsSchema),
  validate('body', securityEventStatusSchema),
  patchSecurityEvent,
)
