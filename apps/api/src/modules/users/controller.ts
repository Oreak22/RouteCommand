import type { Request, RequestHandler } from 'express'

import { createUser, forcePasswordReset, getUser, listUsers, updateUser } from './service.js'
import { ForbiddenError } from '../../core/errors/app-error.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

function paramUserId(request: Request): string {
  const id = request.params.userId
  return Array.isArray(id) ? id[0]! : id!
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

function actorId(request: Request): string {
  return (request as typeof request & AuthenticatedRequest).authUser!.id
}

export const list: RequestHandler = async (request, response) => {
  const result = await listUsers(request.query as never)
  response
    .status(200)
    .json({ data: result, meta: { limit: request.query.limit, offset: request.query.offset } })
}

export const detail: RequestHandler = async (request, response) => {
  const user = await getUser(paramUserId(request))
  response.status(200).json({ data: user })
}

export const create: RequestHandler = async (request, response) => {
  const user = await createUser(request.body, actorId(request), context(request))
  response.status(201).json({ data: user })
}

export const update: RequestHandler = async (request, response) => {
  const user = await updateUser(
    paramUserId(request),
    request.body,
    actorId(request),
    context(request),
  )
  response.status(200).json({ data: user })
}

export const deactivate: RequestHandler = async (request, response) => {
  if (paramUserId(request) === actorId(request)) {
    throw new ForbiddenError('You cannot deactivate your own administrator account.')
  }
  const user = await updateUser(
    paramUserId(request),
    { isActive: false },
    actorId(request),
    context(request),
  )
  response.status(200).json({ data: user })
}

export const resetPassword: RequestHandler = async (request, response) => {
  await forcePasswordReset(paramUserId(request), actorId(request), context(request))
  response
    .status(202)
    .json({ data: { message: 'If the account exists, reset instructions will be sent.' } })
}
