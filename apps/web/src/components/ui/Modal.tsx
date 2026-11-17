import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

import { IconButton } from './IconButton'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  description?: string
  footer?: ReactNode
}

export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog || dialog.open) return

    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [open])

  if (!open) return null

  return (
    <dialog
      className="modal"
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <section className="modal-box border border-base-content/10 bg-base-100">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" id={titleId}>
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-base-content/60">{description}</p>}
          </div>
          <IconButton variant="ghost" size="sm" aria-label="Close dialog" onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </header>
        <div className="py-5">{children}</div>
        {footer && <footer className="modal-action">{footer}</footer>}
      </section>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="Close dialog" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  )
}
