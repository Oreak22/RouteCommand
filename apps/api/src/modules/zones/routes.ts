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
zonesRouter.use(authenticate, authorize('ADMIN', 'DISPATCHER'))
zonesRouter.get('/geojson', validate('query', zoneGeoJsonQuerySchema), geojson)
zonesRouter.post('/check-point', validate('body', checkZonePointSchema), checkPoint)
zonesRouter.get('/', validate('query', listZonesQuerySchema), list)
zonesRouter.post('/', validate('body', createZoneSchema), create)
zonesRouter.get('/:zoneId', validate('params', zoneIdParamsSchema), detail)
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
