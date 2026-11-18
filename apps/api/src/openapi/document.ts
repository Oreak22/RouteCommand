import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import {
  actionTokenSchema,
  alertActionSchema,
  alertIdParamsSchema,
  assignVehicleSchema,
  changePasswordSchema,
  checkZonePointSchema,
  cancelShipmentSchema,
  createShipmentSchema,
  createManagedUserSchema,
  createVehicleSchema,
  createZoneSchema,
  driverIdParamsSchema,
  driverStatusUpdateSchema,
  emailActionSchema,
  listDriversQuerySchema,
  listAlertsQuerySchema,
  listManagedUsersQuerySchema,
  listVehiclesQuerySchema,
  listZonesQuerySchema,
  listShipmentsQuerySchema,
  updateNotificationPreferencesSchema,
  dispatchAssignSchema,
  dispatchBatchAssignSchema,
  dispatchSuggestionsQuerySchema,
  loginSchema,
  managedUserIdParamsSchema,
  nearbyDriversQuerySchema,
  registerSchema,
  resetPasswordSchema,
  shipmentIdParamsSchema,
  shipmentCustomerQuerySchema,
  updateManagedUserSchema,
  updateDriverSchema,
  updateVehicleSchema,
  updateZoneSchema,
  updateShipmentSchema,
  vehicleIdParamsSchema,
  zoneGeoJsonQuerySchema,
  zoneIdParamsSchema,
  zoneUpdateGuardSchema,
  transitionShipmentSchema,
  shipmentAcceptSchema,
  shipmentRejectSchema,
  telemetryBatchSchema,
  telemetryDriverIdParamsSchema,
  telemetryPointsQuerySchema,
  telemetryTrackQuerySchema,
  publicTrackingParamsSchema,
} from '@routecommand/shared'
import { z } from 'zod'

import { emailIdParamsSchema, suppressionParamsSchema } from '../modules/admin-email/schemas.js'
import {
  securityEventListSchema,
  securityEventParamsSchema,
  securityEventStatusSchema,
} from '../modules/security/admin-schemas.js'

extendZodWithOpenApi(z)
const registry = new OpenAPIRegistry()
const healthSchema = registry.register(
  'HealthResponse',
  z.object({ status: z.literal('ok') }).openapi('HealthResponse'),
)
const readySchema = registry.register(
  'ReadinessResponse',
  z
    .object({
      status: z.literal('ok'),
      dependencies: z.object({ postgres: z.literal('ok'), redis: z.literal('ok') }),
    })
    .openapi('ReadinessResponse'),
)
const errorSchema = registry.register(
  'ErrorResponse',
  z
    .object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().nullable(),
        requestId: z.string(),
      }),
    })
    .openapi('ErrorResponse'),
)
const publicTrackingSchema = registry.register(
  'PublicTrackingResponse',
  z
    .object({
      data: z.object({
        found: z.boolean(),
        trackingCode: z.string().nullable(),
        status: z.string(),
        events: z.array(z.object({ status: z.string(), occurredAt: z.string().datetime() })),
        eta: z.string().datetime().nullable(),
        dropoff: z
          .object({ lat: z.number(), lng: z.number(), address: z.string().nullable() })
          .nullable(),
        driver: z.object({ firstName: z.string(), vehicleType: z.string().nullable() }).nullable(),
        location: z
          .object({ lat: z.number(), lng: z.number(), recordedAt: z.string().datetime() })
          .nullable(),
        updatedAt: z.string().datetime().nullable(),
      }),
    })
    .openapi('PublicTrackingResponse'),
)
const authSessionSchema = registry.register(
  'AuthSession',
  z.object({
    data: z.object({
      user: z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        name: z.string(),
        role: z.enum(['ADMIN', 'DISPATCHER', 'DRIVER', 'CUSTOMER']),
        isActive: z.boolean(),
        emailVerifiedAt: z.string().datetime().nullable(),
      }),
      accessToken: z.string(),
    }),
  }),
)

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})

