import type { Request, RequestHandler } from 'express'
import { z } from 'zod'

import {
  cancelShipmentRecord,
  createShipmentRecord,
  getShipmentEvents,
  getShipmentRecord,
  listShipmentCustomerOptions,
  listShipmentRecords,
  transitionShipmentRecord,
  updateShipmentRecord,
} from './service.js'
import { ValidationError } from '../../core/errors/app-error.js'
import type { AuthenticatedRequest, AuthRequestContext } from '../auth/types.js'

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/)

function actor(request: Request) {
  const authUser = (request as typeof request & AuthenticatedRequest).authUser!
  return { id: authUser.id, role: authUser.role }
}

function shipmentId(request: Request): string {
  const id = request.params.shipmentId
  return Array.isArray(id) ? id[0]! : id!
}

function context(request: Request): AuthRequestContext {
  return { ip: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) }
}

function idempotencyKey(request: Request): string | undefined {
  const value = request.get('idempotency-key')
  if (value === undefined) return undefined
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new ValidationError({
      issues: parsed.error.issues.map((issue) => ({
        path: ['Idempotency-Key'],
        message: issue.message,
      })),
    })
  }
  return parsed.data
}

export const list: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await listShipmentRecords(request.query as never, actor(request)),
    meta: { limit: request.query.limit, offset: request.query.offset },
  })
}

export const detail: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getShipmentRecord(shipmentId(request), actor(request)) })
}

export const customers: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await listShipmentCustomerOptions(request.query as never) })
}

export const events: RequestHandler = async (request, response) => {
  response.status(200).json({ data: await getShipmentEvents(shipmentId(request), actor(request)) })
}

export const create: RequestHandler = async (request, response) => {
  response.status(201).json({
    data: await createShipmentRecord(request.body, actor(request), context(request)),
  })
}

export const update: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await updateShipmentRecord(
      shipmentId(request),
      request.body,
      actor(request),
      context(request),
    ),
  })
}

export const transition: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await transitionShipmentRecord(
      shipmentId(request),
      request.body,
      actor(request),
      context(request),
      idempotencyKey(request),
    ),
  })
}

export const cancel: RequestHandler = async (request, response) => {
  response.status(200).json({
    data: await cancelShipmentRecord(
      shipmentId(request),
      request.body,
      actor(request),
      context(request),
    ),
  })
}
