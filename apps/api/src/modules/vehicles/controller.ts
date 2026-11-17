import type { Request, RequestHandler } from 'express'

import {
  createVehicleRecord,
  deactivateVehicleRecord,
  getVehicleRecord,
  listVehicleRecords,
  updateVehicleRecord,
} from './service.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function vehicleId(request: Request): string {
  const id = request.params.vehicleId
  return Array.isArray(id) ? id[0]! : id!
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

export const list: RequestHandler = async (request, response) => {
  const result = await listVehicleRecords(request.query as never)
  response
    .status(200)
    .json({ data: result, meta: { limit: request.query.limit, offset: request.query.offset } })
}

export const detail: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getVehicleRecord(vehicleId(request)) })
}

export const create: RequestHandler = async (request, response) => {
  response
    .status(201)
    .json({ data: await createVehicleRecord(request.body, actorId(request), context(request)) })
}

export const update: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await updateVehicleRecord(
      vehicleId(request),
      request.body,
      actorId(request),
      context(request),
    ),
  })
}

export const deactivate: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await deactivateVehicleRecord(vehicleId(request), actorId(request), context(request)),
  })
}
