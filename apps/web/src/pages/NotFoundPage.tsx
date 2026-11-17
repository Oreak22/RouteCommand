import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-base-200 p-6">
      <div className="max-w-md text-center">
        <p className="font-data text-sm text-primary">404 · ROUTE NOT FOUND</p>
        <h1 className="mt-3 text-3xl font-semibold">This route is off the map.</h1>
        <p className="mt-3 text-sm text-base-content/60">
          The page may have moved, or the address may be incomplete.
        </p>
        <Link className="btn btn-primary mt-6" to="/app/dashboard">
          Return to overview
        </Link>
      </div>
    </main>
  )
}
