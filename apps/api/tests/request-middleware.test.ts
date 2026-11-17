import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ErrorCode, ValidationError } from '../src/core/errors/app-error.js'
import { requestIdMiddleware } from '../src/middleware/request-id.js'
import { validate } from '../src/middleware/validate.js'

describe('requestIdMiddleware', () => {
  it('propagates a safe incoming request ID', () => {
    const request = { get: vi.fn().mockReturnValue('trace:routecommand-42') } as unknown as Request
    const response = { locals: {}, setHeader: vi.fn() } as unknown as Response
    const next = vi.fn()

    requestIdMiddleware(request, response, next)

    expect(response.locals.requestId).toBe('trace:routecommand-42')
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'trace:routecommand-42')
    expect(next).toHaveBeenCalledOnce()
  })

  it('replaces malformed request IDs with a UUID', () => {
    const request = { get: vi.fn().mockReturnValue('bad\r\nid') } as unknown as Request
    const response = { locals: {}, setHeader: vi.fn() } as unknown as Response

    requestIdMiddleware(request, response, vi.fn())

    expect(response.locals.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('validate', () => {
  it('stores parsed request data and strips unknown object keys', () => {
    const request = {
      body: { name: 'Amara', ignored: 'remove me' },
    } as unknown as Request
    const next = vi.fn()

    validate('body', z.object({ name: z.string() }))(request, {} as Response, next)

    expect(request.body).toEqual({ name: 'Amara' })
    expect(next).toHaveBeenCalledOnce()
  })

  it('forwards field-level validation details for invalid input', () => {
    const request = { body: { count: 'many' } } as unknown as Request
    const next = vi.fn()

    validate('body', z.object({ count: z.number().int() }))(request, {} as Response, next)

    const error = next.mock.calls[0]?.[0]
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED)
    expect(error.details.issues[0]).toMatchObject({ path: ['count'], code: 'invalid_type' })
  })

  it('replaces parsed query values rather than leaving Express query strings', () => {
    const request = { query: { limit: '25', ignored: 'remove me' } } as unknown as Request
    const next = vi.fn()

    validate('query', z.object({ limit: z.coerce.number().int().positive() }))(
      request,
      {} as Response,
      next,
    )

    expect(request.query).toEqual({ limit: 25 })
    expect(next).toHaveBeenCalledOnce()
  })
})
