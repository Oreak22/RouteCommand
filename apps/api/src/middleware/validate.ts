import type { RequestHandler } from 'express'
import { z } from 'zod'

import { ValidationError } from '../core/errors/app-error.js'

export type RequestPart = 'body' | 'params' | 'query'

export function validate<Schema extends z.ZodType>(
  part: RequestPart,
  schema: Schema,
): RequestHandler {
  return (request, _response, next) => {
    const parsed = schema.safeParse(request[part])

    if (!parsed.success) {
      next(
        new ValidationError({
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        }),
      )
      return
    }

    if (part === 'body') {
      request.body = parsed.data
    } else {
      Object.defineProperty(request, part, {
        configurable: true,
        enumerable: true,
        value: parsed.data,
      })
    }

    next()
  }
}
