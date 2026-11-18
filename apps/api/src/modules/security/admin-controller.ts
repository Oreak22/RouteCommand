import type { Request, RequestHandler } from 'express'

import {
  getSecurityEventRecord,
  listSecurityEventRecords,
  reviewSecurityEvent,
} from './admin-service.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

function eventId(request: Request): string {
  const id = request.params.eventId
  return Array.isArray(id) ? id[0]! : id!
}

export const listSecurityEvents: RequestHandler = async (request, response) => {
  const result = await listSecurityEventRecords(request.query as never)
  response.status(200).json({
    data: result.data,
    meta: { total: result.total, limit: request.query.limit, offset: request.query.offset },
  })
}

export const getSecurityEvent: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getSecurityEventRecord(eventId(request)) })
}

export const patchSecurityEvent: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await reviewSecurityEvent(
      eventId(request),
      request.body.status,
      actorId(request),
      context(request),
    ),
  })
}
