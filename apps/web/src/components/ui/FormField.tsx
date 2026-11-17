import type { ReactElement, ReactNode } from 'react'
import { cloneElement, isValidElement } from 'react'
import { useId } from 'react'

type FormFieldProps = {
  label: string
  children: ReactNode
  hint?: string
  error?: string
  htmlFor?: string
  required?: boolean
}

export function FormField({ label, children, hint, error, htmlFor, required }: FormFieldProps) {
  const generatedId = useId()
  const fieldId = htmlFor ?? generatedId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? fieldId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { invalid: true, 'aria-invalid': true } : {}),
      })
    : children

  return (
    <div className="form-control w-full gap-1.5">
      <label className="label justify-start gap-1 p-0 text-sm font-medium" htmlFor={fieldId}>
        {label}
        {required && (
          <span className="text-error" aria-label="required">
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <p className="text-sm text-error" id={`${fieldId}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-base-content/60" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
