import { z } from 'zod'

export const securityEventListSchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  type: z.string().trim().min(1).max(100).optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const securityEventParamsSchema = z.object({ eventId: z.string().uuid() })
export const securityEventStatusSchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED']),
})

export type SecurityEventListInput = z.infer<typeof securityEventListSchema>
