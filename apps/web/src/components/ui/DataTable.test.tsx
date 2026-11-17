import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DataTable } from './DataTable'

type Row = { id: string; location: string }
const columns = [
  { key: 'id', header: 'Tracking ID', sortable: true },
  { key: 'location', header: 'Destination', sortable: true },
] as const

describe('DataTable', () => {
  it('sorts rows and reports an empty state', async () => {
    const user = userEvent.setup()
    const rows: Row[] = [
      { id: 'RC-20', location: 'Yaba' },
      { id: 'RC-3', location: 'Lekki' },
    ]
    const { rerender } = render(
      <DataTable<Row> columns={columns} rows={rows} getRowId={(row) => row.id} />,
    )

    await user.click(screen.getByRole('button', { name: 'Tracking ID' }))
    const body = screen.getAllByRole('rowgroup')[1]
    expect(body).toBeDefined()
    const bodyRows = within(body!).getAllByRole('row')
    expect(bodyRows[0]).toHaveTextContent('RC-3')
    expect(bodyRows[1]).toHaveTextContent('RC-20')

    rerender(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        emptyTitle="No deliveries found"
      />,
    )
    expect(screen.getByText('No deliveries found')).toBeInTheDocument()
  })
})
