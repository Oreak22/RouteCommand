import type { AuthUser } from '@routecommand/shared'
import type { VehicleType } from '@routecommand/shared'

export type { AuthUser } from '@routecommand/shared'

export interface AuthRequestContext {
  ip: string | undefined
  userAgent: string | undefined
}

export interface AuthenticatedRequest {
  authUser?: AuthUser
  sessionId?: string
  driverId?: string
  vehicleType?: VehicleType
}
