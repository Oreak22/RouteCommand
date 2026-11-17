import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { Button } from './Button'

export type DropdownItem = { label: string; onSelect: () => void; disabled?: boolean }

type DropdownProps = {
  label: string
  items: DropdownItem[]
}

export function Dropdown({ label, items }: DropdownProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative inline-block">
      <Button
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      {open && (
        <ul
          className="menu absolute right-0 top-full z-20 mt-2 min-w-44 rounded-box border border-base-content/10 bg-base-100 p-2 shadow-lg"
          role="menu"
          aria-label={label}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect()
                  setOpen(false)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
