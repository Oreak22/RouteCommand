import type { InputHTMLAttributes } from 'react'

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string
}

export function Toggle({ label, className = '', ...props }: ToggleProps) {
  return (
    <label className="label cursor-pointer justify-start gap-3">
      <input
        type="checkbox"
        role="switch"
        className={`toggle toggle-primary ${className}`}
        {...props}
      />
      <span>{label}</span>
    </label>
  )
}
