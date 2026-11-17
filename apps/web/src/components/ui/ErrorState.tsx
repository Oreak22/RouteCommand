import { CircleAlert, RefreshCw } from 'lucide-react'

import { Button } from './Button'

type ErrorStateProps = {
  title?: string
  description: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'We could not load this view',
  description,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      role="alert"
    >
      <span className="rounded-full bg-error/10 p-3 text-error">
        <CircleAlert aria-hidden="true" />
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-base-content/60">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  )
}
