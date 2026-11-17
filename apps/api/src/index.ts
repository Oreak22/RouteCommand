import { logger } from './core/logger.js'
import { startServer } from './server.js'

startServer().catch((error: unknown) => {
  logger.fatal({ err: error }, 'API startup failed')
  process.exitCode = 1
})
