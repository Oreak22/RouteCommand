import { createHash } from 'node:crypto'

import type { UserRole } from '@routecommand/shared'
import type { RequestHandler } from 'express'

import { authenticateAccessToken } from './service.js'
import type { AuthenticatedRequest } from './types.js'
import { ForbiddenError, UnauthorizedError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { redisClient } from '../../infra/redis.js'

async function recordDeniedRequest(
  type: 'unauthorized_burst' | 'forbidden_burst',
  ip: string | undefined,
): Promise<void> {
  try {
    const ipHash = createHash('sha256')
      .update(ip ?? 'unknown')
      .digest('hex')
    const key = `routecommand:auth:${type}:${ipHash}`
    const count = await redisClient.incr(key)
    if (count === 1) await redisClient.expire(key, 60)
    if (count === 10) {
      domainEventBus.publish('security.signal', {
        type,
        occurredAt: new Date().toISOString(),
        ...(ip ? { ip } : {}),
        evidence: { requestCount: count, windowSeconds: 60 },
      })
    }
  } catch {
    // Denial counting is best-effort; authentication itself remains fail-closed.
  }
}

export const authenticate: RequestHandler = async (request, _response, next) => {
  try {
    const authorization = request.get('authorization')
    const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/)
    if (!match) throw new UnauthorizedError()

    const identity = await authenticateAccessToken(match[1]!)

    const authRequest = request as typeof request & AuthenticatedRequest
    authRequest.authUser = {
      ...identity.user,
    }
    authRequest.sessionId = identity.sessionId
    if (identity.driverId) authRequest.driverId = identity.driverId
    if (identity.vehicleType) authRequest.vehicleType = identity.vehicleType
    next()
  } catch (error) {
    if (error instanceof UnauthorizedError)
      void recordDeniedRequest('unauthorized_burst', request.ip)
    next(error)
  }
}

export function authorize(...roles: UserRole[]): RequestHandler {
  return (request, _response, next) => {
    const authRequest = request as typeof request & AuthenticatedRequest
    if (!authRequest.authUser) {
      void recordDeniedRequest('unauthorized_burst', request.ip)
      return next(new UnauthorizedError())
    }
    if (!roles.includes(authRequest.authUser.role)) {
      void recordDeniedRequest('forbidden_burst', request.ip)
      return next(new ForbiddenError())
    }
    return next()
  }
}
