import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'

import {
  AppError,
  BadRequestError,
  ConflictError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '../src/core/errors/app-error.js'
import { errorHandler } from '../src/core/errors/error-handler.js'

const knownErrors: [string, AppError, number, ErrorCode][] = [
  ['bad request', new BadRequestError(), 400, ErrorCode.BAD_REQUEST],
  ['validation', new ValidationError({ issues: [] }), 422, ErrorCode.VALIDATION_FAILED],
  ['unauthorized', new UnauthorizedError(), 401, ErrorCode.UNAUTHORIZED],
  ['forbidden', new ForbiddenError(), 403, ErrorCode.FORBIDDEN],
  ['not found', new NotFoundError(), 404, ErrorCode.NOT_FOUND],
  ['conflict', new ConflictError(), 409, ErrorCode.CONFLICT],
  ['rate limited', new RateLimitedError(), 429, ErrorCode.RATE_LIMITED],
  ['dependency unavailable', new ServiceUnavailableError(), 503, ErrorCode.SERVICE_UNAVAILABLE],
]

describe('errorHandler', () => {
  it.each(knownErrors)(
    'serializes %s using the API error envelope',
    (_name, error, status, code) => {
      const response = {
        locals: { requestId: 'req-phase3-1' },
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response

      errorHandler(error, {} as Request, response, vi.fn())

      expect(response.status).toHaveBeenCalledWith(status)
      expect(response.json).toHaveBeenCalledWith({
        error: {
          code,
          message: error.message,
          details: error.details ?? null,
          requestId: 'req-phase3-1',
        },
      })
    },
  )

  it('hides internal error details from the response', () => {
    const response = {
      locals: { requestId: 'req-phase3-2' },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response

    errorHandler(
      new Error('database password must never appear in an API response'),
      {} as Request,
      response,
      vi.fn(),
    )

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred.',
        details: null,
        requestId: 'req-phase3-2',
      },
    })
  })

  it.each([
    ['entity.parse.failed', 400, ErrorCode.BAD_REQUEST, 'Malformed JSON request body.'],
    ['entity.too.large', 413, ErrorCode.PAYLOAD_TOO_LARGE, 'The request payload is too large.'],
  ])('maps body parser error %s to the right HTTP response', (type, status, code, message) => {
    const response = {
      locals: { requestId: 'req-body-error' },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response
    const parserError = Object.assign(new Error('body parser internals'), { type })

    errorHandler(parserError, {} as Request, response, vi.fn())

    expect(response.status).toHaveBeenCalledWith(status)
    expect(response.json).toHaveBeenCalledWith({
      error: { code, message, details: null, requestId: 'req-body-error' },
    })
  })
})
