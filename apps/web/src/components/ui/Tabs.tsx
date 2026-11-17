import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export type TabItem = { id: string; label: string; content: ReactNode; disabled?: boolean }

type TabsProps = {
  items: TabItem[]
  label: string
  defaultTab?: string
}

export function Tabs({ items, label, defaultTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? items[0]?.id ?? '')

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    const enabled = items.filter((item) => !item.disabled)
    const currentIndex = enabled.findIndex((item) => item.id === items[index]?.id)
    const next = enabled[(currentIndex + direction + enabled.length) % enabled.length]
    if (!next) return
    setActiveTab(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  const active = items.find((item) => item.id === activeTab) ?? items[0]

  return (
    <div>
      <div className="tabs tabs-bordered" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            className={`tab ${active?.id === item.id ? 'tab-active' : ''}`}
            id={`tab-${item.id}`}
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active?.id === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={active?.id === item.id ? 0 : -1}
            disabled={item.disabled}
            onClick={() => setActiveTab(item.id)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {active && (
        <div
          className="py-4"
          id={`panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${active.id}`}
        >
          {active.content}
        </div>
      )}
    </div>
  )
}
