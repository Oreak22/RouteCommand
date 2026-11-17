import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { IconButton } from './IconButton'

type DrawerProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  side?: 'left' | 'right'
}

export function Drawer({ open, onClose, title, children, side = 'left' }: DrawerProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        className="absolute inset-0 cursor-default bg-neutral/65"
        onClick={onClose}
        aria-label="Close navigation drawer"
      />
      <aside
        className={`relative flex h-full w-80 max-w-[85vw] flex-col border-base-content/10 bg-base-100 p-5 shadow-xl ${side === 'right' ? 'ml-auto border-l' : 'border-r'}`}
        aria-label={title}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <IconButton variant="ghost" size="sm" aria-label="Close drawer" onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </aside>
    </div>
  )
}
