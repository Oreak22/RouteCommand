import { Bell, ClipboardList, LogOut, Map, Menu, UserRound, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import type { NavLinkRenderProps } from 'react-router-dom'

import { Drawer } from '../components/ui/Drawer'
import { IconButton } from '../components/ui/IconButton'
import { useAuth } from '../features/auth/auth-context'
import { RealtimeConnectionBanner } from '../features/realtime/RealtimeConnectionBanner'
import { useRealtime } from '../features/realtime/useRealtime'
import { ShipmentSuggestionListener } from '../features/shipments/components/ShipmentSuggestionListener'
import { DriverOfflineSync } from '../features/telemetry/DriverOfflineSync'
import { DriverTelemetryProvider } from '../features/telemetry/DriverTelemetryProvider'
import { ThemeToggle } from '../theme/ThemeToggle'

const tabs = [
  { label: 'Jobs', to: '/driver', icon: ClipboardList, end: true },
  { label: 'Shipments', to: '/driver/shipments', icon: ClipboardList },
  { label: 'Map', to: '/driver/map', icon: Map },
  { label: 'Profile', to: '/driver/profile', icon: UserRound },
] as const

export function DriverLayout() {
  const { logout, user } = useAuth()
  const { status } = useRealtime()
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <DriverTelemetryProvider>
      <div className="mx-auto flex min-h-screen min-w-0 max-w-3xl flex-col bg-base-200">
        <ShipmentSuggestionListener />
        <DriverOfflineSync />
        <RealtimeConnectionBanner />
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-2 border-b border-base-content/10 bg-base-100 px-3 pt-[env(safe-area-inset-top)] sm:px-4">
          <div className="min-w-0 py-2">
            <p className="text-xs font-bold tracking-widest">ROUTECOMMAND</p>
            <p className="max-w-[13rem] truncate text-xs text-base-content/55 sm:max-w-none">
              {user?.name} · Driver workspace
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <span
              className={`hidden items-center gap-1.5 text-xs sm:flex ${status === 'connected' ? 'text-success' : 'text-warning'}`}
            >
              {status === 'connected' ? (
                <Wifi className="size-3.5" aria-hidden="true" />
              ) : (
                <WifiOff className="size-3.5" aria-hidden="true" />
              )}
              {status === 'connected' ? 'Live' : 'Reconnecting'}
            </span>
            <ThemeToggle />
            <NavLink
              className="btn btn-ghost btn-sm btn-square"
              to="/account/password"
              aria-label="Change password"
            >
              <UserRound className="size-4" aria-hidden="true" />
            </NavLink>
            <Link
              className="btn btn-ghost btn-sm btn-square"
              to="/account/notifications"
              aria-label="Notification preferences"
            >
              <Bell className="size-4" aria-hidden="true" />
            </Link>
            <button
              className="btn btn-ghost btn-sm btn-square"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          </div>
          <IconButton
            className="sm:hidden"
            variant="ghost"
            aria-label="Open account settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Menu aria-hidden="true" />
          </IconButton>
        </header>
        <main className="min-w-0 flex-1 p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-24">
          <Outlet />
        </main>
        <nav
          className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-3xl grid-cols-4 border-t border-base-content/10 bg-base-100/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
          aria-label="Driver navigation"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <NavLink
                end={'end' in tab ? tab.end : undefined}
                className={({ isActive }: NavLinkRenderProps) =>
                  `flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${isActive ? 'text-primary' : 'text-base-content/55'}`
                }
                key={tab.to}
                to={tab.to}
              >
                <Icon className="size-5" aria-hidden="true" />
                {tab.label}
              </NavLink>
            )
          })}
        </nav>
        <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Driver account">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="mt-1 text-xs text-base-content/55">Driver workspace</p>
          <div className="mt-5 flex flex-1 flex-col gap-2">
            <ThemeToggle />
            <Link
              className="btn btn-ghost justify-start"
              onClick={() => setSettingsOpen(false)}
              to="/account/password"
            >
              <UserRound className="size-4" aria-hidden="true" />
              Change password
            </Link>
            <Link
              className="btn btn-ghost justify-start"
              onClick={() => setSettingsOpen(false)}
              to="/account/notifications"
            >
              <Bell className="size-4" aria-hidden="true" />
              Notifications
            </Link>
          </div>
          <button
            className="btn btn-ghost justify-start text-error"
            onClick={() => {
              setSettingsOpen(false)
              void logout()
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </Drawer>
      </div>
    </DriverTelemetryProvider>
  )
}
