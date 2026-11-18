import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { alertsApi } from './client'

const alertRootKey = ['alerts'] as const

export const alertKeys = {
  all: alertRootKey,
  list: (filters: object = {}) => [...alertRootKey, 'list', filters] as const,
  stats: [...alertRootKey, 'stats'] as const,
}

export function useAlerts(filters: { status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' } = {}) {
  return useQuery({ queryKey: alertKeys.list(filters), queryFn: () => alertsApi.list(filters) })
}

export function useAlertStats() {
  return useQuery({ queryKey: alertKeys.stats, queryFn: alertsApi.stats, refetchInterval: 60_000 })
}

function useAlertAction(action: typeof alertsApi.acknowledge) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: alertKeys.all })
    },
  })
}

export function useAcknowledgeAlert() {
  return useAlertAction(alertsApi.acknowledge)
}

export function useResolveAlert() {
  return useAlertAction(alertsApi.resolve)
}
