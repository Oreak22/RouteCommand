import {
  createManagedUserSchema,
  listManagedUsersQuerySchema,
  managedUserIdParamsSchema,
  updateManagedUserSchema,
} from '@routecommand/shared'
import { Router } from 'express'

import { create, deactivate, detail, list, resetPassword, update } from './controller.js'
import { validate } from '../../middleware/validate.js'
import { authenticate, authorize } from '../auth/authenticate.js'

export const usersRouter = Router()
usersRouter.use(authenticate, authorize('ADMIN'))
usersRouter.get('/', validate('query', listManagedUsersQuerySchema), list)
usersRouter.post('/', validate('body', createManagedUserSchema), create)
usersRouter.get('/:userId', validate('params', managedUserIdParamsSchema), detail)
usersRouter.patch(
  '/:userId',
  validate('params', managedUserIdParamsSchema),
  validate('body', updateManagedUserSchema),
  update,
)
usersRouter.delete('/:userId', validate('params', managedUserIdParamsSchema), deactivate)
usersRouter.post(
  '/:userId/force-password-reset',
  validate('params', managedUserIdParamsSchema),
  resetPassword,
)
