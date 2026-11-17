import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

import { Input } from './Input'

type ComboboxProps = InputHTMLAttributes<HTMLInputElement> & {
  options: string[]
  invalid?: boolean | undefined
}

export function Combobox({ options, invalid, ...props }: ComboboxProps) {
  const listId = useId()

  return (
    <>
      <Input {...props} list={listId} role="combobox" aria-autocomplete="list" invalid={invalid} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  )
}
