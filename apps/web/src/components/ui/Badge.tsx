import type { HTMLAttributes, ReactNode } from 'react'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
  children: ReactNode
}

const tones = {
  default: 'badge-neutral',
  primary: 'badge-primary',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
} as const

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span className={`badge ${tones[tone]} ${className}`.trim()} {...props}>
      {children}
    </span>
  )
}
