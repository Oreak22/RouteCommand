import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode
  padded?: boolean
}

export function Card({ children, className = '', padded = true, ...props }: CardProps) {
  return (
    <section
      className={`card border border-base-content/10 bg-base-100 shadow-sm ${className}`.trim()}
      {...props}
    >
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  )
}