registry.registerPath({
  method: 'get',
  path: '/health/live',
  description: 'Confirms the API process is running.',
  responses: {
    200: {
      description: 'API process is healthy.',
      content: { 'application/json': { schema: healthSchema } },
    },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/tracking/{trackingCode}',
  summary: 'Get the privacy-filtered public shipment tracking view.',
  request: { params: publicTrackingParamsSchema },
  responses: {
    200: {
      description: 'Tracking data, or the same shaped response with found=false.',
      content: { 'application/json': { schema: publicTrackingSchema } },
    },
    429: { description: 'Public tracking rate limit exceeded.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/tracking/{trackingCode}/customer',
  summary: 'Get full precision delivery details for the owning customer.',
  security: [{ bearerAuth: [] }],
  request: { params: publicTrackingParamsSchema },
  responses: {
    200: {
      description: 'Customer-owned tracking data.',
      content: { 'application/json': { schema: publicTrackingSchema } },
    },
    401: { description: 'Authentication required.' },
    404: { description: 'Shipment was not found for this customer.' },
  },
})
for (const [method, path, summary, request] of [
  [
    'get',
    '/api/v1/shipments',
    'List shipments in the authenticated user scope.',
    { query: listShipmentsQuerySchema },
  ],
  [
    'get',
    '/api/v1/shipments/customers',
    'List minimal active-customer choices for dispatcher shipment entry.',
    { query: shipmentCustomerQuerySchema },
  ],
  [
    'post',
    '/api/v1/shipments',
    'Create a shipment or customer request.',
    { body: { content: { 'application/json': { schema: createShipmentSchema } } } },
  ],
  [
    'get',
    '/api/v1/shipments/{shipmentId}',
    'Get a role-scoped shipment.',
    { params: shipmentIdParamsSchema },
  ],
  [
    'patch',
    '/api/v1/shipments/{shipmentId}',
    'Update a shipment before pickup.',
    {
      params: shipmentIdParamsSchema,
      body: { content: { 'application/json': { schema: updateShipmentSchema } } },
    },
  ],
  [
    'post',
    '/api/v1/shipments/{shipmentId}/transition',
    'Apply a validated state-machine transition. Supports the optional Idempotency-Key header.',
    {
      params: shipmentIdParamsSchema,
      body: { content: { 'application/json': { schema: transitionShipmentSchema } } },
    },
  ],
  [
    'post',
    '/api/v1/shipments/{shipmentId}/cancel',
    'Cancel a shipment under the role and lifecycle cancellation rules.',
    {
      params: shipmentIdParamsSchema,
      body: { content: { 'application/json': { schema: cancelShipmentSchema } } },
    },
  ],
  [
    'get',
    '/api/v1/shipments/{shipmentId}/events',
    'Read the role-scoped shipment event timeline.',
    { params: shipmentIdParamsSchema },
  ],
] as const) {
  registry.registerPath({
    method,
    path,
    summary,
    security: [{ bearerAuth: [] }],
    request,
    responses: {
      200: { description: 'Shipment operation completed.' },
      201: { description: 'Shipment created.' },
      401: { description: 'Authentication required.' },
      403: { description: 'Role or ownership check denied the operation.' },
      404: { description: 'Shipment not found.' },
      409: { description: 'The requested transition conflicts with shipment state.' },
      422: { description: 'Input validation failed.' },
    },
  })
}

for (const [method, path, summary, request] of [
  [
    'get',
    '/api/v1/dispatch/suggestions',
    'Rank fresh, available drivers by distance, capacity, workload and zone match.',
    { query: dispatchSuggestionsQuerySchema },
  ],
  [
    'post',
    '/api/v1/dispatch/assign',
    'Assign a driver to an unassigned shipment in one transaction.',
    { body: { content: { 'application/json': { schema: dispatchAssignSchema } } } },
  ],
  [
    'post',
    '/api/v1/dispatch/assign-batch',
    'Assign several unassigned shipments to one capable driver in nearest-pickup order.',
    { body: { content: { 'application/json': { schema: dispatchBatchAssignSchema } } } },
  ],
  [
    'post',
    '/api/v1/shipments/{shipmentId}/accept',
    'Accept an assignment as its assigned driver.',
    {
      params: shipmentIdParamsSchema,
      body: { content: { 'application/json': { schema: shipmentAcceptSchema } } },
    },
  ],
  [
    'post',
    '/api/v1/shipments/{shipmentId}/reject',
    'Decline an assignment and return it to the unassigned dispatch queue.',
    {
      params: shipmentIdParamsSchema,
      body: { content: { 'application/json': { schema: shipmentRejectSchema } } },
    },
  ],
] as const) {
  registry.registerPath({
    method,
    path,
    summary,
    security: [{ bearerAuth: [] }],
    request,
    responses: {
      200: { description: 'Dispatch operation completed.' },
      401: { description: 'Authentication required.' },
      403: { description: 'Role or ownership check denied the operation.' },
      404: { description: 'Shipment or driver not found.' },
      409: { description: 'Shipment or driver state changed before the operation completed.' },
      422: { description: 'Input validation failed.' },
    },
  })
}

registry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  summary: 'List users. Administrator only.',
  security: [{ bearerAuth: [] }],
  request: { query: listManagedUsersQuerySchema },
  responses: {
    200: { description: 'Matching users.' },
    401: {
      description: 'Authentication is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
    403: {
      description: 'Administrator role is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/v1/users',
  summary: 'Create and invite a managed user. Administrator only.',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createManagedUserSchema } } } },
  responses: {
    201: { description: 'User and, for drivers, driver profile created.' },
    409: {
      description: 'Email or driver license already exists.',
      content: { 'application/json': { schema: errorSchema } },
    },
    422: {
      description: 'Input validation failed.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/{userId}',
  summary: 'Update a user role or account state. Administrator only.',
  security: [{ bearerAuth: [] }],
  request: {
    params: managedUserIdParamsSchema,
    body: { content: { 'application/json': { schema: updateManagedUserSchema } } },
  },
  responses: {
    200: { description: 'Updated user.' },
    403: {
      description: 'Administrator role or account rule denied the update.',
      content: { 'application/json': { schema: errorSchema } },
    },
    404: {
      description: 'User not found.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{userId}',
  summary: 'Get a user record. Administrator only.',
  security: [{ bearerAuth: [] }],
  request: { params: managedUserIdParamsSchema },
  responses: {
    200: { description: 'User record.' },
    401: {
      description: 'Authentication is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
    403: {
      description: 'Administrator role is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
    404: {
      description: 'User not found.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/v1/users/{userId}',
  summary: 'Deactivate a user and revoke sessions. Administrator only.',
  security: [{ bearerAuth: [] }],
  request: { params: managedUserIdParamsSchema },
  responses: {
    200: { description: 'Deactivated user.' },
    403: {
      description: 'Administrator role or account rule denied the operation.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/v1/users/{userId}/force-password-reset',
  summary: 'Email password reset instructions to a user. Administrator only.',
  security: [{ bearerAuth: [] }],
  request: { params: managedUserIdParamsSchema },
  responses: {
    202: { description: 'Reset instructions queued.' },
    403: {
      description: 'Administrator role is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
    404: {
      description: 'User not found.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

for (const [path, summary, schema] of [
  ['/api/v1/auth/verify-email', 'Verify an email address.', actionTokenSchema],
  [
    '/api/v1/auth/resend-verification',
    'Resend email verification instructions.',
    emailActionSchema,
  ],
  ['/api/v1/auth/forgot-password', 'Request password reset instructions.', emailActionSchema],
  ['/api/v1/auth/reset-password', 'Set a new password using a reset token.', resetPasswordSchema],
] as const) {
  registry.registerPath({
    method: 'post',
    path,
    summary,
    request: { body: { content: { 'application/json': { schema } } } },
    responses: {
      200: { description: 'Action completed.' },
      202: { description: 'If applicable, an email has been queued.' },
      204: { description: 'Action completed.' },
      400: {
        description: 'The action token is invalid or expired.',
        content: { 'application/json': { schema: errorSchema } },
      },
      422: {
        description: 'Input validation failed.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  })
}

for (const [path, summary, method] of [
  ['/api/v1/auth/logout', 'End the current session.', 'post'],
  ['/api/v1/auth/logout-all', 'End every session for the current user.', 'post'],
  ['/api/v1/auth/change-password', 'Change the current user password.', 'post'],
] as const) {
  registry.registerPath({
    method,
    path,
    summary,
    security: [{ bearerAuth: [] }],
    ...(path.endsWith('change-password')
      ? { request: { body: { content: { 'application/json': { schema: changePasswordSchema } } } } }
      : {}),
    responses: {
      204: { description: 'Action completed.' },
      401: {
        description: 'Authentication is required.',
        content: { 'application/json': { schema: errorSchema } },
      },
      403: {
        description: 'A same-site request header is required.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  })
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  summary: 'Rotate the refresh token from the scoped httpOnly cookie.',
  responses: {
    200: {
      description: 'Session refreshed.',
      content: { 'application/json': { schema: authSessionSchema } },
    },
    401: {
      description: 'Refresh session is invalid.',
      content: { 'application/json': { schema: errorSchema } },
    },
    403: {
      description: 'A same-site request header is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

for (const [path, summary, schema] of [
  ['/api/v1/auth/register', 'Register a customer account.', registerSchema],
  ['/api/v1/auth/login', 'Sign in and issue an access token.', loginSchema],
] as const) {
  registry.registerPath({
    method: 'post',
    path,
    summary,
    request: { body: { content: { 'application/json': { schema } } } },
    responses: {
      200: {
        description: 'Authentication succeeded.',
        content: { 'application/json': { schema: authSessionSchema } },
      },
      201: {
        description: 'Customer account created.',
        content: { 'application/json': { schema: authSessionSchema } },
      },
      401: {
        description: 'Credentials are invalid.',
        content: { 'application/json': { schema: errorSchema } },
      },
      422: {
        description: 'Input validation failed.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  })
}

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/me',
  summary: 'Return the authenticated account.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Current account.' },
    401: {
      description: 'Authentication is required.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})
registry.registerPath({
  method: 'get',
  path: '/health/ready',
  description: 'Confirms PostgreSQL and Redis are reachable.',
  responses: {
    200: {
      description: 'Dependencies are ready.',
      content: { 'application/json': { schema: readySchema } },
    },
    503: {
      description: 'A dependency is unavailable.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
})

const authenticated = [{ bearerAuth: [] }]
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/email-log',
  summary: 'List email delivery logs. Administrator only.',
  description: 'Filters by delivery status, template, and recipient; pagination is supported.',
  security: authenticated,
  responses: {
    200: { description: 'Email delivery log page.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Administrator role required.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/notifications/preferences',
  summary: 'Get notification email preferences for the authenticated user.',
  security: authenticated,
  responses: {
    200: { description: 'Role-specific email preferences and mandatory account/security notices.' },
    401: { description: 'Authentication required.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/security-events',
  summary: 'List security events. Administrator only.',
  security: authenticated,
  request: { query: securityEventListSchema },
  responses: {
    200: { description: 'Filtered security event list.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Administrator role required.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/security-events/{eventId}',
  summary: 'Get security event evidence. Administrator only.',
  security: authenticated,
  request: { params: securityEventParamsSchema },
  responses: {
    200: { description: 'Security event details.' },
    404: { description: 'Security event not found.' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/security-events/{eventId}',
  summary: 'Review or dismiss an open security event. Administrator only.',
  security: authenticated,
  request: {
    params: securityEventParamsSchema,
    body: { content: { 'application/json': { schema: securityEventStatusSchema } } },
  },
  responses: {
    200: { description: 'Security event updated.' },
    409: { description: 'Security event is no longer open.' },
  },
})
registry.registerPath({
  method: 'put',
  path: '/api/v1/notifications/preferences',
  summary: 'Update non-critical notification email preferences.',
  description: 'Account and security emails are mandatory and cannot be disabled.',
  security: authenticated,
  request: {
    body: { content: { 'application/json': { schema: updateNotificationPreferencesSchema } } },
  },
  responses: {
    200: { description: 'Updated role-specific email preferences.' },
    401: { description: 'Authentication required.' },
    422: { description: 'Preference values are invalid.' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/email-log/{emailId}/retry',
  summary: 'Retry a retained failed email job. Administrator only.',
  security: authenticated,
  request: { params: emailIdParamsSchema },
  responses: {
    202: { description: 'Retry queued.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Administrator role required.' },
    409: { description: 'Email is not eligible or its queue job is no longer retained.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/email-suppressions',
  summary: 'List suppressed email addresses. Administrator only.',
  security: authenticated,
  responses: {
    200: { description: 'Email suppression entries.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Administrator role required.' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/email-suppressions/{email}',
  summary: 'Clear an email address suppression. Administrator only.',
  security: authenticated,
  request: { params: suppressionParamsSchema },
  responses: {
    204: { description: 'Suppression cleared.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Administrator role required.' },
    404: { description: 'Suppression was not found.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/drivers',
  summary: 'List drivers with operational filters. Administrator or dispatcher.',
  security: authenticated,
  request: { query: listDriversQuerySchema },
  responses: {
    200: { description: 'Matching drivers.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Dispatcher role required.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/drivers/nearby',
  summary: 'Find available drivers within a radius, nearest first.',
  security: authenticated,
  request: { query: nearbyDriversQuerySchema },
  responses: {
    200: { description: 'Nearby drivers.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Dispatcher role required.' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/v1/telemetry/batch',
  summary: 'Queue an authenticated driver telemetry batch for validation and storage.',
  security: authenticated,
  request: {
    body: { content: { 'application/json': { schema: telemetryBatchSchema } } },
  },
  responses: {
    202: { description: 'Validated points queued for durable history storage.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Driver role and driver profile required.' },
    422: { description: 'Telemetry validation failed.' },
    429: { description: 'Telemetry rate limit exceeded.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/metrics',
  summary: 'Return protected Prometheus-format telemetry process metrics. Administrator only.',
  security: authenticated,
  responses: {
    200: { description: 'Prometheus text exposition.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Administrator role required.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/telemetry/drivers/{driverId}/track',
  summary: 'Return a driver telemetry track and distance/speed statistics.',
  security: authenticated,
  request: { params: telemetryDriverIdParamsSchema, query: telemetryTrackQuerySchema },
  responses: {
    200: { description: 'GeoJSON LineString track and summary properties.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Driver may only access their own track.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/telemetry/drivers/{driverId}/points',
  summary: 'Return a cursor-paginated page of raw telemetry fixes.',
  security: authenticated,
  request: { params: telemetryDriverIdParamsSchema, query: telemetryPointsQuerySchema },
  responses: {
    200: { description: 'Telemetry point page, with a next cursor when more points exist.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Driver may only access their own points.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/drivers/me',
  summary: 'Return the authenticated driver profile.',
  security: authenticated,
  responses: {
    200: { description: 'Driver profile.' },
    401: { description: 'Authentication required.' },
    403: { description: 'Driver role required.' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/v1/drivers/me/status',
  summary: 'Update the authenticated driver availability.',
  security: authenticated,
  request: { body: { content: { 'application/json': { schema: driverStatusUpdateSchema } } } },
  responses: {
    200: { description: 'Updated driver profile.' },
    409: { description: 'Active shipments require explicit confirmation before going offline.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/drivers/{driverId}',
  summary: 'Get a driver profile.',
  security: authenticated,
  request: { params: driverIdParamsSchema },
  responses: { 200: { description: 'Driver profile.' }, 404: { description: 'Driver not found.' } },
})
registry.registerPath({
  method: 'patch',
  path: '/api/v1/drivers/{driverId}',
  summary: 'Update driver license or availability.',
  security: authenticated,
  request: {
    params: driverIdParamsSchema,
    body: { content: { 'application/json': { schema: updateDriverSchema } } },
  },
  responses: {
    200: { description: 'Updated driver.' },
    409: { description: 'Active shipments require explicit confirmation before going offline.' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/v1/drivers/{driverId}/assign-vehicle',
  summary: 'Assign or unassign a vehicle.',
  security: authenticated,
  request: {
    params: driverIdParamsSchema,
    body: { content: { 'application/json': { schema: assignVehicleSchema } } },
  },
  responses: {
    200: { description: 'Updated driver assignment.' },
    409: { description: 'Vehicle is inactive or already assigned.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/vehicles',
  summary: 'List vehicles.',
  security: authenticated,
  request: { query: listVehiclesQuerySchema },
  responses: { 200: { description: 'Matching vehicles.' } },
})
registry.registerPath({
  method: 'post',
  path: '/api/v1/vehicles',
  summary: 'Register a vehicle.',
  security: authenticated,
  request: { body: { content: { 'application/json': { schema: createVehicleSchema } } } },
  responses: {
    201: { description: 'Created vehicle.' },
    409: { description: 'Plate already exists.' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/v1/vehicles/{vehicleId}',
  summary: 'Get a vehicle.',
  security: authenticated,
  request: { params: vehicleIdParamsSchema },
  responses: { 200: { description: 'Vehicle.' }, 404: { description: 'Vehicle not found.' } },
})
registry.registerPath({
  method: 'patch',
  path: '/api/v1/vehicles/{vehicleId}',
  summary: 'Update vehicle details or active state.',
  security: authenticated,
  request: {
    params: vehicleIdParamsSchema,
    body: { content: { 'application/json': { schema: updateVehicleSchema } } },
  },
  responses: {
    200: { description: 'Updated vehicle.' },
    409: { description: 'Plate exists or active driver is assigned.' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/v1/vehicles/{vehicleId}',
  summary: 'Soft-deactivate a vehicle.',
  security: authenticated,
  request: { params: vehicleIdParamsSchema },
  responses: {
    200: { description: 'Deactivated vehicle.' },
    409: { description: 'An active driver is assigned.' },
  },
})

for (const [method, path, summary, request] of [
  ['get', '/api/v1/alerts', 'List operational alerts.', { query: listAlertsQuerySchema }],
  ['get', '/api/v1/alerts/stats', 'Summarize alert counts by status and severity.', {}],
  [
    'post',
    '/api/v1/alerts/{alertId}/acknowledge',
    'Acknowledge an open operational alert.',
    {
      params: alertIdParamsSchema,
      body: { content: { 'application/json': { schema: alertActionSchema } } },
    },
  ],
  [
    'post',
    '/api/v1/alerts/{alertId}/resolve',
    'Resolve an operational alert.',
    {
      params: alertIdParamsSchema,
      body: { content: { 'application/json': { schema: alertActionSchema } } },
    },
  ],
  [
    'get',
    '/api/v1/zones',
    'List zones. Drivers can read active zones only.',
    { query: listZonesQuerySchema },
  ],
  [
    'post',
    '/api/v1/zones',
    'Create a spatial zone.',
    {
      body: { content: { 'application/json': { schema: createZoneSchema } } },
    },
  ],
  [
    'get',
    '/api/v1/zones/geojson',
    'Return active zones as a GeoJSON FeatureCollection. Drivers have read-only access.',
    {
      query: zoneGeoJsonQuerySchema,
    },
  ],
  [
    'post',
    '/api/v1/zones/check-point',
    'Find active zones covering a coordinate.',
    {
      body: { content: { 'application/json': { schema: checkZonePointSchema } } },
    },
  ],
  [
    'get',
    '/api/v1/zones/{zoneId}',
    'Get a spatial zone. Available to administrators and dispatchers.',
    { params: zoneIdParamsSchema },
  ],
  [
    'patch',
    '/api/v1/zones/{zoneId}',
    'Update a spatial zone using optimistic concurrency.',
    {
      params: zoneIdParamsSchema,
      body: { content: { 'application/json': { schema: updateZoneSchema } } },
    },
  ],
  [
    'delete',
    '/api/v1/zones/{zoneId}',
    'Soft-deactivate a spatial zone.',
    {
      params: zoneIdParamsSchema,
      body: { content: { 'application/json': { schema: zoneUpdateGuardSchema } } },
    },
  ],
] as const) {
  registry.registerPath({
    method,
    path,
    summary,
    security: authenticated,
    request,
    responses: {
      200: { description: 'Zone operation completed.' },
      201: { description: 'Zone created.' },
      400: { description: 'Zone geometry is invalid.' },
      401: { description: 'Authentication required.' },
      403: { description: 'Administrator or dispatcher role required.' },
      404: { description: 'Zone not found.' },
      409: { description: 'Zone was changed by another request.' },
      422: { description: 'Input validation failed.' },
    },
  })
}

const generator = new OpenApiGeneratorV31(registry.definitions)

export const openApiDocument = generator.generateDocument({
  openapi: '3.1.0',
  info: { title: 'RouteCommand API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
