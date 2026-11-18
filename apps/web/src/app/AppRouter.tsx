import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './RequireAuth'
import { RequireRole } from './RequireRole'
import { Spinner } from '../components/ui/Spinner'
import { AppShell } from '../layouts/AppShell'
import { AuthLayout } from '../layouts/AuthLayout'
import { DriverLayout } from '../layouts/DriverLayout'
import { MapLayout } from '../layouts/MapLayout'
import { PublicLayout } from '../layouts/PublicLayout'

const AuthPage = lazy(() =>
  import('../pages/AuthPage').then((module) => ({ default: module.AuthPage })),
)
const RegisterPage = lazy(() =>
  import('../pages/AuthActionPages').then((module) => ({ default: module.RegisterPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('../pages/AuthActionPages').then((module) => ({ default: module.ForgotPasswordPage })),
)
const ResetPasswordPage = lazy(() =>
  import('../pages/AuthActionPages').then((module) => ({ default: module.ResetPasswordPage })),
)
const VerifyEmailPage = lazy(() =>
  import('../pages/AuthActionPages').then((module) => ({ default: module.VerifyEmailPage })),
)
const ChangePasswordPage = lazy(() =>
  import('../pages/AuthActionPages').then((module) => ({ default: module.ChangePasswordPage })),
)
const DashboardPage = lazy(() =>
  import('../pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)
const DriverPage = lazy(() =>
  import('../pages/DriverPage').then((module) => ({ default: module.DriverPage })),
)
const DriversPage = lazy(() =>
  import('../pages/DriversPage').then((module) => ({ default: module.DriversPage })),
)
const VehiclesPage = lazy(() =>
  import('../pages/VehiclesPage').then((module) => ({ default: module.VehiclesPage })),
)
const MapPage = lazy(() =>
  import('../pages/MapPage').then((module) => ({ default: module.MapPage })),
)
const ShipmentsPage = lazy(() =>
  import('../pages/ShipmentsPage').then((module) => ({ default: module.ShipmentsPage })),
)
const NotFoundPage = lazy(() =>
  import('../pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
)
const PublicTrackingPage = lazy(() =>
  import('../pages/PublicTrackingPage').then((module) => ({ default: module.PublicTrackingPage })),
)
const StyleguidePage = lazy(() =>
  import('../pages/StyleguidePage').then((module) => ({ default: module.StyleguidePage })),
)
const AlertsPage = lazy(() =>
  import('../features/alerts/components/AlertsPage').then((module) => ({
    default: module.AlertsPage,
  })),
)
const AdminEmailPage = lazy(() =>
  import('../features/admin-email/components/AdminEmailPage').then((module) => ({
    default: module.AdminEmailPage,
  })),
)
const NotificationPreferencesPage = lazy(() =>
  import('../features/notifications/components/NotificationPreferencesPage').then((module) => ({
    default: module.NotificationPreferencesPage,
  })),
)
const SecurityEventsPage = lazy(() =>
  import('../features/security/components/SecurityEventsPage').then((module) => ({
    default: module.SecurityEventsPage,
  })),
)
const DispatchBoard = lazy(() =>
  import('../features/shipments/components/DispatchBoard').then((module) => ({
    default: module.DispatchBoard,
  })),
)

function RouteFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner label="Loading page" />
    </div>
  )
}

export function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate replace to="/app/dashboard" />} />
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Route>
        <Route
          element={
            <RequireAuth>
              <AuthLayout />
            </RequireAuth>
          }
        >
          <Route path="/account/password" element={<ChangePasswordPage />} />
        </Route>
        <Route
          element={
            <RequireAuth>
              <RequireRole roles={['ADMIN', 'DISPATCHER']}>
                <AppShell />
              </RequireRole>
            </RequireAuth>
          }
        >
          <Route path="/app/dashboard" element={<DashboardPage />} />
          <Route path="/app/alerts" element={<AlertsPage />} />
          <Route
            path="/app/admin/email"
            element={
              <RequireRole roles={['ADMIN']}>
                <AdminEmailPage />
              </RequireRole>
            }
          />
          <Route
            path="/app/admin/security"
            element={
              <RequireRole roles={['ADMIN']}>
                <SecurityEventsPage />
              </RequireRole>
            }
          />
          <Route path="/app/dispatch" element={<DispatchBoard />} />
          <Route path="/app/drivers" element={<DriversPage />} />
          <Route path="/app/vehicles" element={<VehiclesPage />} />
          {import.meta.env.DEV && <Route path="/__styleguide" element={<StyleguidePage />} />}
        </Route>
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/app/shipments" element={<ShipmentsPage />} />
          <Route path="/account/notifications" element={<NotificationPreferencesPage />} />
        </Route>
        <Route
          element={
            <RequireAuth>
              <RequireRole roles={['ADMIN', 'DISPATCHER']}>
                <MapLayout />
              </RequireRole>
            </RequireAuth>
          }
        >
          <Route path="/map" element={<MapPage />} />
        </Route>
        <Route
          element={
            <RequireAuth>
              <RequireRole roles={['DRIVER']}>
                <DriverLayout />
              </RequireRole>
            </RequireAuth>
          }
        >
          <Route path="/driver" element={<DriverPage />} />
          <Route path="/driver/shipments" element={<ShipmentsPage />} />
          <Route path="/driver/profile" element={<DriverPage />} />
        </Route>
        <Route element={<PublicLayout />}>
          <Route path="/track/:trackingCode" element={<PublicTrackingPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
