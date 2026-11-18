import {
  dispatchAssignSchema,
  dispatchBatchAssignSchema,
  dispatchSuggestionsQuerySchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { assign, assignBatch, suggestions } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const dispatchRouter = Router()
dispatchRouter.use(authenticate, authorize('ADMIN', 'DISPATCHER'))
dispatchRouter.get('/suggestions', validate('query', dispatchSuggestionsQuerySchema), suggestions)
dispatchRouter.post('/assign', validate('body', dispatchAssignSchema), assign)
dispatchRouter.post('/assign-batch', validate('body', dispatchBatchAssignSchema), assignBatch)
