import { createClient } from 'redis'

import { env } from '../config/env.js'
import { logger } from '../core/logger.js'

const reconnectStrategy = (retries: number): number | Error =>
  retries > 10 ? new Error('Redis reconnect limit reached.') : Math.min(retries * 250, 3_000)

function createRedisClient(name: string) {
  const client = createClient({ url: env.REDIS_URL, socket: { reconnectStrategy } })
  client.on('error', (error) => logger.error({ err: error, client: name }, 'Redis client error'))
  return client
}

export const redisClient = createRedisClient('command')
export const redisPublisher = redisClient.duplicate()
export const redisSubscriber = redisClient.duplicate()

export async function connectRedisClients(): Promise<void> {
  await Promise.all([redisClient.connect(), redisPublisher.connect(), redisSubscriber.connect()])
}

export async function checkRedisHealth(): Promise<void> {
  if (!redisClient.isReady) throw new Error('Redis is not ready.')
  await redisClient.ping()
}

export async function closeRedisClients(): Promise<void> {
  await Promise.all(
    [redisSubscriber, redisPublisher, redisClient].map(async (client) => {
      if (client.isOpen) await client.quit()
    }),
  )
}
