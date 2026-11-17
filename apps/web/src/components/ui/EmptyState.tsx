import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="rounded-full bg-base-200 p-3 text-base-content/55">
        <Inbox aria-hidden="true" />
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="mt-1 max-w-sm text-sm text-base-content/60">{description}</p>}
      </div>
      {action}
    </div>
  )
}
