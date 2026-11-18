import { useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '../../../components/ui/Badge'
import { IconButton } from '../../../components/ui/IconButton'
import { useSocketEvent } from '../../realtime/useRealtime'
import { alertKeys, useAlertStats } from '../api/hooks'

export function AlertsBell() {
  const query = useAlertStats()
  const queryClient = useQueryClient()
  const refreshAlerts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: alertKeys.all })
  }, [queryClient])
  useSocketEvent('alert:created', refreshAlerts)
  useSocketEvent('alert:updated', refreshAlerts)
  const openCount = query.data?.byStatus.OPEN ?? 0

  return (
    <Link className="relative" to="/app/alerts" aria-label={`Alerts, ${openCount} open`}>
      <IconButton variant="ghost" aria-label="Alerts">
        <Bell aria-hidden="true" />
      </IconButton>
      {openCount > 0 && (
        <Badge
          tone="error"
          className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center border-0 p-0 text-xs"
        >
          {openCount > 9 ? '9+' : openCount}
        </Badge>
      )}
    </Link>
  )
}
