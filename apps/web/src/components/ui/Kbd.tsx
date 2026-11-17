import type { HTMLAttributes, ReactNode } from 'react'

export function Kbd({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <kbd className={`kbd kbd-sm font-data ${className}`.trim()} {...props}>
      {children}
    </kbd>
  )
}
