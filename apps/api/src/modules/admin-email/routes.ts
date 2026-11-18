import { Router } from 'express'

import {
  deleteEmailSuppression,
  listEmailLog,
  listEmailSuppressions,
  retryEmail,
} from './controller.js'
import { emailIdParamsSchema, emailLogQuerySchema, suppressionParamsSchema } from './schemas.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const adminEmailRouter = Router()
adminEmailRouter.use(authenticate, authorize('ADMIN'))
adminEmailRouter.get('/email-log', validate('query', emailLogQuerySchema), listEmailLog)
adminEmailRouter.post(
  '/email-log/:emailId/retry',
  validate('params', emailIdParamsSchema),
  retryEmail,
)
adminEmailRouter.get('/email-suppressions', listEmailSuppressions)
adminEmailRouter.delete(
  '/email-suppressions/:email',
  validate('params', suppressionParamsSchema),
  deleteEmailSuppression,
)
