import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { securityEventsApi } from './client'

const securityEventsKey = ['security-events'] as const

export function useSecurityEvents(filters: { status?: string; severity?: string }) {
  return useQuery({
    queryKey: [...securityEventsKey, filters],
    queryFn: () => securityEventsApi.list(filters),
    refetchInterval: 30_000,
  })
}

export function useUpdateSecurityEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'REVIEWED' | 'DISMISSED' }) =>
      securityEventsApi.update(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: securityEventsKey })
    },
  })
}
