import { ArrowLeft, Radar } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'

import { ThemeToggle } from '../theme/ThemeToggle'

export function AuthLayout() {
  return (
    <main className="grid min-h-screen bg-base-200 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-base-300 p-12 lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute inset-0 opacity-20" aria-hidden="true">
          <div className="absolute -left-24 top-24 size-96 rounded-full border border-primary/40" />
          <div className="absolute -left-8 top-40 size-64 rounded-full border border-primary/30" />
          <div className="absolute left-10 top-56 size-32 rounded-full border border-primary/20" />
          <div className="absolute inset-x-0 top-1/2 border-t border-primary/20" />
        </div>
        <Link className="relative inline-flex items-center gap-3" to="/app/dashboard">
          <span className="grid size-11 place-items-center rounded-box bg-primary text-primary-content">
            <Radar aria-hidden="true" />
          </span>
          <span className="font-semibold tracking-widest">ROUTECOMMAND</span>
        </Link>
        <div className="relative max-w-lg">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-accent">
            Operations, in motion
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            A clear picture of every delivery.
          </h1>
          <p className="mt-5 max-w-md text-base text-base-content/65">
            One operational view for dispatch teams, drivers, and the people waiting for a parcel.
          </p>
        </div>
        <p className="relative font-data text-xs text-base-content/45">
          LIVE OPERATIONS PLATFORM · LAGOS DEMO REGION
        </p>
      </section>
      <section className="flex min-h-screen flex-col p-5 sm:p-8 lg:p-10">
        <header className="flex items-center justify-between">
          <Link
            to="/app/dashboard"
            className="inline-flex items-center gap-2 text-xs text-base-content/60 hover:text-primary lg:hidden"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            RouteCommand
          </Link>
          <span className="lg:ml-auto">
            <ThemeToggle />
          </span>
        </header>
        <div className="grid flex-1 place-items-center py-10">
          <Outlet />
        </div>
        <footer className="text-center text-xs text-base-content/45">
          Secure access for RouteCommand operations
        </footer>
      </section>
    </main>
  )
}
