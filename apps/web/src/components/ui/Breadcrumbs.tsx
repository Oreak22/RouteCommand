import { ChevronRight, Home } from 'lucide-react'
import { Link } from 'react-router-dom'

export type BreadcrumbItem = { label: string; to?: string }

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-base-content/55">
      <ol className="flex flex-wrap items-center gap-2">
        <li>
          <Link className="inline-flex items-center gap-1 hover:text-primary" to="/app/dashboard">
            <Home className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Home</span>
          </Link>
        </li>
        {items.map((item, index) => (
          <li className="inline-flex items-center gap-2" key={`${item.label}-${index}`}>
            <ChevronRight className="size-3" aria-hidden="true" />
            {item.to && index < items.length - 1 ? (
              <Link className="hover:text-primary" to={item.to}>
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-base-content">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
