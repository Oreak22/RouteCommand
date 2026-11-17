import type { InputHTMLAttributes } from 'react'

export type RadioOption = { value: string; label: string; disabled?: boolean }

type RadioGroupProps = {
  name: string
  label: string
  options: RadioOption[]
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'name' | 'value' | 'onChange'> & {
    value?: string
    onChange?: (value: string) => void
  }

export function RadioGroup({ name, label, options, value, onChange, ...props }: RadioGroupProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{label}</legend>
      {options.map((option) => (
        <label className="label cursor-pointer justify-start gap-3" key={option.value}>
          <input
            {...props}
            className="radio radio-primary"
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled || props.disabled}
            onChange={() => onChange?.(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
