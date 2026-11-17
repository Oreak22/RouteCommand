import type { ReactNode } from 'react'

import { Card } from './Card'

type StatCardProps = {
  label: string
  value: string | number
  change?: string
  icon?: ReactNode
  trend?: 'up' | 'down' | 'flat'
}

export function StatCard({ label, value, change, icon, trend = 'flat' }: StatCardProps) {
  const trendClass =
    trend === 'up' ? 'text-success' : trend === 'down' ? 'text-warning' : 'text-base-content/55'

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-base-content/55">
            {label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          {change && <p className={`mt-2 text-xs ${trendClass}`}>{change}</p>}
        </div>
        {icon && <span className="rounded-box bg-primary/10 p-2.5 text-primary">{icon}</span>}
      </div>
    </Card>
  )
}
