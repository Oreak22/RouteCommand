import {
  telemetryBatchSchema,
  telemetryDriverIdParamsSchema,
  telemetryPointsQuerySchema,
  telemetryTrackQuerySchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { ingestBatch } from './controller.js'
import { driverPoints, driverTrack } from './history-controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const telemetryRouter = Router()
telemetryRouter.use(authenticate)
telemetryRouter.get(
  '/drivers/:driverId/track',
  authorize('ADMIN', 'DISPATCHER', 'DRIVER'),
  validate('params', telemetryDriverIdParamsSchema),
  validate('query', telemetryTrackQuerySchema),
  driverTrack,
)
telemetryRouter.get(
  '/drivers/:driverId/points',
  authorize('ADMIN', 'DISPATCHER', 'DRIVER'),
  validate('params', telemetryDriverIdParamsSchema),
  validate('query', telemetryPointsQuerySchema),
  driverPoints,
)
telemetryRouter.post(
  '/batch',
  authorize('DRIVER'),
  validate('body', telemetryBatchSchema),
  ingestBatch,
)
