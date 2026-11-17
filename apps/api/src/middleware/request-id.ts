import { randomUUID } from 'node:crypto'

import type { RequestHandler } from 'express'

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const incomingId = request.get('x-request-id')
  const requestId = incomingId && requestIdPattern.test(incomingId) ? incomingId : randomUUID()

  response.locals.requestId = requestId
  response.setHeader('x-request-id', requestId)
  next()
}
