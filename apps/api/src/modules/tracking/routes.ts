import { publicTrackingParamsSchema } from '@routecommand/shared'
import { Router } from 'express'

import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'
import type { AuthenticatedRequest } from '../auth/types.js'
import { getCustomerTracking, getPublicTracking } from './service.js'

export const trackingRouter = Router()
trackingRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0')
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  next()
})
trackingRouter.get(
  '/:trackingCode/customer',
  authenticate,
  authorize('CUSTOMER'),
  validate('params', publicTrackingParamsSchema),
  async (request, response) => {
    const customer = (request as typeof request & AuthenticatedRequest).authUser!
    const { trackingCode } = request.params as { trackingCode: string }
    response.status(200).json({ data: await getCustomerTracking(trackingCode, customer.id) })
  },
)
trackingRouter.get(
  '/:trackingCode',
  validate('params', publicTrackingParamsSchema),
  async (request, response) => {
    const { trackingCode } = request.params as { trackingCode: string }
    response.status(200).json({ data: await getPublicTracking(trackingCode) })
  },
)
