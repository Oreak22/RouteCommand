import cookieParser from 'cookie-parser'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import hpp from 'hpp'
import { RedisStore } from 'rate-limit-redis'

import { env } from '../config/env.js'
import { ForbiddenError, RateLimitedError } from '../core/errors/app-error.js'
import { redisClient } from '../infra/redis.js'

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
})

export const corsPolicy = cors({
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) callback(null, true)
    else callback(new ForbiddenError('This origin is not allowed.'))
  },
  credentials: true,
})

export const parseCookies = cookieParser()
export const preventParameterPollution = hpp()

export function createGlobalRateLimiter() {
  if (!redisClient.isReady) {
    throw new Error('Redis must be connected before the API rate limiter is initialized.')
  }

  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: new RedisStore({
      prefix: 'routecommand:rate-limit:',
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    handler: (_request, _response, next) => next(new RateLimitedError()),
  })
}

export function createAuthRateLimiter() {
  if (!redisClient.isReady) {
    throw new Error('Redis must be connected before auth rate limiting is initialized.')
  }

  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: new RedisStore({
      prefix: 'routecommand:auth-rate-limit:',
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    handler: (_request, _response, next) => next(new RateLimitedError()),
  })
}

export function createPublicTrackingRateLimiter() {
  if (!redisClient.isReady) {
    throw new Error('Redis must be connected before public tracking rate limiting is initialized.')
  }

  return rateLimit({
    windowMs: env.PUBLIC_TRACKING_RATE_LIMIT_WINDOW_MS,
    limit: env.PUBLIC_TRACKING_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: new RedisStore({
      prefix: 'routecommand:public-tracking-rate-limit:',
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    handler: (_request, _response, next) => next(new RateLimitedError()),
  })
}
