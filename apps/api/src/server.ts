import type { Server } from 'node:http'

import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './core/logger.js'
import { closeDatabasePool } from './db/pool.js'
import { closeEmailInfrastructure, startEmailInfrastructure } from './infra/email-queue.js'
import { closeRedisClients, connectRedisClients } from './infra/redis.js'
import { startDispatchTimeoutWorker } from './modules/dispatch/worker.js'
import { startGeofenceWorker } from './modules/geofence/worker.js'
import { startNotificationEventHandlers } from './modules/notifications/worker.js'
import { startRealtimeGateway } from './modules/realtime/gateway.js'
import { startSecurityEventEmailHandler } from './modules/security/email-handler.js'
import { startSecuritySignalWorker } from './modules/security/worker.js'
import { startTelemetryWorker } from './modules/telemetry/worker.js'

let server: Server | undefined
let shuttingDown: Promise<void> | undefined
let stopTelemetryWorker: (() => Promise<void>) | undefined
let stopRealtimeGateway: (() => Promise<void>) | undefined
let stopGeofenceWorker: (() => void) | undefined
let stopDispatchTimeoutWorker: (() => void) | undefined
let stopNotificationEventHandlers: (() => void) | undefined
let stopSecuritySignalWorker: (() => void) | undefined
let stopSecurityEmailHandler: (() => void) | undefined

async function closeDependencies(): Promise<void> {
  await stopRealtimeGateway?.()
  stopRealtimeGateway = undefined
  await stopTelemetryWorker?.()
  stopTelemetryWorker = undefined
  stopGeofenceWorker?.()
  stopGeofenceWorker = undefined
  stopDispatchTimeoutWorker?.()
  stopDispatchTimeoutWorker = undefined
  stopNotificationEventHandlers?.()
  stopNotificationEventHandlers = undefined
  stopSecuritySignalWorker?.()
  stopSecuritySignalWorker = undefined
  stopSecurityEmailHandler?.()
  stopSecurityEmailHandler = undefined
  await closeEmailInfrastructure()
  await Promise.allSettled([closeDatabasePool(), closeRedisClients()])
}

export async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return shuttingDown
  shuttingDown = (async () => {
    logger.info({ signal }, 'Graceful shutdown started')
    const timeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit')
      server?.closeAllConnections()
      process.exit(1)
    }, 10_000)
    timeout.unref()

    try {
      await stopRealtimeGateway?.()
      stopRealtimeGateway = undefined
      if (server) {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server?.close((error) => (error ? reject(error) : resolve()))
            server?.closeIdleConnections()
          })
        }
      }
      await closeDependencies()
    } catch (error) {
      logger.error({ err: error }, 'Error during graceful shutdown')
      exitCode = 1
    } finally {
      clearTimeout(timeout)
      process.exitCode = exitCode
    }
  })()
  return shuttingDown
}

export async function startServer(): Promise<Server> {
  try {
    await connectRedisClients()
    await startEmailInfrastructure()
    stopNotificationEventHandlers = startNotificationEventHandlers()
    stopSecuritySignalWorker = startSecuritySignalWorker()
    stopSecurityEmailHandler = startSecurityEventEmailHandler()
    stopTelemetryWorker = await startTelemetryWorker()
    stopGeofenceWorker = await startGeofenceWorker()
    stopDispatchTimeoutWorker = await startDispatchTimeoutWorker()
  } catch (error) {
    await closeDependencies()
    throw error
  }
  const app = createApp()
  server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(env.PORT, '0.0.0.0', () => resolve(instance))
    instance.once('error', reject)
  })
  try {
    stopRealtimeGateway = await startRealtimeGateway(server)
  } catch (error) {
    if (server.listening) server.close()
    await closeDependencies()
    throw error
  }

  logger.info({ port: env.PORT }, 'RouteCommand API listening')
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception')
    void shutdown('uncaughtException', 1)
  })
  process.once('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled rejection')
    void shutdown('unhandledRejection', 1)
  })
  return server
}
