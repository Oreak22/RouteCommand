import {
  createVehicleSchema,
  listVehiclesQuerySchema,
  updateVehicleSchema,
  vehicleIdParamsSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { create, deactivate, detail, list, update } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const vehiclesRouter = Router()
vehiclesRouter.use(authenticate, authorize('ADMIN', 'DISPATCHER'))
vehiclesRouter.get('/', validate('query', listVehiclesQuerySchema), list)
vehiclesRouter.post('/', validate('body', createVehicleSchema), create)
vehiclesRouter.get('/:vehicleId', validate('params', vehicleIdParamsSchema), detail)
vehiclesRouter.patch(
  '/:vehicleId',
  validate('params', vehicleIdParamsSchema),
  validate('body', updateVehicleSchema),
  update,
)
vehiclesRouter.delete('/:vehicleId', validate('params', vehicleIdParamsSchema), deactivate)
