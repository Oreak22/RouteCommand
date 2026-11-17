import { z } from 'zod'

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const developmentAccessSecret = 'routecommand-dev-access-secret-change-before-production'
const developmentRefreshSecret = 'routecommand-dev-refresh-secret-change-before-production'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol))
      .default('postgres://routecommand:routecommand@localhost:5432/routecommand'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol))
      .default('redis://localhost:6379'),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url()).min(1)),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_000_000).default(100_000),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(60_000).default(900_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DRIVER_SIGNAL_STALE_SECONDS: z.coerce.number().int().min(10).max(86_400).default(180),
    PICKUP_PROXIMITY_RADIUS_M: z.coerce.number().positive().max(10_000).default(150),
    PICKUP_PROXIMITY_MODE: z.enum(['SOFT', 'STRICT']).default('SOFT'),
    JWT_ACCESS_SECRET: z.string().min(32).default(developmentAccessSecret),
    JWT_REFRESH_SECRET: z.string().min(32).default(developmentRefreshSecret),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(600).max(31_536_000).default(2_592_000),
    MAX_ACCURACY_M: z.coerce.number().positive().max(5_000).default(100),
    TELEMETRY_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(72),
    TELEMETRY_FUTURE_SKEW_SECONDS: z.coerce.number().int().min(0).max(3_600).default(120),
    TELEMETRY_RATE_LIMIT_PER_SECOND: z.coerce.number().int().min(1).max(10_000).default(500),
    TELEMETRY_FLUSH_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    TELEMETRY_DB_POSITION_THROTTLE_SECONDS: z.coerce.number().int().min(1).max(300).default(10),
    TELEMETRY_MAX_SPEED_BIKE_MPS: z.coerce.number().positive().max(200).default(30),
    TELEMETRY_MAX_SPEED_CAR_MPS: z.coerce.number().positive().max(200).default(75),
    TELEMETRY_MAX_SPEED_VAN_MPS: z.coerce.number().positive().max(200).default(55),
    TELEMETRY_MAX_SPEED_TRUCK_MPS: z.coerce.number().positive().max(200).default(45),
    TILE_PROVIDER_URL: z
      .string()
      .url()
      .default(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ),
    TILE_PROVIDER_ATTRIBUTION: z.string().min(1).default('Tiles © Esri'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: booleanFromString,
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().min(3).default('RouteCommand <no-reply@routecommand.local>'),
    GEOIP_DATABASE_PATH: z.string().default(''),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production') {
      if (values.JWT_ACCESS_SECRET === developmentAccessSecret) {
        context.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message: 'Set a unique production JWT access secret.',
        })
      }

      if (values.JWT_REFRESH_SECRET === developmentRefreshSecret) {
        context.addIssue({
          code: 'custom',
          path: ['JWT_REFRESH_SECRET'],
          message: 'Set a unique production JWT refresh secret.',
        })
      }
    }
  })

export type AppEnvironment = z.infer<typeof envSchema>

export class InvalidEnvironmentConfigurationError extends Error {
  constructor(readonly issues: ReturnType<typeof z.treeifyError>) {
    super('Invalid API environment configuration.')
    this.name = 'InvalidEnvironmentConfigurationError'
  }
}

export function parseEnvironment(source: NodeJS.ProcessEnv): AppEnvironment {
  const normalizedSource = { ...source }
  if (!normalizedSource.CORS_ORIGINS && normalizedSource.WEB_ORIGIN) {
    normalizedSource.CORS_ORIGINS = normalizedSource.WEB_ORIGIN
  }
  const parsed = envSchema.safeParse(normalizedSource)

  if (!parsed.success) {
    throw new InvalidEnvironmentConfigurationError(z.treeifyError(parsed.error))
  }

  return parsed.data
}

let environment: AppEnvironment

try {
  environment = parseEnvironment(process.env)
} catch (error) {
  console.error(
    'Invalid API environment configuration:',
    error instanceof InvalidEnvironmentConfigurationError
      ? error.issues
      : 'Unknown configuration error',
  )
  process.exit(1)
}

export const env = environment
