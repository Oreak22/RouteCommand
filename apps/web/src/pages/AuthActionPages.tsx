import { zodResolver } from '@hookform/resolvers/zod'
import {
  changePasswordSchema,
  emailActionSchema,
  registerSchema,
  resetPasswordSchema,
} from '@routecommand/shared'
import type { ChangePasswordInput, RegisterInput } from '@routecommand/shared'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { SubmitHandler } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { FormField } from '../components/ui/FormField'
import { Input } from '../components/ui/Input'
import { PasswordInput } from '../components/ui/PasswordInput'
import { authenticatedFetch, submitAuthAction } from '../features/auth/auth-client'
import { useAuth } from '../features/auth/auth-context'

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="w-full max-w-md rounded-box border border-base-content/10 bg-base-100 p-6 shadow-lg sm:p-8">
      <h2 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function roleHome(role: string): string {
  return role === 'DRIVER' ? '/driver' : role === 'CUSTOMER' ? '/track/RC-4826-91' : '/map'
}

export function RegisterPage() {
  const { register: createAccount } = useAuth()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) })
  const submit: SubmitHandler<RegisterInput> = async (input) => {
    try {
      const user = await createAccount(input)
      navigate(roleHome(user.role), { replace: true })
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Account creation failed.',
      })
    }
  }

  return (
    <ActionCard title="Create a customer account">
      <form className="space-y-4" onSubmit={handleSubmit(submit)} noValidate>
        <FormField
          label="Full name"
          htmlFor="name"
          required
          {...(errors.name?.message ? { error: errors.name.message } : {})}
        >
          <Input id="name" autoComplete="name" {...register('name')} />
        </FormField>
        <FormField
          label="Email address"
          htmlFor="email"
          required
          {...(errors.email?.message ? { error: errors.email.message } : {})}
        >
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField
          label="Phone (optional)"
          htmlFor="phone"
          {...(errors.phone?.message ? { error: errors.phone.message } : {})}
        >
          <Input id="phone" type="tel" autoComplete="tel" {...register('phone')} />
        </FormField>
        <FormField
          label="Password"
          htmlFor="password"
          required
          {...(errors.password?.message ? { error: errors.password.message } : {})}
        >
          <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        {errors.root?.message && (
          <p role="alert" className="text-sm text-error">
            {errors.root.message}
          </p>
        )}
        <Button className="w-full" type="submit" loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-sm text-base-content/70">
        Already registered?{' '}
        <Link to="/login" className="text-primary">
          Sign in
        </Link>
      </p>
    </ActionCard>
  )
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm({ resolver: zodResolver(emailActionSchema) })
  const submit = async (input: { email: string }) => {
    setError('')
    try {
      const result = await submitAuthAction<{ data: { message: string } }>('forgot-password', input)
      setMessage(result.data.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit this request.')
    }
  }
  return (
    <ActionCard title="Reset your password">
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit(submit)} noValidate>
          <p className="text-sm text-base-content/70">
            Enter the email address for your account. If it exists, we’ll send reset instructions.
          </p>
          <FormField
            label="Email address"
            htmlFor="email"
            required
            {...(errors.email?.message ? { error: String(errors.email.message) } : {})}
          >
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" loading={isSubmitting}>
            Send instructions
          </Button>
        </form>
      )}
      <Link className="mt-5 inline-block text-sm text-primary" to="/login">
        Return to sign in
      </Link>
    </ActionCard>
  )
}

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm({ resolver: zodResolver(resetPasswordSchema) })
  const submit = async (input: { password: string; token: string }) => {
    setError('')
    try {
      await submitAuthAction<Record<string, never>>('reset-password', input)
      setMessage('Your password has been changed. Sign in with the new password.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reset link is invalid or expired.')
    }
  }
  return (
    <ActionCard title="Choose a new password">
      {message ? (
        <p role="status" className="text-sm">
          {message}{' '}
          <Link to="/login" className="text-primary">
            Sign in
          </Link>
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={handleSubmit((input) => submit({ ...input, token }))}
          noValidate
        >
          {!token && (
            <p role="alert" className="text-sm text-error">
              The reset link is missing or invalid.
            </p>
          )}
          <FormField
            label="New password"
            htmlFor="password"
            required
            {...(errors.password?.message ? { error: String(errors.password.message) } : {})}
          >
            <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" loading={isSubmitting} disabled={!token}>
            Change password
          </Button>
        </form>
      )}
    </ActionCard>
  )
}

export function VerifyEmailPage() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
  const [status, setStatus] = useState(
    token ? 'Verifying your email address…' : 'This verification link is missing or invalid.',
  )
  useEffect(() => {
    if (!token) return
    submitAuthAction('verify-email', { token })
      .then(() => setStatus('Your email address is verified.'))
      .catch((error: unknown) =>
        setStatus(error instanceof Error ? error.message : 'Verification failed.'),
      )
  }, [token])
  return (
    <ActionCard title="Email verification">
      <p role="status" className="text-sm">
        {status}
      </p>
      <Link className="mt-5 inline-block text-sm text-primary" to="/login">
        Continue to sign in
      </Link>
    </ActionCard>
  )
}

export function ChangePasswordPage() {
  const { logout } = useAuth()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) })

  const submit: SubmitHandler<ChangePasswordInput> = async (input) => {
    setError('')
    try {
      const response = await authenticatedFetch('/api/v1/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'RouteCommand' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? 'Password change failed.')
      }
      setMessage('Password changed. Sign in with your new password.')
      await logout()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password change failed.')
    }
  }

  return (
    <ActionCard title="Change your password">
      {message ? (
        <p role="status" className="text-sm">
          {message}{' '}
          <Link to="/login" className="text-primary">
            Sign in
          </Link>
        </p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit(submit)} noValidate>
          <FormField
            label="Current password"
            htmlFor="currentPassword"
            required
            {...(errors.currentPassword?.message ? { error: errors.currentPassword.message } : {})}
          >
            <PasswordInput
              id="currentPassword"
              autoComplete="current-password"
              {...register('currentPassword')}
            />
          </FormField>
          <FormField
            label="New password"
            htmlFor="newPassword"
            required
            {...(errors.newPassword?.message ? { error: errors.newPassword.message } : {})}
          >
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              {...register('newPassword')}
            />
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </ActionCard>
  )
}
