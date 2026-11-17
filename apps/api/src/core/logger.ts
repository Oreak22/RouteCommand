import pino from 'pino'

import { env } from '../config/env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-api-key',
      'res.headers.set-cookie',
      '*.password',
      '*.token',
      '*.secret',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (request) => ({
      method: request.method,
      url: request.url?.split('?')[0],
      id: request.id,
    }),
    res: (response) => ({ statusCode: response.statusCode }),
  },
})
