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
    VALHALLA_URL: z.string().url().default('http://localhost:8002'),
    VALHALLA_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
    NAVIGATION_REROUTE_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(3).max(300).default(8),
    NAVIGATION_PROGRESS_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(3).max(60).default(5),
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
    PUBLIC_TRACKING_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    PUBLIC_TRACKING_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(20),
    PUBLIC_TRACKING_LOCATION_DECIMALS: z.coerce.number().int().min(2).max(4).default(3),
    PUBLIC_TRACKING_LOCATION_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(86_400)
      .default(1_800),
    DRIVER_SIGNAL_STALE_SECONDS: z.coerce.number().int().min(10).max(86_400).default(180),
    DISPATCH_PICKUP_RADIUS_M: z.coerce.number().positive().max(100_000).default(25_000),
    DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),
    DISPATCH_WORKLOAD_PENALTY_M: z.coerce.number().nonnegative().max(100_000).default(3_000),
    DISPATCH_ZONE_MATCH_BONUS_M: z.coerce.number().nonnegative().max(100_000).default(2_000),
    DISPATCH_FRESHNESS_PENALTY_M_PER_MINUTE: z.coerce
      .number()
      .nonnegative()
      .max(10_000)
      .default(100),
    NEW_REQUEST_DRIVER_EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    NEW_REQUEST_DRIVER_RADIUS_M: z.coerce.number().positive().max(100_000).default(25_000),
    NEW_REQUEST_MAX_DRIVERS: z.coerce.number().int().min(1).max(50).default(5),
    SECURITY_BRUTE_FORCE_THRESHOLD: z.coerce.number().int().min(3).max(50).default(3),
    SECURITY_DEDUPE_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    SECURITY_ACTIVITY_WINDOW_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    SECURITY_CUSTOMER_REQUEST_THRESHOLD: z.coerce.number().int().min(3).max(100).default(8),
    SECURITY_CUSTOMER_CANCELLATION_THRESHOLD: z.coerce.number().int().min(3).max(100).default(5),
    SECURITY_CREDENTIAL_CHANGE_THRESHOLD: z.coerce.number().int().min(2).max(20).default(3),
    SECURITY_IMPOSSIBLE_TRAVEL_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .min(15)
      .max(1_440)
      .default(120),
    ALERT_SPEEDING_DURATION_SECONDS: z.coerce.number().int().min(10).max(3_600).default(30),
    ALERT_IDLE_DURATION_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
    ALERT_IDLE_MAX_DRIFT_M: z.coerce.number().positive().max(1_000).default(50),
    ALERT_SHIPMENT_DELAY_GRACE_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
    DROPOFF_SUGGESTION_RADIUS_M: z.coerce.number().positive().max(5_000).default(150),
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
    EMAIL_PROVIDER: z.enum(['smtp', 'console']).default('smtp'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: booleanFromString,
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    SMTP_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(3),
    SMTP_MAX_MESSAGES: z.coerce.number().int().min(1).max(10_000).default(100),
    EMAIL_FROM: z.string().min(3).default('RouteCommand <no-reply@routecommand.local>'),
    EMAIL_RECIPIENT_MAX_PER_HOUR: z.coerce.number().int().min(1).max(1_000).default(20),
    EMAIL_GLOBAL_MAX_PER_HOUR: z.coerce.number().int().min(1).max(100_000).default(5_000),
    EMAIL_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(1_000).default(10),
    GEOIP_DATABASE_PATH: z.string().default(''),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production') {
      if (values.EMAIL_PROVIDER !== 'smtp') {
        context.addIssue({
          code: 'custom',
          path: ['EMAIL_PROVIDER'],
          message: 'Production email delivery must use SMTP.',
        })
      }
      if (values.SMTP_HOST === 'localhost') {
        context.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'Set a reachable SMTP host in production.',
        })
      }
      if (!values.EMAIL_FROM.includes('@')) {
        context.addIssue({
          code: 'custom',
          path: ['EMAIL_FROM'],
          message: 'Set a valid sender address in production.',
        })
      }
      if (Boolean(values.SMTP_USER) !== Boolean(values.SMTP_PASS)) {
        context.addIssue({
          code: 'custom',
          path: ['SMTP_PASS'],
          message: 'SMTP_USER and SMTP_PASS must be configured together.',
        })
      }
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
  normalizedSource.EMAIL_FROM ??= normalizedSource.SMTP_FROM
  normalizedSource.SMTP_PASS ??= normalizedSource.SMTP_PASSWORD
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
