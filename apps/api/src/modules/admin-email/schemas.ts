import { z } from 'zod'

export const emailLogQuerySchema = z.object({
  status: z
    .enum(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED'])
    .optional(),
  template: z.string().trim().min(1).max(100).optional(),
  recipient: z.string().trim().min(1).max(320).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const emailIdParamsSchema = z.object({ emailId: z.string().uuid() })
export const suppressionParamsSchema = z.object({ email: z.string().email().max(320) })

export type EmailLogQuery = z.infer<typeof emailLogQuerySchema>
