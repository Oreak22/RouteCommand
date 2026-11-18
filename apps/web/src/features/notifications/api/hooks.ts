import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { notificationPreferencesApi } from './client'

const preferencesKey = ['notification-preferences'] as const

export function useNotificationPreferences() {
  return useQuery({ queryKey: preferencesKey, queryFn: notificationPreferencesApi.get })
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notificationPreferencesApi.update,
    onSuccess: async (data) => {
      queryClient.setQueryData(preferencesKey, data)
      await queryClient.invalidateQueries({ queryKey: preferencesKey })
    },
  })
}
