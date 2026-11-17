import { PackageCheck, ShieldCheck } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'

import { ThemeToggle } from '../theme/ThemeToggle'

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-base-200">
      <header className="border-b border-base-content/10 bg-base-100">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link className="flex items-center gap-3" to="/track/RC-4826-91">
            <span className="grid size-9 place-items-center rounded-box bg-primary text-primary-content">
              <PackageCheck className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-bold tracking-widest">ROUTECOMMAND</span>
              <span className="block text-xs text-base-content/55">Parcel tracking</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
      <footer className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-8 text-xs text-base-content/50 sm:px-6">
        <ShieldCheck className="size-4" aria-hidden="true" />
        Your tracking details are private and only available to people with this link.
      </footer>
    </div>
  )
}
