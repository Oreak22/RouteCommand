import type { InputHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean | undefined
}

export function Input({ className = '', invalid = false, ...props }: InputProps) {
  return (
    <input
      className={`input input-bordered w-full ${invalid ? 'input-error' : ''} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}
