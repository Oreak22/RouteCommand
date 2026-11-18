import type { Request, RequestHandler } from 'express'

import { getAlertStats, listAlertRecords, updateAlertRecord } from './service.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function alertId(request: Request): string {
  const id = request.params.alertId
  return Array.isArray(id) ? id[0]! : id!
}

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

export const list: RequestHandler = async (request, response) => {
  const result = await listAlertRecords(request.query as never)
  response.status(200).json({
    data: result.data,
    meta: { total: result.total, limit: request.query.limit, offset: request.query.offset },
  })
}

export const stats: RequestHandler = async (_request, response) => {
  response.status(200).json({ data: await getAlertStats() })
}

export const acknowledge: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await updateAlertRecord(
      alertId(request),
      'ACKNOWLEDGED',
      actorId(request),
      request.body.note,
      context(request),
    ),
  })
}

export const resolve: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await updateAlertRecord(
      alertId(request),
      'RESOLVED',
      actorId(request),
      request.body.note,
      context(request),
    ),
  })
}
