import { LogOut } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'

import { useAuth } from '../features/auth/auth-context'
import { ThemeToggle } from '../theme/ThemeToggle'

export function MapLayout() {
  const { logout, user } = useAuth()
  return (
    <main className="relative h-screen min-h-[36rem] overflow-hidden bg-base-300">
      <header className="absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between border-b border-base-content/10 bg-base-100/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-4">
          <Link className="text-xs font-semibold tracking-widest" to="/app/dashboard">
            ROUTECOMMAND
          </Link>
          <span className="hidden h-5 border-l border-base-content/15 sm:block" />
          <span className="hidden text-xs text-base-content/60 sm:block">Zones & geofences</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="hidden items-center gap-2 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success sm:inline-flex">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            Zone editor
          </span>
          <ThemeToggle />
          <Link className="btn btn-ghost btn-sm" to="/account/password">
            Password
          </Link>
          <button
            className="btn btn-ghost btn-sm btn-square"
            aria-label={`Sign out ${user?.name ?? ''}`}
            onClick={() => void logout()}
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="absolute inset-x-0 bottom-0 top-14">
        <Outlet />
      </div>
    </main>
  )
}
