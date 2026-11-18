import { ArrowLeft, Command, LogOut, Menu } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { Drawer } from '../components/ui/Drawer'
import { IconButton } from '../components/ui/IconButton'
import { useAuth } from '../features/auth/auth-context'
import { ThemeToggle } from '../theme/ThemeToggle'

export function MapLayout() {
  const { logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const isZonesPage = pathname === '/zones'
  const goBack = () => {
    const historyIndex = window.history.state?.idx
    if (typeof historyIndex === 'number' && historyIndex > 0) navigate(-1)
    else navigate('/app/dashboard')
  }
  const closeMenu = () => setMenuOpen(false)

  return (
    <main className="relative h-screen min-h-[36rem] overflow-hidden bg-base-300">
      <header className="absolute inset-x-0 top-0 z-[1000] flex h-14 items-center gap-2 border-b border-base-content/10 bg-base-100/95 px-2 backdrop-blur sm:gap-4 sm:px-4">
        <button
          className="btn btn-ghost btn-sm shrink-0 gap-1 px-2"
          onClick={goBack}
          aria-label="Go back to the previous page"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <span className="hidden h-5 border-l border-base-content/15 sm:block" />
        <Link
          className="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-widest"
          to="/app/dashboard"
        >
          <Command className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="hidden truncate sm:inline">ROUTECOMMAND</span>
        </Link>
        <span className="hidden min-w-0 truncate text-xs text-base-content/60 md:block">
          {isZonesPage ? 'Zones & geofences' : 'Live operations map'}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="hidden items-center gap-2 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success lg:inline-flex">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            {isZonesPage ? 'Zone editor' : 'Live dispatcher map'}
          </span>
          <Link className="btn btn-ghost btn-sm" to={isZonesPage ? '/map' : '/zones'}>
            {isZonesPage ? 'Live map' : 'Zones'}
          </Link>
          <ThemeToggle />
          <IconButton
            variant="ghost"
            aria-label="Open operations navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" />
          </IconButton>
        </div>
      </header>
      <div className="absolute inset-x-0 bottom-0 top-14">
        <Outlet />
      </div>
      <Drawer open={menuOpen} onClose={closeMenu} title="Operations navigation">
        <div className="flex items-center gap-2 font-semibold tracking-widest">
          <Command className="size-5 text-primary" aria-hidden="true" />
          ROUTECOMMAND
        </div>
        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Operations navigation">
          <Link className="btn btn-ghost justify-start" onClick={closeMenu} to="/app/dashboard">
            Overview
          </Link>
          <Link className="btn btn-ghost justify-start" onClick={closeMenu} to="/app/dispatch">
            Dispatch
          </Link>
          <Link
            className={`btn justify-start ${!isZonesPage ? 'btn-primary' : 'btn-ghost'}`}
            onClick={closeMenu}
            to="/map"
          >
            Live map
          </Link>
          <Link
            className={`btn justify-start ${isZonesPage ? 'btn-primary' : 'btn-ghost'}`}
            onClick={closeMenu}
            to="/zones"
          >
            Zones
          </Link>
          <Link className="btn btn-ghost justify-start" onClick={closeMenu} to="/app/shipments">
            Shipments
          </Link>
        </nav>
        <Link className="btn btn-ghost justify-start" onClick={closeMenu} to="/account/password">
          Password
        </Link>
        <button
          className="btn btn-ghost mt-1 justify-start text-error"
          onClick={() => {
            closeMenu()
            void logout()
          }}
        >
          <LogOut className="size-4" aria-hidden="true" /> Sign out
        </button>
      </Drawer>
    </main>
  )
}
