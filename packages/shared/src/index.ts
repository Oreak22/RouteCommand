import { z } from 'zod'

// PostgreSQL's uuid type accepts any canonical 128-bit UUID string. Some
// deterministic seed IDs are UUID-shaped but do not set RFC version/variant
// bits, so z.string().uuid() rejects IDs that PostgreSQL stores and returns.
export const databaseUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, 'Expected a canonical UUID')

export type HealthResponse = {
  status: 'ok'
}

export const userRoles = ['ADMIN', 'DISPATCHER', 'DRIVER', 'CUSTOMER'] as const
export const userRoleSchema = z.enum(userRoles)
export type UserRole = z.infer<typeof userRoleSchema>
export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
  isActive: boolean
  emailVerifiedAt: string | null
}

export const driverStatuses = ['OFFLINE', 'AVAILABLE', 'BUSY', 'ON_BREAK'] as const
export const driverStatusSchema = z.enum(driverStatuses)
export type DriverStatus = z.infer<typeof driverStatusSchema>

export const vehicleTypes = ['BIKE', 'CAR', 'VAN', 'TRUCK'] as const
export const vehicleTypeSchema = z.enum(vehicleTypes)
export type VehicleType = z.infer<typeof vehicleTypeSchema>

export const updateDriverSchema = z
  .object({
    licenseNo: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['OFFLINE', 'AVAILABLE', 'ON_BREAK']).optional(),
    force: z.boolean().optional(),
  })
  .refine((input) => input.licenseNo !== undefined || input.status !== undefined, {
    message: 'At least one driver field must be provided.',
  })

export const driverStatusUpdateSchema = z.object({
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ON_BREAK']),
  force: z.boolean().optional(),
})

export const assignVehicleSchema = z.object({ vehicleId: databaseUuidSchema.nullable() })
export const driverIdParamsSchema = z.object({ driverId: databaseUuidSchema })

export const listDriversQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: driverStatusSchema.optional(),
  zoneId: databaseUuidSchema.optional(),
  vehicleType: vehicleTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})

export const nearbyDriversQuerySchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  radiusM: z.coerce.number().positive().max(100_000).default(2_500),
  status: driverStatusSchema.default('AVAILABLE'),
  limit: z.coerce.number().int().min(1).max(50).default(50),
})

export const createVehicleSchema = z.object({
  plate: z.string().trim().min(1).max(32),
  type: vehicleTypeSchema,
  capacityKg: z.number().positive().max(100_000),
})

export const updateVehicleSchema = z
  .object({
    plate: z.string().trim().min(1).max(32).optional(),
    type: vehicleTypeSchema.optional(),
    capacityKg: z.number().positive().max(100_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one vehicle field must be provided.',
  })

export const listVehiclesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: vehicleTypeSchema.optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})

export const vehicleIdParamsSchema = z.object({ vehicleId: databaseUuidSchema })

export type UpdateDriverInput = z.infer<typeof updateDriverSchema>
export type DriverStatusUpdateInput = z.infer<typeof driverStatusUpdateSchema>
export type AssignVehicleInput = z.infer<typeof assignVehicleSchema>
export type ListDriversQuery = z.infer<typeof listDriversQuerySchema>
export type NearbyDriversQuery = z.infer<typeof nearbyDriversQuerySchema>
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>

export const zoneTypes = ['DELIVERY', 'RESTRICTED', 'DEPOT', 'CUSTOM'] as const
export const zoneTypeSchema = z.enum(zoneTypes)
export type ZoneType = z.infer<typeof zoneTypeSchema>

export const maxZoneVertices = 5_000
export const maxZoneAreaM2 = 50_000_000_000

const zonePositionSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
])

const zoneRingSchema = z
  .array(zonePositionSchema)
  .min(4)
  .max(maxZoneVertices)
  .superRefine((positions, context) => {
    const first = positions[0]
    const last = positions.at(-1)
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      context.addIssue({ code: 'custom', message: 'Polygon rings must be closed.' })
    }
  })

export const zoneGeometrySchema = z
  .union([
    z.object({ type: z.literal('Polygon'), coordinates: z.array(zoneRingSchema).min(1) }),
    z.object({
      type: z.literal('MultiPolygon'),
      coordinates: z.array(z.array(zoneRingSchema).min(1)).min(1),
    }),
  ])
  .superRefine((geometry, context) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    const vertexCount = polygons.reduce(
      (total, rings) => total + rings.reduce((ringTotal, ring) => ringTotal + ring.length, 0),
      0,
    )
    if (vertexCount > maxZoneVertices) {
      context.addIssue({
        code: 'custom',
        message: `Zone geometry cannot exceed ${maxZoneVertices} vertices.`,
      })
    }
  })

export type ZoneGeometry = z.infer<typeof zoneGeometrySchema>

export const createZoneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: zoneTypeSchema,
  geometry: zoneGeometrySchema,
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#168B91'),
  isActive: z.boolean().default(true),
})

export const updateZoneSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1).max(120).optional(),
    type: zoneTypeSchema.optional(),
    geometry: zoneGeometrySchema.optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.type !== undefined ||
      input.geometry !== undefined ||
      input.color !== undefined ||
      input.isActive !== undefined,
    { message: 'At least one zone field must be provided.' },
  )

