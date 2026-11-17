import { ClipboardList, LogOut, UserRound, Wifi, WifiOff } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import type { NavLinkRenderProps } from 'react-router-dom'

import { useAuth } from '../features/auth/auth-context'
import { RealtimeConnectionBanner } from '../features/realtime/RealtimeConnectionBanner'
import { useRealtime } from '../features/realtime/useRealtime'
import { ThemeToggle } from '../theme/ThemeToggle'

const tabs = [
  { label: 'Jobs', to: '/driver', icon: ClipboardList, end: true },
  { label: 'Shipments', to: '/driver/shipments', icon: ClipboardList },
  { label: 'Profile', to: '/driver/profile', icon: UserRound },
] as const

export function DriverLayout() {
  const { logout, user } = useAuth()
  const { status } = useRealtime()
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-base-200">
      <RealtimeConnectionBanner />
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-base-content/10 bg-base-100 px-4">
        <div>
          <p className="text-xs font-bold tracking-widest">ROUTECOMMAND</p>
          <p className="text-xs text-base-content/55">{user?.name} · Driver workspace</p>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Sign out"
            onClick={() => void logout()}
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>
      <main className="flex-1 p-4 pb-24 sm:p-6 sm:pb-24">
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-3xl grid-cols-3 border-t border-base-content/10 bg-base-100/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
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
    </div>
  )
}
