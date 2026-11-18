import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { EmptyState } from './EmptyState'
import { Pagination } from './Pagination'
import { Skeleton } from './Skeleton'

export type DataColumn<Row> = {
  key: keyof Row
  header: string
  sortable?: boolean
  render?: (row: Row) => ReactNode
  className?: string
}

type DataTableProps<Row> = {
  columns: readonly DataColumn<Row>[]
  rows: Row[]
  getRowId: (row: Row) => string
  loading?: boolean
  emptyTitle?: string
  pageSize?: number
  highlightedRowId?: string | null
}

export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  loading = false,
  emptyTitle = 'Nothing to show yet',
  pageSize = 6,
  highlightedRowId = null,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ key: keyof Row; direction: 'asc' | 'desc' } | null>(null)
  const [page, setPage] = useState(1)

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    return [...rows].sort((left, right) => {
      const a = left[sort.key]
      const b = right[sort.key]
      const result = String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true })
      return sort.direction === 'asc' ? result : -result
    })
  }, [rows, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize)

  const toggleSort = (key: keyof Row) => {
    setPage(1)
    setSort((previous) => ({
      key,
      direction: previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="overflow-x-auto rounded-box border border-base-content/10">
        <table className="table table-zebra">
          <thead className="bg-base-200 text-xs uppercase tracking-widest text-base-content/65">
            <tr>
              {columns.map((column) => (
                <th className={column.className} key={String(column.key)} scope="col">
                  {column.sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2"
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.header}
                      {sort?.key === column.key ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {!loading && rows.length > 0 && (
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={getRowId(row)}
                  className={
                    getRowId(row) === highlightedRowId
                      ? 'bg-primary/15 outline outline-2 -outline-offset-2 outline-primary'
                      : undefined
                  }
                  aria-current={getRowId(row) === highlightedRowId ? 'true' : undefined}
                >
                  {columns.map((column) => (
                    <td className={column.className} key={String(column.key)}>
                      {column.render ? column.render(row) : String(row[column.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {loading && (
          <div className="space-y-3 p-4" role="status" aria-label="Loading table">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        )}
        {!loading && rows.length === 0 && (
          <EmptyState
            title={emptyTitle}
            description="Try adjusting your filters or check back later."
          />
        )}
      </div>
      {!loading && <Pagination currentPage={page} pageCount={pageCount} onPageChange={setPage} />}
    </div>
  )
}
