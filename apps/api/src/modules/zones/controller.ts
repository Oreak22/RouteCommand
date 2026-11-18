import type { Request, RequestHandler } from 'express'

import {
  checkZonesAtPoint,
  createZoneRecord,
  deactivateZoneRecord,
  getActiveZonesGeoJson,
  getZoneRecord,
  listZoneRecords,
  updateZoneRecord,
} from './service.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function zoneId(request: Request): string {
  const id = request.params.zoneId
  return Array.isArray(id) ? id[0]! : id!
}

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

export const list: RequestHandler = async (request, response) => {
  const isDriver = (request as typeof request & AuthenticatedRequest).authUser?.role === 'DRIVER'
  const zones = await listZoneRecords({
    ...request.query,
    ...(isDriver ? { active: true } : {}),
  } as never)
  response
    .status(200)
    .json({ data: zones, meta: { limit: request.query.limit, offset: request.query.offset } })
}

export const detail: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getZoneRecord(zoneId(request)) })
}

export const create: RequestHandler = async (request, response) => {
  response
    .status(201)
    .json({ data: await createZoneRecord(request.body, actorId(request), context(request)) })
}

export const update: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await updateZoneRecord(zoneId(request), request.body, actorId(request), context(request)),
  })
}

export const deactivate: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await deactivateZoneRecord(
      zoneId(request),
      request.body.expectedUpdatedAt,
      actorId(request),
      context(request),
    ),
  })
}

export const geojson: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getActiveZonesGeoJson(Number(request.query.toleranceM)) })
}

export const checkPoint: RequestHandler = async (request, response) => {
  const { lng, lat } = request.body as { lng: number; lat: number }
  response.status(200).json({ data: await checkZonesAtPoint(lng, lat) })
}
