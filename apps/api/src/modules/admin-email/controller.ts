import type { Request, RequestHandler } from 'express'

import {
  clearEmailSuppression,
  getEmailLogPage,
  getEmailSuppressions,
  retryEmailLog,
} from './service.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

function param(request: Request, name: string): string {
  const value = request.params[name]
  return Array.isArray(value) ? value[0]! : value!
}

export const listEmailLog: RequestHandler = async (request, response) => {
  const result = await getEmailLogPage(request.query as never)
  response.status(200).json({
    ...result,
    meta: { limit: request.query.limit, offset: request.query.offset },
  })
}

export const listEmailSuppressions: RequestHandler = async (_request, response) => {
  response.status(200).json({ data: await getEmailSuppressions() })
}

export const deleteEmailSuppression: RequestHandler = async (request, response) => {
  await clearEmailSuppression(param(request, 'email'), actorId(request), context(request))
  response.status(204).end()
}

export const retryEmail: RequestHandler = async (request, response) => {
  await retryEmailLog(param(request, 'emailId'), actorId(request), context(request))
  response.status(202).json({ data: { message: 'Email retry queued.' } })
}
