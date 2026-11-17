import type { SelectHTMLAttributes } from 'react'

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean | undefined
}

export function Select({ className = '', invalid = false, children, ...props }: SelectProps) {
  return (
    <select
      className={`select select-bordered w-full ${invalid ? 'select-error' : ''} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  )
}
