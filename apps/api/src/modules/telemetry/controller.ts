import type { RequestHandler } from 'express'

import { recordIngestionMetrics } from './metrics.js'
import { ingestTelemetryBatch } from './service.js'
import type { AuthenticatedRequest } from '../auth/types.js'

export const ingestBatch: RequestHandler = async (request, response) => {
  const authenticated = request as typeof request & AuthenticatedRequest
  const startedAt = performance.now()
  try {
    const result = await ingestTelemetryBatch(request.body, {
      role: authenticated.authUser!.role,
      ...(authenticated.driverId ? { driverId: authenticated.driverId } : {}),
      ...(authenticated.vehicleType ? { vehicleType: authenticated.vehicleType } : {}),
    })
    response.status(202).json({ data: result })
  } catch (error) {
    recordIngestionMetrics({
      accepted: 0,
      filtered: 0,
      rejected: Array.isArray(request.body?.points) ? request.body.points.length : 1,
      latencyMs: performance.now() - startedAt,
    })
    throw error
  }
}
