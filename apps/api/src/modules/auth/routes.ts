import {
  actionTokenSchema,
  changePasswordSchema,
  emailActionSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { authenticate } from './authenticate.js'
import {
  confirmEmail,
  confirmPasswordReset,
  forgotPassword,
  me,
  refresh,
  register,
  resendEmailVerification,
  signIn,
  signOut,
  signOutAll,
  updatePassword,
} from './controller.js'
import { createAuthRateLimiter } from '../../middleware/security.js'
import { validate } from '../../middleware/validate.js'

export function createAuthRouter() {
  const authRouter = Router()
  const authLimiter = createAuthRateLimiter()

  authRouter.post('/register', authLimiter, validate('body', registerSchema), register)
  authRouter.post('/login', authLimiter, validate('body', loginSchema), signIn)
  authRouter.post('/refresh', authLimiter, refresh)
  authRouter.post('/verify-email', authLimiter, validate('body', actionTokenSchema), confirmEmail)
  authRouter.post(
    '/resend-verification',
    authLimiter,
    validate('body', emailActionSchema),
    resendEmailVerification,
  )
  authRouter.post(
    '/forgot-password',
    authLimiter,
    validate('body', emailActionSchema),
    forgotPassword,
  )
  authRouter.post(
    '/reset-password',
    authLimiter,
    validate('body', resetPasswordSchema),
    confirmPasswordReset,
  )
  authRouter.post('/logout', authenticate, signOut)
  authRouter.post('/logout-all', authenticate, signOutAll)
  authRouter.get('/me', authenticate, me)
  authRouter.post(
    '/change-password',
    authenticate,
    validate('body', changePasswordSchema),
    updatePassword,
  )

  return authRouter
}
