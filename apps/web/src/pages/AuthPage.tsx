import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema } from '@routecommand/shared'
import type { LoginInput } from '@routecommand/shared'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import type { SubmitHandler } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { FormField } from '../components/ui/FormField'
import { Input } from '../components/ui/Input'
import { PasswordInput } from '../components/ui/PasswordInput'
import { useAuth } from '../features/auth/auth-context'

function destination(role: string): string {
  return role === 'DRIVER' ? '/driver' : role === 'CUSTOMER' ? '/app/dashboard' : '/map'
}

export function AuthPage() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  useEffect(() => {
    if (user) navigate(location.state?.from ?? destination(user.role), { replace: true })
  }, [location.state?.from, navigate, user])

  const submit: SubmitHandler<LoginInput> = async (input) => {
    try {
      const user = await login(input)
      navigate(location.state?.from ?? destination(user.role), { replace: true })
    } catch (error) {
      setError('root', {
        message: error instanceof Error ? error.message : 'Sign in failed. Please try again.',
      })
    }
  }

  return (
    <section className="w-full max-w-md rounded-box border border-base-content/10 bg-base-100 p-6 shadow-lg sm:p-8">
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Welcome back</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in to your account</h2>
        <p className="mt-2 text-sm text-base-content/60">
          Use your operations credentials to continue.
        </p>
      </div>
      <form className="space-y-5" onSubmit={handleSubmit(submit)} noValidate>
        <FormField
          label="Email address"
          htmlFor="email"
          required
          {...(errors.email?.message ? { error: errors.email.message } : {})}
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </FormField>
        <FormField
          label="Password"
          htmlFor="password"
          required
          {...(errors.password?.message ? { error: errors.password.message } : {})}
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </FormField>
        {errors.root?.message && (
          <p role="alert" className="text-sm text-error">
            {errors.root.message}
          </p>
        )}
        <div className="flex justify-end text-xs">
          <Link className="font-medium text-primary hover:underline" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <div className="mt-6 flex items-start gap-2 rounded-field bg-base-200 p-3 text-xs text-base-content/60">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <p>Access is monitored and protected. Never share your operations credentials.</p>
      </div>
      <p className="mt-5 text-center text-sm text-base-content/70">
        New customer?{' '}
        <Link className="font-medium text-primary hover:underline" to="/register">
          Create an account
        </Link>
      </p>
    </section>
  )
}
