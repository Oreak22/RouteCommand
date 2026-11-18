import type { PublicTrackingResponse } from '@routecommand/shared'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export async function getPublicTracking(trackingCode: string): Promise<PublicTrackingResponse> {
  const response = await fetch(`${apiBase}/api/v1/tracking/${encodeURIComponent(trackingCode)}`, {
    cache: 'no-store',
  })
  const payload = (await response.json()) as {
    data?: PublicTrackingResponse
    error?: { message?: string }
  }
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? 'Tracking details could not be loaded.')
  }
  return payload.data
}
