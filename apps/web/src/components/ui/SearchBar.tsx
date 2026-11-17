import { Search } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

import { Input } from './Input'

type SearchBarProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string
}

export function SearchBar({ label = 'Search', className = '', ...props }: SearchBarProps) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-base-content/45"
        aria-hidden="true"
      />
      <Input type="search" placeholder={label} className="pl-9" {...props} />
    </label>
  )
}
