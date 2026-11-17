import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DriversPage } from './DriversPage'
import { DriverStatusToggle } from './DriverStatusToggle'
import { VehiclesPage } from './VehiclesPage'
import { ToastProvider } from '../../../components/ui/Toast'
import { AuthContext } from '../../auth/auth-context'
import type { Driver, Vehicle } from '../api/client'

const hooks = vi.hoisted(() => ({
  useDrivers: vi.fn(),
  useVehicles: vi.fn(),
  useVehicleDriverAssignment: vi.fn(),
  useFleetMutation: vi.fn(),
  useDriverStatusMutation: vi.fn(),
}))

vi.mock('../api/hooks', () => hooks)

const admin = {
  id: 'user-1',
  email: 'admin@routecommand.test',
  name: 'Test Admin',
  role: 'ADMIN' as const,
  isActive: true,
  emailVerifiedAt: null,
}

function renderWithProviders(element: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            user: admin,
            loading: false,
            login: vi.fn(),
            register: vi.fn(),
            logout: vi.fn(),
          }}
        >
          {element}
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function driver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver-1',
    userId: 'user-driver-1',
    name: 'Sam Driver',
    email: 'sam@routecommand.test',
    phone: null,
    isActive: true,
    licenseNo: 'LIC-1',
    status: 'AVAILABLE',
    statusChangedAt: new Date().toISOString(),
    rating: null,
    vehicleId: null,
    vehiclePlate: null,
    vehicleType: null,
    lng: null,
    lat: null,
    lastSeenAt: null,
    signalState: 'NO_SIGNAL',
    ...overrides,
  }
}

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'vehicle-1',
    plate: 'RC-101',
    type: 'VAN',
    capacityKg: 1000,
    isActive: true,
    assignedDriverId: null,
    assignedDriverName: null,
    assignedDriverStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('fleet pages', () => {
  const originalShowModal = HTMLDialogElement.prototype.showModal
  const originalClose = HTMLDialogElement.prototype.close

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
    hooks.useDrivers.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    hooks.useVehicles.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    hooks.useVehicleDriverAssignment.mockReturnValue({ mutateAsync: vi.fn() })
    hooks.useFleetMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
    })
    hooks.useDriverStatusMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  afterEach(() => {
    cleanup()
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
  })

  it('shows driver loading, empty, and error states', () => {
    hooks.useDrivers.mockReturnValue({
      data: [],
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    })
    const first = renderWithProviders(<DriversPage />)
    expect(screen.getByText('Loading drivers…')).toBeInTheDocument()
    first.unmount()

    hooks.useDrivers.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    const second = renderWithProviders(<DriversPage />)
    expect(screen.getByText('No drivers found')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add driver' })).toHaveLength(2)
    second.unmount()

    hooks.useDrivers.mockReturnValue({
      data: [],
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    })
    renderWithProviders(<DriversPage />)
    expect(screen.getByText('Drivers could not be loaded')).toBeInTheDocument()
  })

  it('renders driver status and signal states in the table', () => {
    hooks.useDrivers.mockReturnValue({
      data: [driver(), driver({ id: 'driver-2', name: 'Lee Driver', signalState: 'SIGNAL_LOST' })],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderWithProviders(<DriversPage />)
    expect(screen.getByText('Sam Driver')).toBeInTheDocument()
    expect(screen.getByText('No signal')).toBeInTheDocument()
    expect(screen.getByText('Signal lost')).toBeInTheDocument()
    expect(screen.getAllByText('available')).toHaveLength(2)
  })

  it('shows vehicle loading, empty, and error states', () => {
    hooks.useVehicles.mockReturnValue({
      data: [],
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    })
    const first = renderWithProviders(<VehiclesPage />)
    expect(screen.getByText('Loading vehicles…')).toBeInTheDocument()
    first.unmount()

    hooks.useVehicles.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    const second = renderWithProviders(<VehiclesPage />)
    expect(screen.getByText('No vehicles registered')).toBeInTheDocument()
    second.unmount()

    hooks.useVehicles.mockReturnValue({
      data: [],
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    })
    renderWithProviders(<VehiclesPage />)
    expect(screen.getByText('Vehicles could not be loaded')).toBeInTheDocument()
  })

  it('shows registered vehicle data and active state', () => {
    hooks.useVehicles.mockReturnValue({
      data: [vehicle({ assignedDriverName: 'Sam Driver', isActive: false })],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderWithProviders(<VehiclesPage />)
    expect(screen.getByText('RC-101')).toBeInTheDocument()
    expect(screen.getByText('Sam Driver')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('asks before forcing offline when a driver still has active shipments', async () => {
    const user = userEvent.setup()
    const conflict = Object.assign(new Error('Active shipments'), {
      status: 409,
      details: { reason: 'ACTIVE_SHIPMENTS', activeShipmentCount: 2 },
    })
    const mutateAsync = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(driver({ status: 'OFFLINE' }))
    hooks.useDriverStatusMutation.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: conflict,
    })
    renderWithProviders(<DriverStatusToggle driver={driver()} />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Availability' }), 'OFFLINE')
    await user.click(screen.getByRole('button', { name: 'Update status' }))
    expect(
      await screen.findByRole('dialog', { name: 'Go offline with active shipments?' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/2 active shipment/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go offline anyway' }))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenLastCalledWith({ status: 'OFFLINE', force: true }),
    )
  })
})
