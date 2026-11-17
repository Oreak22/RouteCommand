import type { ErrorRequestHandler } from 'express'

import { AppError, BadRequestError, ErrorCode, PayloadTooLargeError } from './app-error.js'
import { logger } from '../logger.js'

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof Error && 'type' in error) {
    if (error.type === 'entity.parse.failed')
      return new BadRequestError('Malformed JSON request body.')
    if (error.type === 'entity.too.large') return new PayloadTooLargeError()
  }

  return new AppError(ErrorCode.INTERNAL_ERROR, 500, 'An unexpected error occurred.', undefined, {
    cause: error,
  })
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next
  const requestId = String(response.locals.requestId ?? 'unknown')
  const appError = normalizeError(error)

  if (appError.statusCode >= 500) {
    logger.error({ err: appError, requestId, code: appError.code }, 'Request failed')
  }

  response.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? null,
      requestId,
    },
  })
}
