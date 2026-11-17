export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'The request is invalid.', details?: unknown) {
    super(ErrorCode.BAD_REQUEST, 400, message, details)
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(ErrorCode.VALIDATION_FAILED, 422, 'The request could not be validated.', details)
  }
}

export class PayloadTooLargeError extends AppError {
  constructor() {
    super(ErrorCode.PAYLOAD_TOO_LARGE, 413, 'The request payload is too large.')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super(ErrorCode.UNAUTHORIZED, 401, message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to perform this action.') {
    super(ErrorCode.FORBIDDEN, 403, message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(ErrorCode.NOT_FOUND, 404, message)
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'The request conflicts with the current resource state.',
    details?: unknown,
  ) {
    super(ErrorCode.CONFLICT, 409, message, details)
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(ErrorCode.RATE_LIMITED, 429, message)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A required service is temporarily unavailable.') {
    super(ErrorCode.SERVICE_UNAVAILABLE, 503, message)
  }
}
