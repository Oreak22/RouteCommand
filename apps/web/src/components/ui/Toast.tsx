import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import { IconButton } from './IconButton'
import { ToastContext } from './toast-context'
import type { ToastTone } from './toast-context'

type ToastItem = { id: number; message: string; tone: ToastTone }

const icons = { success: CheckCircle2, error: CircleAlert, info: Info } as const
const tones = { success: 'alert-success', error: 'alert-error', info: 'alert-info' } as const

export function Toast({
  message,
  tone = 'info',
  onDismiss,
}: {
  message: string
  tone?: ToastTone
  onDismiss?: () => void
}) {
  const Icon = icons[tone]
  return (
    <div className={`alert ${tones[tone]} flex items-center gap-3 shadow-lg`} role="status">
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <IconButton size="sm" variant="ghost" aria-label="Dismiss notification" onClick={onDismiss}>
          <X aria-hidden="true" />
        </IconButton>
      )}
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, message, tone }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5000)
  }, [])

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        className="toast toast-end toast-bottom z-[100] w-[min(24rem,calc(100vw-2rem))]"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
