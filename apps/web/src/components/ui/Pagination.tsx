import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from './Button'

type PaginationProps = {
  currentPage: number
  pageCount: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null

  return (
    <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-xs text-base-content/60">
        Page <span className="font-data">{currentPage}</span> of{' '}
        <span className="font-data">{pageCount}</span>
      </p>
      <div className="join">
        <Button
          className="join-item"
          size="sm"
          variant="outline"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          className="join-item"
          size="sm"
          variant="outline"
          aria-label="Next page"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
