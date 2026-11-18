import type { RequestHandler } from 'express'

import { getNotificationPreferences, updateNotificationPreferences } from './preferences.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function auth(request: Parameters<RequestHandler>[0]) {
  return (request as typeof request & AuthenticatedRequest).authUser!
}

function context(request: Parameters<RequestHandler>[0]): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

export const getPreferences: RequestHandler = async (request, response) => {
  const user = auth(request)
  response.status(200).json({ data: await getNotificationPreferences(user.id, user.role) })
}

export const putPreferences: RequestHandler = async (request, response) => {
  const user = auth(request)
  response.status(200).json({
    data: await updateNotificationPreferences(
      user.id,
      user.role,
      request.body.preferences,
      context(request),
    ),
  })
}
