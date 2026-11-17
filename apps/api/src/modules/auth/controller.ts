import type { Request, RequestHandler } from 'express'

import {
  changePassword,
  getCurrentUser,
  login,
  logout,
  logoutAll,
  registerCustomer,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  rotateSession,
  verifyEmail,
} from './service.js'
import type { AuthenticatedRequest, AuthRequestContext } from './types.js'
import { ForbiddenError, UnauthorizedError } from '../../core/errors/app-error.js'

const refreshCookieName = 'routecommand_refresh'
const refreshCookiePath = '/api/v1/auth'

function requestContext(request: Request): AuthRequestContext {
  return {
    ip: request.ip,
    userAgent: request.get('user-agent')?.slice(0, 500),
  }
}

function setRefreshCookie(
  response: Parameters<RequestHandler>[1],
  token: string,
  expiresAt: Date,
): void {
  response.cookie(refreshCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: refreshCookiePath,
    expires: expiresAt,
  })
}

function clearRefreshCookie(response: Parameters<RequestHandler>[1]): void {
  response.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: refreshCookiePath,
  })
}

function sessionData(session: Awaited<ReturnType<typeof login>>) {
  return { user: session.user, accessToken: session.accessToken }
}

export const register: RequestHandler = async (request, response) => {
  const session = await registerCustomer(request.body, requestContext(request))
  setRefreshCookie(response, session.refreshToken, session.refreshExpiresAt)
  response.status(201).json({ data: sessionData(session) })
}

export const signIn: RequestHandler = async (request, response) => {
  const session = await login(request.body, requestContext(request))
  setRefreshCookie(response, session.refreshToken, session.refreshExpiresAt)
  response.status(200).json({ data: sessionData(session) })
}

export const refresh: RequestHandler = async (request, response) => {
  if (request.get('x-requested-with') !== 'RouteCommand') {
    throw new ForbiddenError('A same-site request header is required.')
  }
  const token = request.cookies?.[refreshCookieName]
  if (typeof token !== 'string') throw new UnauthorizedError()
  const session = await rotateSession(token, requestContext(request))
  setRefreshCookie(response, session.refreshToken, session.refreshExpiresAt)
  response.status(200).json({ data: sessionData(session) })
}

export const signOut: RequestHandler = async (request, response) => {
  const authRequest = request as typeof request & AuthenticatedRequest
  if (request.get('x-requested-with') !== 'RouteCommand') {
    throw new ForbiddenError('A same-site request header is required.')
  }
  if (authRequest.authUser && authRequest.sessionId) {
    await logout(authRequest.sessionId, authRequest.authUser.id, requestContext(request))
  }
  clearRefreshCookie(response)
  response.status(204).end()
}

export const signOutAll: RequestHandler = async (request, response) => {
  const authRequest = request as typeof request & AuthenticatedRequest
  if (request.get('x-requested-with') !== 'RouteCommand') {
    throw new ForbiddenError('A same-site request header is required.')
  }
  await logoutAll(authRequest.authUser!.id, requestContext(request))
  clearRefreshCookie(response)
  response.status(204).end()
}

export const me: RequestHandler = async (request, response) => {
  const authRequest = request as typeof request & AuthenticatedRequest
  response.status(200).json({ data: await getCurrentUser(authRequest.authUser!.id) })
}

export const updatePassword: RequestHandler = async (request, response) => {
  const authRequest = request as typeof request & AuthenticatedRequest
  await changePassword(authRequest.authUser!.id, request.body, requestContext(request))
  clearRefreshCookie(response)
  response.status(204).end()
}

export const resendEmailVerification: RequestHandler = async (request, response) => {
  await resendVerification(request.body.email, requestContext(request))
  response.status(202).json({
    data: { message: 'If the account needs verification, an email will be sent.' },
  })
}

export const confirmEmail: RequestHandler = async (request, response) => {
  await verifyEmail(request.body.token, requestContext(request))
  response.status(200).json({ data: { message: 'Email address verified.' } })
}

export const forgotPassword: RequestHandler = async (request, response) => {
  await requestPasswordReset(request.body.email, requestContext(request))
  response.status(202).json({
    data: { message: 'If the account exists, password reset instructions will be sent.' },
  })
}

export const confirmPasswordReset: RequestHandler = async (request, response) => {
  await resetPassword(request.body.token, request.body.password, requestContext(request))
  response.status(204).end()
}
