import {
  endNavigationSchema,
  navigationProgressSchema,
  navigationSessionIdSchema,
  navigationRerouteSchema,
  routePreviewSchema,
  startNavigationSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { active, activeAll, detail, end, preview, progress, reroute, start } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const navigationRouter = Router()
navigationRouter.use(authenticate)
navigationRouter.post(
  '/routes',
  authorize('DRIVER', 'DISPATCHER', 'ADMIN'),
  validate('body', routePreviewSchema),
  preview,
)
navigationRouter.post(
  '/sessions',
  authorize('DRIVER'),
  validate('body', startNavigationSchema),
  start,
)
navigationRouter.get('/sessions/active/me', authorize('DRIVER'), active)
navigationRouter.get('/sessions/active', authorize('DISPATCHER', 'ADMIN'), activeAll)
navigationRouter.get(
  '/sessions/:sessionId',
  authorize('DRIVER', 'DISPATCHER', 'ADMIN'),
  validate('params', navigationSessionIdSchema),
  detail,
)
navigationRouter.post(
  '/sessions/:sessionId/reroute',
  authorize('DRIVER'),
  validate('params', navigationSessionIdSchema),
  validate('body', navigationRerouteSchema),
  reroute,
)
navigationRouter.post(
  '/sessions/:sessionId/progress',
  authorize('DRIVER'),
  validate('params', navigationSessionIdSchema),
  validate('body', navigationProgressSchema),
  progress,
)
navigationRouter.post(
  '/sessions/:sessionId/end',
  authorize('DRIVER'),
  validate('params', navigationSessionIdSchema),
  validate('body', endNavigationSchema),
  end,
)
