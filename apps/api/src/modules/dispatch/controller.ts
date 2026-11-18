import type { RequestHandler } from 'express'

import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'
import {
  assignShipmentBatchToDriverRecord,
  assignShipmentToDriverRecord,
  getDispatchSuggestions,
} from '../shipments/index.js'

function actor(request: Parameters<RequestHandler>[0]) {
  const authUser = (request as typeof request & AuthenticatedRequest).authUser!
  return { id: authUser.id, role: authUser.role }
}

function context(request: Parameters<RequestHandler>[0]): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

export const suggestions: RequestHandler = async (request, response) => {
  const { shipmentId } = request.query as { shipmentId: string }
  response.status(200).json({ data: await getDispatchSuggestions(shipmentId, actor(request)) })
}

export const assign: RequestHandler = async (request, response) => {
  const body = request.body as { shipmentId: string; driverId: string }
  response.status(200).json({
    data: await assignShipmentToDriverRecord(
      body.shipmentId,
      body.driverId,
      actor(request),
      context(request),
    ),
  })
}

export const assignBatch: RequestHandler = async (request, response) => {
  const body = request.body as { shipmentIds: string[]; driverId: string }
  response.status(200).json({
    data: await assignShipmentBatchToDriverRecord(
      body.shipmentIds,
      body.driverId,
      actor(request),
      context(request),
    ),
  })
}