export const zoneUpdateGuardSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
})

export const zoneIdParamsSchema = z.object({ zoneId: databaseUuidSchema })

export const listZonesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: zoneTypeSchema.optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export const zoneGeoJsonQuerySchema = z.object({
  toleranceM: z.coerce.number().min(0).max(10_000).default(0),
})

export const checkZonePointSchema = z.object({
  lng: z.coerce.number().finite().min(-180).max(180),
  lat: z.coerce.number().finite().min(-90).max(90),
})

export type CreateZoneInput = z.infer<typeof createZoneSchema>
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>
export type ListZonesQuery = z.infer<typeof listZonesQuerySchema>
export type ZoneGeoJsonQuery = z.infer<typeof zoneGeoJsonQuerySchema>
export type CheckZonePointInput = z.infer<typeof checkZonePointSchema>

export const shipmentStatuses = [
  'CREATED',
  'ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED',
  'DELIVERED',
  'CANCELLED',
  'FAILED_DELIVERY',
  'RETURNED',
] as const
export const shipmentStatusSchema = z.enum(shipmentStatuses)
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>

export const shipmentPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export const shipmentPrioritySchema = z.enum(shipmentPriorities)
export type ShipmentPriority = z.infer<typeof shipmentPrioritySchema>

export const shipmentLocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
})

export const createShipmentSchema = z.object({
  customerId: databaseUuidSchema.optional(),
  pickupAddress: z.string().trim().min(1).max(500),
  pickup: shipmentLocationSchema,
  dropoffAddress: z.string().trim().min(1).max(500),
  dropoff: shipmentLocationSchema,
  weightKg: z.number().finite().min(0).max(100_000),
  priority: shipmentPrioritySchema.default('NORMAL'),
  notes: z.string().trim().max(2_000).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
})

export const updateShipmentSchema = z
  .object({
    customerId: databaseUuidSchema.optional(),
    driverId: databaseUuidSchema.nullable().optional(),
    pickupAddress: z.string().trim().min(1).max(500).optional(),
    pickup: shipmentLocationSchema.optional(),
    dropoffAddress: z.string().trim().min(1).max(500).optional(),
    dropoff: shipmentLocationSchema.optional(),
    weightKg: z.number().finite().min(0).max(100_000).optional(),
    priority: shipmentPrioritySchema.optional(),
    notes: z.string().trim().max(2_000).nullable().optional(),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one shipment field must be provided.',
  })

export const listShipmentsQuerySchema = z
  .object({
    status: shipmentStatusSchema.optional(),
    driverId: databaseUuidSchema.optional(),
    customerId: databaseUuidSchema.optional(),
    priority: shipmentPrioritySchema.optional(),
    zoneId: databaseUuidSchema.optional(),
    search: z.string().trim().max(120).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date.',
  })

export const shipmentIdParamsSchema = z.object({ shipmentId: databaseUuidSchema })
export const shipmentCustomerQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const dispatchSuggestionsQuerySchema = z.object({
  shipmentId: databaseUuidSchema,
})
export const dispatchAssignSchema = z.object({
  shipmentId: databaseUuidSchema,
  driverId: databaseUuidSchema,
})
export const dispatchBatchAssignSchema = z
  .object({
    shipmentIds: z.array(databaseUuidSchema).min(2).max(10),
    driverId: databaseUuidSchema,
  })
  .refine((input) => new Set(input.shipmentIds).size === input.shipmentIds.length, {
    path: ['shipmentIds'],
    message: 'Choose each shipment only once.',
  })
export const shipmentAcceptSchema = z.object({}).default({})
export const shipmentRejectSchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
})

export const telemetryPointSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracyM: z.number().finite().min(0).max(100_000),
    altitudeM: z.number().finite().min(-1_000).max(100_000).nullable().optional(),
    speedMps: z.number().finite().min(0).max(1_000).nullable().optional(),
    headingDeg: z.number().finite().min(0).max(359.999).nullable().optional(),
    recordedAt: z.string().datetime({ offset: true }),
    batteryPct: z.number().int().min(0).max(100).nullable().optional(),
  })
  .refine((point) => point.lat !== 0 || point.lng !== 0, {
    path: ['lat'],
    message: 'The (0, 0) Null Island coordinate is not a valid driver fix.',
  })

export const telemetryBatchSchema = z.object({
  points: z.array(telemetryPointSchema).min(1).max(500),
})

export const telemetryDriverIdParamsSchema = z.object({ driverId: databaseUuidSchema })

export const telemetryTrackQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    simplifyM: z.coerce.number().min(0).max(10_000).default(0),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end time must be on or after the start time.',
  })

export const telemetryPointsQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export type TelemetryPointInput = z.infer<typeof telemetryPointSchema>
export type TelemetryBatchInput = z.infer<typeof telemetryBatchSchema>
export type TelemetryTrackQuery = z.infer<typeof telemetryTrackQuerySchema>
export type TelemetryPointsQuery = z.infer<typeof telemetryPointsQuerySchema>

