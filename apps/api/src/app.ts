import type { HealthResponse } from '@routecommand/shared'
import express from 'express'
import { pinoHttp } from 'pino-http'
import swaggerUi from 'swagger-ui-express'

import { env } from './config/env.js'
import { NotFoundError, ServiceUnavailableError } from './core/errors/app-error.js'
import { errorHandler } from './core/errors/error-handler.js'
import { logger } from './core/logger.js'
import { checkDatabaseHealth } from './db/pool.js'
import { checkEmailInfrastructureHealth } from './infra/email-queue.js'
import { checkRedisHealth } from './infra/redis.js'
import { requestIdMiddleware } from './middleware/request-id.js'
import {
  corsPolicy,
  createGlobalRateLimiter,
  parseCookies,
  preventParameterPollution,
  securityHeaders,
} from './middleware/security.js'
import { adminEmailRouter } from './modules/admin-email/routes.js'
import { alertsRouter } from './modules/alerts/routes.js'
import { authenticate, authorize } from './modules/auth/authenticate.js'
import { createAuthRouter } from './modules/auth/index.js'
import { dispatchRouter } from './modules/dispatch/routes.js'
import { driversRouter } from './modules/drivers/index.js'
import { notificationsRouter } from './modules/notifications/routes.js'
import { securityAdminRouter } from './modules/security/admin-routes.js'
import { shipmentsRouter } from './modules/shipments/index.js'
import { renderTelemetryMetrics, telemetryRouter } from './modules/telemetry/index.js'
import { usersRouter } from './modules/users/index.js'
import { vehiclesRouter } from './modules/vehicles/index.js'
import { zonesRouter } from './modules/zones/index.js'
import { openApiDocument } from './openapi/document.js'

export const createApp = () => {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', env.TRUST_PROXY_HOPS)
  app.use(requestIdMiddleware)
  app.use(
    pinoHttp({
      logger,
      customProps: (_request, response) => ({ requestId: response.locals.requestId }),
    }),
  )
  app.use(securityHeaders)
  app.use(corsPolicy)
  app.use(express.json({ limit: env.BODY_LIMIT_BYTES }))
  app.use(parseCookies)
  app.use(preventParameterPollution)
  app.use(createGlobalRateLimiter())
  app.use('/api/v1', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    next()
  })
  app.get(['/health', '/health/live'], (_request, response) => {
    const body: HealthResponse = { status: 'ok' }
    response.status(200).json(body)
  })
  app.get('/health/ready', async (_request, response, next) => {
    try {
      await Promise.all([
        checkDatabaseHealth(),
        checkRedisHealth(),
        checkEmailInfrastructureHealth(),
      ])
      response.status(200).json({
        status: 'ok',
        dependencies: { postgres: 'ok', redis: 'ok', email: 'ok' },
      })
    } catch {
      next(new ServiceUnavailableError('A required service is not ready.'))
    }
  })
  app.use('/api/v1/auth', createAuthRouter())
  app.use('/api/v1/admin', adminEmailRouter)
  app.use('/api/v1/admin/security-events', securityAdminRouter)
  app.use('/api/v1/notifications', notificationsRouter)
  app.use('/api/v1/alerts', alertsRouter)
  app.use('/api/v1/users', usersRouter)
  app.use('/api/v1/drivers', driversRouter)
  app.use('/api/v1/dispatch', dispatchRouter)
  app.use('/api/v1/vehicles', vehiclesRouter)
  app.use('/api/v1/zones', zonesRouter)
  app.use('/api/v1/shipments', shipmentsRouter)
  app.use('/api/v1/telemetry', telemetryRouter)
  app.get('/metrics', authenticate, authorize('ADMIN'), async (_request, response) => {
    response.type('text/plain; version=0.0.4; charset=utf-8').send(await renderTelemetryMetrics())
  })

  if (env.NODE_ENV !== 'production') {
    app.get('/openapi.json', (_request, response) => response.json(openApiDocument))
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
  }

  app.use((_request, _response, next) => next(new NotFoundError('Route not found.')))
  app.use(errorHandler)

  return app
}
