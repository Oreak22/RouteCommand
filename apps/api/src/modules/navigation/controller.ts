import type { Request, Response } from 'express'

import {
  endNavigationSession,
  getActiveNavigationSession,
  getNavigationSession,
  listActiveNavigationSessions,
  previewRoute,
  rerouteNavigationSession,
  startNavigationSession,
  updateNavigationProgress,
} from './service.js'
import type { AuthenticatedRequest } from '../auth/types.js'

type AuthRequest = Request & AuthenticatedRequest

export async function preview(_request: AuthRequest, response: Response) {
  const input = _request.body as Parameters<typeof previewRoute>[0]
  response.status(200).json({ data: await previewRoute(input) })
}

export async function start(request: AuthRequest, response: Response) {
  const input = request.body as { shipmentId: string }
  response.status(201).json({
    data: await startNavigationSession(request.authUser!.id, request.driverId!, input.shipmentId),
  })
}

export async function active(request: AuthRequest, response: Response) {
  response.status(200).json({ data: await getActiveNavigationSession(request.driverId!) })
}

export async function activeAll(_request: AuthRequest, response: Response) {
  response.status(200).json({ data: await listActiveNavigationSessions() })
}

export async function detail(request: AuthRequest, response: Response) {
  const { sessionId } = request.params as { sessionId: string }
  response.status(200).json({
    data: await getNavigationSession(
      sessionId,
      request.authUser!.id,
      request.authUser!.role,
      request.driverId,
    ),
  })
}

export async function reroute(request: AuthRequest, response: Response) {
  const { sessionId } = request.params as { sessionId: string }
  const input = request.body as Parameters<typeof rerouteNavigationSession>[2]
  response
    .status(200)
    .json({ data: await rerouteNavigationSession(sessionId, request.driverId!, input) })
}

export async function progress(request: AuthRequest, response: Response) {
  const { sessionId } = request.params as { sessionId: string }
  const input = request.body as Parameters<typeof updateNavigationProgress>[2]
  response
    .status(202)
    .json({ data: await updateNavigationProgress(sessionId, request.driverId!, input) })
}

export async function end(request: AuthRequest, response: Response) {
  const { sessionId } = request.params as { sessionId: string }
  const input = request.body as { reason: 'ARRIVED' | 'CANCELLED' | 'MANUAL' }
  response
    .status(200)
    .json({ data: await endNavigationSession(sessionId, request.driverId!, input.reason) })
}
