import {
  assignVehicleSchema,
  driverIdParamsSchema,
  driverStatusUpdateSchema,
  listDriversQuerySchema,
  nearbyDriversQuerySchema,
  updateDriverSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { assignVehicle, detail, list, me, nearby, update, updateMeStatus } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const driversRouter = Router()
driversRouter.use(authenticate)
driversRouter.get('/me', authorize('DRIVER'), me)
driversRouter.patch(
  '/me/status',
  authorize('DRIVER'),
  validate('body', driverStatusUpdateSchema),
  updateMeStatus,
)
driversRouter.get(
  '/nearby',
  authorize('ADMIN', 'DISPATCHER'),
  validate('query', nearbyDriversQuerySchema),
  nearby,
)
driversRouter.get(
  '/',
  authorize('ADMIN', 'DISPATCHER'),
  validate('query', listDriversQuerySchema),
  list,
)
driversRouter.get(
  '/:driverId',
  authorize('ADMIN', 'DISPATCHER'),
  validate('params', driverIdParamsSchema),
  detail,
)
driversRouter.patch(
  '/:driverId',
  authorize('ADMIN', 'DISPATCHER'),
  validate('params', driverIdParamsSchema),
  validate('body', updateDriverSchema),
  update,
)
driversRouter.post(
  '/:driverId/assign-vehicle',
  authorize('ADMIN', 'DISPATCHER'),
  validate('params', driverIdParamsSchema),
  validate('body', assignVehicleSchema),
  assignVehicle,
)
