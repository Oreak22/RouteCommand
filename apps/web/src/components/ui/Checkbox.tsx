import type { InputHTMLAttributes } from 'react'

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string
}

export function Checkbox({ label, className = '', ...props }: CheckboxProps) {
  const checkbox = (
    <input type="checkbox" className={`checkbox checkbox-primary ${className}`} {...props} />
  )
  return label ? (
    <label className="label cursor-pointer justify-start gap-3">
      {checkbox}
      <span>{label}</span>
    </label>
  ) : (
    checkbox
  )
}