export const alertTypes = [
  'ZONE_ENTER',
  'ZONE_EXIT',
  'RESTRICTED_ZONE_BREACH',
  'SIGNAL_LOST',
  'IDLE_TOO_LONG',
  'SPEEDING',
  'LOW_ACCURACY',
  'SHIPMENT_DELAYED',
  'OFF_ROUTE',
] as const
export const alertTypeSchema = z.enum(alertTypes)
export const alertSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export const alertSeveritySchema = z.enum(alertSeverities)
export const alertStatuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
export const alertStatusSchema = z.enum(alertStatuses)

export const listAlertsQuerySchema = z.object({
  status: alertStatusSchema.optional(),
  severity: alertSeveritySchema.optional(),
  type: alertTypeSchema.optional(),
  driverId: databaseUuidSchema.optional(),
  zoneId: databaseUuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})
export const alertIdParamsSchema = z.object({ alertId: databaseUuidSchema })
export const alertActionSchema = z
  .object({ note: z.string().trim().max(500).optional() })
  .default({})
export type AlertType = z.infer<typeof alertTypeSchema>
export type AlertSeverity = z.infer<typeof alertSeveritySchema>
export type AlertStatus = z.infer<typeof alertStatusSchema>
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>

export const transitionShipmentSchema = z.object({
  toStatus: shipmentStatusSchema,
  note: z.string().trim().max(2_000).optional(),
  location: shipmentLocationSchema.optional(),
})

export const cancelShipmentSchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
  location: shipmentLocationSchema.optional(),
})

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>
export type ListShipmentsQuery = z.infer<typeof listShipmentsQuerySchema>
export type DispatchSuggestionsQuery = z.infer<typeof dispatchSuggestionsQuerySchema>
export type DispatchAssignInput = z.infer<typeof dispatchAssignSchema>
export type DispatchBatchAssignInput = z.infer<typeof dispatchBatchAssignSchema>
export type TransitionShipmentInput = z.infer<typeof transitionShipmentSchema>
export type CancelShipmentInput = z.infer<typeof cancelShipmentSchema>

export type {
  ClientToServerEvents,
  DriverPositionEvent,
  DriverStatusEvent,
  OpsSnapshotEvent,
  RoomAck,
  ServerToClientEvents,
  ShipmentUpdatedEvent,
  SocketIdentity,
  SystemNoticeEvent,
  TelemetryAck,
  ZoneUpdatedEvent,
} from './socketEvents.js'

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
})
export const emailActionSchema = z.object({ email: z.string().trim().email().max(254) })
export const actionTokenSchema = z.object({ token: z.string().min(32).max(256) })
export const resetPasswordSchema = actionTokenSchema.extend({
  password: z.string().min(10).max(128),
})
export const createManagedUserSchema = z
  .object({
    email: z.string().trim().email().max(254),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).optional(),
    password: z.string().min(10).max(128),
    role: userRoleSchema,
    licenseNo: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((input, context) => {
    if (input.role === 'DRIVER' && !input.licenseNo) {
      context.addIssue({
        code: 'custom',
        path: ['licenseNo'],
        message: 'A license number is required for a driver.',
      })
    }
  })

export const updateManagedUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
    licenseNo: z.string().trim().min(1).max(80).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.phone !== undefined ||
      input.role !== undefined ||
      input.isActive !== undefined,
    { message: 'At least one user field must be provided.' },
  )
  .superRefine((input, context) => {
    if (input.licenseNo !== undefined && input.role !== 'DRIVER') {
      context.addIssue({
        code: 'custom',
        path: ['licenseNo'],
        message: 'License details can only be updated with the driver role.',
      })
    }
  })

export type CreateManagedUserInput = z.infer<typeof createManagedUserSchema>
export type UpdateManagedUserInput = z.infer<typeof updateManagedUserSchema>

export const notificationEmailPreferenceTypes = [
  'CUSTOMER_SHIPMENT_UPDATES',
  'DRIVER_REQUEST_INVITATIONS',
  'DISPATCHER_NEW_REQUESTS',
] as const
export const notificationEmailPreferenceTypeSchema = z.enum(notificationEmailPreferenceTypes)
export const notificationEmailPreferenceSchema = z.object({
  type: notificationEmailPreferenceTypeSchema,
  emailEnabled: z.boolean(),
})
export const updateNotificationPreferencesSchema = z
  .object({ preferences: z.array(notificationEmailPreferenceSchema).min(1).max(3) })
  .superRefine(({ preferences }, context) => {
    const types = preferences.map((preference) => preference.type)
    if (new Set(types).size !== types.length) {
      context.addIssue({
        code: 'custom',
        path: ['preferences'],
        message: 'Preference types must be unique.',
      })
    }
  })
export type NotificationEmailPreferenceType = z.infer<typeof notificationEmailPreferenceTypeSchema>
export type NotificationEmailPreference = z.infer<typeof notificationEmailPreferenceSchema>

export const managedUserIdParamsSchema = z.object({ userId: databaseUuidSchema })
export const listManagedUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  role: userRoleSchema.optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
