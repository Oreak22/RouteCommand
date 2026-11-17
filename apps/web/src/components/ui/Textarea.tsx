import type { TextareaHTMLAttributes } from 'react'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean | undefined
}

export function Textarea({ className = '', invalid = false, ...props }: TextareaProps) {
  return (
    <textarea
      className={`textarea textarea-bordered min-h-24 w-full ${invalid ? 'textarea-error' : ''} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}
