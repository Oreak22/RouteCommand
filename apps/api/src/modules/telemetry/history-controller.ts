import type { RequestHandler } from 'express'

import { getDriverTelemetryPoints, getDriverTrack } from './history-repository.js'
import { ForbiddenError } from '../../core/errors/app-error.js'
import type { AuthenticatedRequest } from '../auth/types.js'

function historyContext(request: Parameters<RequestHandler>[0]) {
  const authenticated = request as typeof request & AuthenticatedRequest
  const requestedDriverId = Array.isArray(request.params.driverId)
    ? request.params.driverId[0]
    : request.params.driverId
  if (authenticated.authUser?.role === 'DRIVER' && requestedDriverId !== authenticated.driverId) {
    throw new ForbiddenError('Drivers may only view their own telemetry history.')
  }
  return requestedDriverId!
}

export const driverTrack: RequestHandler = async (request, response) => {
  const data = await getDriverTrack(historyContext(request), request.query as never)
  response.status(200).json({ data })
}

export const driverPoints: RequestHandler = async (request, response) => {
  const data = await getDriverTelemetryPoints(historyContext(request), request.query as never)
  response.status(200).json(data)
}
