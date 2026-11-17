import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'
import { Badge } from './Badge'
import { Breadcrumbs } from './Breadcrumbs'
import { Card } from './Card'
import { ConnectionBanner } from './ConnectionBanner'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'
import { Kbd } from './Kbd'
import { Skeleton } from './Skeleton'
import { Spinner } from './Spinner'
import { StatCard } from './StatCard'
import { StatusPill } from './StatusPill'
import { Stepper } from './Stepper'
import { Tooltip } from './Tooltip'

describe('display primitives', () => {
  it('renders accessible identity, status, progress, and feedback states', () => {
    render(
      <MemoryRouter>
        <Avatar name="Amara Okafor" />
        <Badge tone="success">Connected</Badge>
        <Breadcrumbs items={[{ label: 'Drivers', to: '/drivers' }, { label: 'Amara' }]} />
        <Card>Dispatch summary</Card>
        <ConnectionBanner online={false} message="Connection interrupted" />
        <EmptyState title="No routes yet" description="Assigned routes will appear here." />
        <Kbd>⌘ K</Kbd>
        <Skeleton data-testid="loading-skeleton" />
        <Spinner label="Loading fleet" />
        <StatCard label="Active drivers" value={24} change="3 available" trend="up" />
        <StatusPill category="shipment" status="IN_TRANSIT" />
        <Stepper
          steps={[{ label: 'Created' }, { label: 'In transit' }, { label: 'Delivered' }]}
          currentStep={1}
        />
        <Tooltip label="More details">
          <button type="button">Details</button>
        </Tooltip>
        <IconButton aria-label="Open details">i</IconButton>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('Amara Okafor')).toHaveTextContent('AO')
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Drivers')
    expect(screen.getByText('Dispatch summary')).toBeInTheDocument()
    expect(
      screen.getByText('Connection interrupted').closest('[role="status"]'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No routes yet' })).toBeInTheDocument()
    expect(screen.getByText('⌘ K')).toBeInTheDocument()
    expect(screen.getByTestId('loading-skeleton')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status', { name: 'Loading fleet' })).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('In transit')).toBeInTheDocument()
    expect(screen.getByText('In transit').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('tooltip')).toHaveTextContent('More details')
    expect(screen.getByRole('button', { name: 'Open details' })).toBeInTheDocument()
  })
})
