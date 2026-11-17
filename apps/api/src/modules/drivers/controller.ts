import type { Request, RequestHandler } from 'express'

import {
  assignDriverVehicle,
  getCurrentDriverRecord,
  getDriverRecord,
  listDriverRecords,
  listNearbyDriverRecords,
  updateCurrentDriverStatus,
  updateDriverRecord,
} from './service.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function driverId(request: Request): string {
  const id = request.params.driverId
  return Array.isArray(id) ? id[0]! : id!
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

export const list: RequestHandler = async (request, response) => {
  const result = await listDriverRecords(request.query as never)
  response
    .status(200)
    .json({ data: result, meta: { limit: request.query.limit, offset: request.query.offset } })
}

export const nearby: RequestHandler = async (request, response) => {
  const result = await listNearbyDriverRecords(request.query as never)
  response.status(200).json({ data: result })
}

export const detail: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getDriverRecord(driverId(request)) })
}

export const me: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getCurrentDriverRecord(actorId(request)) })
}

export const update: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await updateDriverRecord(
      driverId(request),
      request.body,
      actorId(request),
      context(request),
    ),
  })
}

export const updateMeStatus: RequestHandler = async (request, response) => {
  const { status, force } = request.body as {
    status: 'OFFLINE' | 'AVAILABLE' | 'ON_BREAK'
    force?: boolean
  }
  response.status(200).json({
    data: await updateCurrentDriverStatus(
      actorId(request),
      status,
      force ?? false,
      context(request),
    ),
  })
}

export const assignVehicle: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await assignDriverVehicle(
      driverId(request),
      request.body.vehicleId,
      actorId(request),
      context(request),
    ),
  })
}
