import {
  checkZonePointSchema,
  createZoneSchema,
  listZonesQuerySchema,
  updateZoneSchema,
  zoneGeoJsonQuerySchema,
  zoneIdParamsSchema,
  zoneUpdateGuardSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { checkPoint, create, deactivate, detail, geojson, list, update } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const zonesRouter = Router()
zonesRouter.use(authenticate)
zonesRouter.get(
  '/geojson',
  authorize('ADMIN', 'DISPATCHER', 'DRIVER'),
  validate('query', zoneGeoJsonQuerySchema),
  geojson,
)
zonesRouter.get(
  '/',
  authorize('ADMIN', 'DISPATCHER', 'DRIVER'),
  validate('query', listZonesQuerySchema),
  list,
)
zonesRouter.get(
  '/:zoneId',
  authorize('ADMIN', 'DISPATCHER'),
  validate('params', zoneIdParamsSchema),
  detail,
)
zonesRouter.use(authorize('ADMIN', 'DISPATCHER'))
zonesRouter.post('/check-point', validate('body', checkZonePointSchema), checkPoint)
zonesRouter.post('/', validate('body', createZoneSchema), create)
zonesRouter.patch(
  '/:zoneId',
  validate('params', zoneIdParamsSchema),
  validate('body', updateZoneSchema),
  update,
)
zonesRouter.delete(
  '/:zoneId',
  validate('params', zoneIdParamsSchema),
  validate('body', zoneUpdateGuardSchema),
  deactivate,
)
