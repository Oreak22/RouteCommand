import {
  cancelShipmentSchema,
  createShipmentSchema,
  listShipmentsQuerySchema,
  shipmentCustomerQuerySchema,
  shipmentIdParamsSchema,
  transitionShipmentSchema,
  updateShipmentSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import {
  cancel,
  create,
  customers,
  detail,
  events,
  list,
  transition,
  update,
} from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const shipmentsRouter = Router()
shipmentsRouter.use(authenticate)
shipmentsRouter.get('/', validate('query', listShipmentsQuerySchema), list)
shipmentsRouter.get(
  '/customers',
  authorize('ADMIN', 'DISPATCHER'),
  validate('query', shipmentCustomerQuerySchema),
  customers,
)
shipmentsRouter.post(
  '/',
  authorize('ADMIN', 'DISPATCHER', 'CUSTOMER'),
  validate('body', createShipmentSchema),
  create,
)
shipmentsRouter.get('/:shipmentId/events', validate('params', shipmentIdParamsSchema), events)
shipmentsRouter.get('/:shipmentId', validate('params', shipmentIdParamsSchema), detail)
shipmentsRouter.patch(
  '/:shipmentId',
  authorize('ADMIN', 'DISPATCHER'),
  validate('params', shipmentIdParamsSchema),
  validate('body', updateShipmentSchema),
  update,
)
shipmentsRouter.post(
  '/:shipmentId/transition',
  validate('params', shipmentIdParamsSchema),
  validate('body', transitionShipmentSchema),
  transition,
)
shipmentsRouter.post(
  '/:shipmentId/cancel',
  validate('params', shipmentIdParamsSchema),
  validate('body', cancelShipmentSchema),
  cancel,
)
