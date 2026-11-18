import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { adminEmailApi, type EmailLogStatus } from './client'

const emailAdminKey = ['admin-email'] as const

export const adminEmailKeys = {
  logs: (filters: { status?: EmailLogStatus; recipient?: string }) =>
    [...emailAdminKey, 'logs', filters] as const,
  suppressions: [...emailAdminKey, 'suppressions'] as const,
}

export function useAdminEmailLogs(filters: { status?: EmailLogStatus; recipient?: string }) {
  return useQuery({
    queryKey: adminEmailKeys.logs(filters),
    queryFn: () => adminEmailApi.listLogs(filters),
  })
}

export function useEmailSuppressions() {
  return useQuery({ queryKey: adminEmailKeys.suppressions, queryFn: adminEmailApi.suppressions })
}

function useEmailAction(action: (id: string) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: emailAdminKey })
    },
  })
}

export function useRetryEmail() {
  return useEmailAction(adminEmailApi.retry)
}

export function useClearEmailSuppression() {
  return useEmailAction(adminEmailApi.clearSuppression)
}
