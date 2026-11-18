import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Command,
  ClipboardList,
  LayoutDashboard,
  LocateFixed,
  LockKeyhole,
  LogOut,
  Mail,
  MapPinned,
  Menu,
  PackageCheck,
  ShieldAlert,
  Truck,
  UsersRound,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import type { AppRole } from '../app/RequireRole'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { Drawer } from '../components/ui/Drawer'
import { IconButton } from '../components/ui/IconButton'
import { SearchBar } from '../components/ui/SearchBar'
import { AlertsBell } from '../features/alerts/components/AlertsBell'
import { AlertToastListener } from '../features/alerts/components/AlertToastListener'
import { useAuth } from '../features/auth/auth-context'
import { RealtimeConnectionBanner } from '../features/realtime/RealtimeConnectionBanner'
import { ThemeToggle } from '../theme/ThemeToggle'

const navItems: { label: string; to: string; icon: typeof LayoutDashboard; roles: AppRole[] }[] = [
  {
    label: 'Overview',
    to: '/app/dashboard',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'DISPATCHER'],
  },
  { label: 'Dashboard', to: '/app/dashboard', icon: LayoutDashboard, roles: ['CUSTOMER'] },
  { label: 'Alerts', to: '/app/alerts', icon: Activity, roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Dispatch', to: '/app/dispatch', icon: ClipboardList, roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Live map', to: '/map', icon: MapPinned, roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Zones', to: '/zones', icon: MapPinned, roles: ['ADMIN', 'DISPATCHER'] },
  {
    label: 'Shipments',
    to: '/app/shipments',
    icon: PackageCheck,
    roles: ['ADMIN', 'DISPATCHER', 'CUSTOMER'],
  },
  { label: 'Track a parcel', to: '/track', icon: LocateFixed, roles: ['CUSTOMER'] },
  { label: 'Drivers', to: '/app/drivers', icon: UsersRound, roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Vehicles', to: '/app/vehicles', icon: Truck, roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Email', to: '/app/admin/email', icon: Mail, roles: ['ADMIN'] },
  { label: 'Security', to: '/app/admin/security', icon: ShieldAlert, roles: ['ADMIN'] },
  {
    label: 'Notifications',
    to: '/account/notifications',
    icon: Bell,
    roles: ['ADMIN', 'DISPATCHER', 'DRIVER', 'CUSTOMER'],
  },
  { label: 'Driver workspace', to: '/driver', icon: Truck, roles: ['DRIVER'] },
]

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="flex items-center gap-3" to="/app/dashboard" aria-label="RouteCommand home">
      <span className="grid size-9 shrink-0 place-items-center rounded-box bg-primary text-primary-content">
        <Command className="size-5" aria-hidden="true" />
      </span>
      {!compact && <span className="font-semibold tracking-widest">ROUTECOMMAND</span>}
    </Link>
  )
}

function Navigation({
  onNavigate,
  compact = false,
}: {
  onNavigate?: () => void
  compact?: boolean
}) {
  const location = useLocation()
  const { user } = useAuth()
  const role = user?.role ?? 'CUSTOMER'
  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-1">
      <p
        className={`px-3 pb-2 pt-5 text-xs font-semibold uppercase tracking-widest text-base-content/40 ${compact ? 'sr-only' : ''}`}
      >
        Workspace
      </p>
      {navItems
        .filter((item) => item.roles.includes(role))
        .map((item) => {
          const Icon = item.icon
          const active =
            location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
          return (
            <NavLink
              className={`flex items-center gap-3 rounded-field px-3 py-2.5 text-sm transition-colors ${active ? 'bg-primary/12 font-medium text-primary' : 'text-base-content/65 hover:bg-base-content/5 hover:text-base-content'} ${compact ? 'justify-center px-2' : ''}`}
              key={item.to}
              onClick={onNavigate}
              to={item.to}
              title={compact ? item.label : undefined}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!compact && <span>{item.label}</span>}
            </NavLink>
          )
        })}
    </nav>
  )
}

function AccountSection({
  compact = false,
  onNavigate,
}: {
  compact?: boolean
  onNavigate?: () => void
}) {
  const { user, logout } = useAuth()
  const roleLabel = user?.role ? `${user.role[0]}${user.role.slice(1).toLowerCase()}` : 'Account'
  const signOut = () => {
    onNavigate?.()
    void logout()
  }
  return (
    <section className="border-t border-base-content/10 pt-4" aria-label="Account">
      <div className={`flex items-center gap-2 ${compact ? 'justify-center' : ''}`}>
        <Avatar name={user?.name ?? 'Account'} size="sm" />
        {!compact && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-base-content/50">{roleLabel}</p>
          </div>
        )}
      </div>
      <div className={`mt-2 flex gap-2 ${compact ? 'flex-col items-center' : ''}`}>
        <Link
          className={`btn btn-ghost btn-sm ${compact ? 'btn-square' : 'flex-1 justify-start'}`}
          onClick={onNavigate}
          to="/account/password"
          title="Password"
        >
          <LockKeyhole className="size-4" aria-hidden="true" />
          {!compact && 'Password'}
        </Link>
        {compact ? (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            title="Sign out"
            onClick={signOut}
          >
            <LogOut className="size-4" aria-hidden="true" />
          </IconButton>
        ) : (
          <Button
            className="flex-1 justify-start"
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            onClick={signOut}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        )}
      </div>
    </section>
  )
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-base-200">
      {(user?.role === 'ADMIN' || user?.role === 'DISPATCHER') && <AlertToastListener />}
      <div className="flex min-h-screen">
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-base-content/10 bg-base-100 px-3 py-5 transition-[width] xl:flex ${collapsed ? 'w-20' : 'w-64'}`}
        >
          <div className={`px-2 ${collapsed ? 'flex justify-center' : ''}`}>
            <Brand compact={collapsed} />
          </div>
          <div className="my-5 border-t border-base-content/10" />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Navigation compact={collapsed} />
          </div>
          <div className="mt-4 rounded-box border border-base-content/10 bg-base-200 p-3">
            {!collapsed && (
              <>
                <p className="text-xs font-semibold">System status</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  All services operational
                </p>
              </>
            )}
            {collapsed && (
              <Activity className="mx-auto size-5 text-success" aria-label="System operational" />
            )}
          </div>
          <div className="mt-4">
            <AccountSection compact={collapsed} />
          </div>
          <IconButton
            className="mt-3 self-end"
            size="sm"
            variant="ghost"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
          </IconButton>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-base-content/10 bg-base-100/95 px-4 backdrop-blur sm:px-6">
            <IconButton
              className="xl:hidden"
              variant="ghost"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu aria-hidden="true" />
            </IconButton>
            <Link className="font-semibold tracking-wide xl:hidden" to="/app/dashboard">
              ROUTECOMMAND
            </Link>
            <div className="hidden w-full max-w-sm md:block">
              <SearchBar label="Search shipments, drivers…" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {(user?.role === 'ADMIN' || user?.role === 'DISPATCHER') && <AlertsBell />}
              <ThemeToggle />
            </div>
          </header>
          <RealtimeConnectionBanner />
          <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 xl:p-8">
            <Outlet />
          </main>
        </div>
      </div>
      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        title="RouteCommand navigation"
      >
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Navigation onNavigate={() => setMobileOpen(false)} />
        </div>
        <AccountSection onNavigate={() => setMobileOpen(false)} />
      </Drawer>
    </div>
  )
}
