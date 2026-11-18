import { ArrowLeft, Command, ShieldCheck } from 'lucide-react'
import { Link, Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '../features/auth/auth-context'
import { ThemeToggle } from '../theme/ThemeToggle'

export function PublicLayout() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const homePath = user?.role === 'DRIVER' ? '/driver' : user ? '/app/dashboard' : '/track'
  const back = () => {
    const historyIndex = window.history.state?.idx
    if (typeof historyIndex === 'number' && historyIndex > 0) navigate(-1)
    else navigate(homePath)
  }

  return (
    <div className="min-h-screen bg-base-200">
      <header className="sticky top-0 z-30 border-b border-base-content/10 bg-base-100/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <button
            className="btn btn-ghost btn-sm shrink-0 gap-2"
            aria-label="Go back to the previous page"
            onClick={back}
          >
            <ArrowLeft aria-hidden="true" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <Link
            className="flex min-w-0 items-center gap-3"
            to="/track"
            aria-label="RouteCommand tracking"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-box bg-primary text-primary-content">
              <Command className="size-5" aria-hidden="true" />
            </span>
            <span className="truncate font-semibold tracking-widest">ROUTECOMMAND</span>
            <span className="hidden border-l border-base-content/15 pl-3 text-xs text-base-content/55 sm:block">
              Parcel tracking
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Link className="btn btn-ghost btn-sm hidden sm:inline-flex" to={homePath}>
                My workspace
              </Link>
            ) : (
              <Link className="btn btn-ghost btn-sm hidden sm:inline-flex" to="/login">
                Sign in
              </Link>
            )}
            <ThemeToggle />
          </div>
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
