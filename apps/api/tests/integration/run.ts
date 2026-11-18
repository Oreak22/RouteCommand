import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type {
  ClientToServerEvents,
  DriverPositionEvent,
  OpsSnapshotEvent,
  ServerToClientEvents,
  TelemetryAck,
} from '@routecommand/shared'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { io as socketIo } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { GenericContainer, Wait } from 'testcontainers'

import { ForbiddenError, NotFoundError } from '../../src/core/errors/app-error.js'

let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>> | undefined
let redis: Awaited<ReturnType<RedisContainer['start']>> | undefined
let mailpit: Awaited<ReturnType<GenericContainer['start']>> | undefined
let server: import('node:http').Server | undefined
let stopTelemetryWorker: (() => Promise<void>) | undefined
let stopRealtimeGateway: (() => Promise<void>) | undefined
let stopGeofenceWorker: (() => void) | undefined
let stopNotificationHandlers: (() => void) | undefined
let stopSecuritySignalWorker: (() => void) | undefined
let stopSecurityEmailHandler: (() => void) | undefined
type IntegrationSocket = Socket<ServerToClientEvents, ClientToServerEvents>
const realtimeSockets: IntegrationSocket[] = []
try {
  const externalDatabaseUrl = process.env.TEST_DATABASE_URL
  const externalRedisUrl = process.env.TEST_REDIS_URL
  const externalSmtpHost = process.env.TEST_SMTP_HOST
  const externalSmtpPort = process.env.TEST_SMTP_PORT
  const externalTestServices = Boolean(
    externalDatabaseUrl || externalRedisUrl || externalSmtpHost || externalSmtpPort,
  )
  if (externalTestServices) {
    if (
      !externalDatabaseUrl ||
      !externalRedisUrl ||
      !externalSmtpHost ||
      !externalSmtpPort ||
      process.env.INTEGRATION_ALLOW_RESET !== 'true'
    ) {
      throw new Error(
        'External integration services require TEST_DATABASE_URL, TEST_REDIS_URL, TEST_SMTP_HOST, TEST_SMTP_PORT, and INTEGRATION_ALLOW_RESET=true.',
      )
    }
    const databaseName = new URL(externalDatabaseUrl).pathname.slice(1)
    if (!/(?:_test|_check)$/.test(databaseName)) {
      throw new Error(
        'TEST_DATABASE_URL must point to a disposable database ending in _test or _check.',
      )
    }
    if (new URL(externalRedisUrl).pathname !== '/15') {
      throw new Error('TEST_REDIS_URL must use Redis database 15 because the harness clears it.')
    }
  } else {
    postgres = await new PostgreSqlContainer('postgis/postgis:16-3.4')
      .withDatabase('routecommand_test')
      .withUsername('routecommand')
      .withPassword('routecommand_test')
      .start()
    redis = await new RedisContainer('redis:7.4-alpine').start()
    mailpit = await new GenericContainer('axllent/mailpit:v1.27')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forListeningPorts())
      .start()
  }

  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'error'
  process.env.RATE_LIMIT_MAX = '1000'
  process.env.AUTH_RATE_LIMIT_MAX = '100'
  process.env.TELEMETRY_RATE_LIMIT_PER_SECOND = '10000'
  process.env.DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS = '30'
  process.env.SECURITY_CUSTOMER_REQUEST_THRESHOLD = '3'
  process.env.SECURITY_CUSTOMER_CANCELLATION_THRESHOLD = '3'
  process.env.DATABASE_URL = externalDatabaseUrl ?? postgres!.getConnectionUri()
  process.env.REDIS_URL = externalRedisUrl ?? redis!.getConnectionUrl()
  process.env.SMTP_HOST = externalSmtpHost ?? mailpit!.getHost()
  process.env.SMTP_PORT = externalSmtpPort ?? String(mailpit!.getMappedPort(1025))
  process.env.SMTP_SECURE = 'false'

  const { runner } = await import('node-pg-migrate')
  const { fileURLToPath } = await import('node:url')
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: fileURLToPath(new URL('../../db/migrations/', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
  })

  const [{ createApp }, redisModule, databaseModule] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/infra/redis.js'),
    import('../../src/db/pool.js'),
  ])

  await redisModule.connectRedisClients()
  if (externalTestServices) await redisModule.redisClient.flushDb()
  const emailModule = await import('../../src/infra/email-queue.js')
  await emailModule.startEmailInfrastructure()
  const telemetryWorkerModule = await import('../../src/modules/telemetry/worker.js')
  stopTelemetryWorker = await telemetryWorkerModule.startTelemetryWorker()
  const geofenceWorkerModule = await import('../../src/modules/geofence/worker.js')
  stopGeofenceWorker = await geofenceWorkerModule.startGeofenceWorker()
  await Promise.all([databaseModule.checkDatabaseHealth(), redisModule.checkRedisHealth()])
  const { resetDatabase } = await import('./helpers.js')
  await resetDatabase(databaseModule.pool)
  const sridCheck = await databaseModule.pool.query<{ available: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM spatial_ref_sys WHERE srid = 4326) AS available',
  )
  assert.equal(
    sridCheck.rows[0]?.available,
    true,
    'integration reset must preserve PostGIS SRID data',
  )
  const notificationWorkerModule = await import('../../src/modules/notifications/worker.js')
  const securityWorkerModule = await import('../../src/modules/security/worker.js')
  const securityEmailModule = await import('../../src/modules/security/email-handler.js')
  stopNotificationHandlers = notificationWorkerModule.startNotificationEventHandlers()
  stopSecuritySignalWorker = securityWorkerModule.startSecuritySignalWorker()
  stopSecurityEmailHandler = securityEmailModule.startSecurityEventEmailHandler()
  const app = createApp()
  const runningServer = await new Promise<import('node:http').Server>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    instance.once('error', reject)
  })
  server = runningServer
  const realtimeModule = await import('../../src/modules/realtime/gateway.js')
  stopRealtimeGateway = await realtimeModule.startRealtimeGateway(runningServer)
  const address = runningServer.address()
  assert(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const createRealtimeSocket = (token?: string): IntegrationSocket => {
    const socket = socketIo(baseUrl, {
      autoConnect: false,
      auth: token ? { accessToken: token } : {},
      reconnection: false,
      timeout: 5_000,
      transports: ['websocket'],
    })
    realtimeSockets.push(socket)
    return socket
  }
  const waitForSocketConnect = (socket: IntegrationSocket): Promise<void> =>
    new Promise((resolve, reject) => {
      if (socket.connected) return resolve()
      const timeout = setTimeout(() => {
        socket.off('connect', onConnect)
        socket.off('connect_error', onConnectError)
        reject(new Error('Socket connection timed out.'))
      }, 5_000)
      const onConnect = () => {
        clearTimeout(timeout)
        socket.off('connect_error', onConnectError)
        resolve()
      }
      const onConnectError = (error: Error) => {
        clearTimeout(timeout)
        socket.off('connect', onConnect)
        reject(error)
      }
      socket.once('connect', onConnect)
      socket.once('connect_error', onConnectError)
      socket.connect()
    })
  const waitForOpsSnapshot = (socket: IntegrationSocket): Promise<OpsSnapshotEvent> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('ops:snapshot', onSnapshot)
        reject(new Error('Operations snapshot was not received.'))
      }, 5_000)
      const onSnapshot = (snapshot: OpsSnapshotEvent) => {
        clearTimeout(timeout)
        resolve(snapshot)
      }
      socket.once('ops:snapshot', onSnapshot)
    })
  const waitForDriverPosition = (
    socket: IntegrationSocket,
    driverId: string,
  ): Promise<DriverPositionEvent> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('driver:position', onPosition)
        reject(new Error(`No live position event received for driver ${driverId}.`))
      }, 5_000)
      const onPosition = (position: DriverPositionEvent) => {
        if (position.driverId !== driverId) return
        clearTimeout(timeout)
        resolve(position)
      }
      socket.on('driver:position', onPosition)
    })
  const waitForAlertCreated = (
    socket: IntegrationSocket,
    type: string,
  ): Promise<{ alertId: string; type: string; severity: string }> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('alert:created', onAlert)
        reject(new Error(`Realtime ${type} alert was not received.`))
      }, 5_000)
      const onAlert = (event: { alertId: string; type: string; severity: string }) => {
        if (event.type !== type) return
        clearTimeout(timeout)
        socket.off('alert:created', onAlert)
        resolve(event)
      }
      socket.on('alert:created', onAlert)
    })
  const waitForShipmentSuggestion = (
    socket: IntegrationSocket,
    shipmentId: string,
    suggestedStatus: 'PICKED_UP' | 'ARRIVED',
  ): Promise<{ shipmentId: string; suggestedStatus: 'PICKED_UP' | 'ARRIVED'; reason: string }> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('shipment:suggestion', onSuggestion)
        reject(new Error(`Realtime ${suggestedStatus} suggestion was not received.`))
      }, 5_000)
      const onSuggestion = (event: {
        shipmentId: string
        suggestedStatus: 'PICKED_UP' | 'ARRIVED'
        reason: string
      }) => {
        if (event.shipmentId !== shipmentId || event.suggestedStatus !== suggestedStatus) return
        clearTimeout(timeout)
        socket.off('shipment:suggestion', onSuggestion)
        resolve(event)
      }
      socket.on('shipment:suggestion', onSuggestion)
    })
  const loginAs = async (email: string, password: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    assert.equal(response.status, 200, `login should succeed for ${email}`)
    return ((await response.json()) as { data: { accessToken: string } }).data.accessToken
  }

  const [live, ready, openApi, swaggerUi] = await Promise.all([
    fetch(`${baseUrl}/health/live`),
    fetch(`${baseUrl}/health/ready`),
    fetch(`${baseUrl}/openapi.json`),
    fetch(`${baseUrl}/docs/`),
  ])
  assert.equal(live.status, 200)
  assert.equal(ready.status, 200)
  assert.equal(openApi.status, 200)
  const openApiDocument = (await openApi.json()) as {
    info: { title: string }
    paths: Record<string, unknown>
  }
  assert.equal(openApiDocument.info.title, 'RouteCommand API')
  for (const path of [
    '/api/v1/drivers',
    '/api/v1/drivers/nearby',
    '/api/v1/telemetry/batch',
    '/api/v1/telemetry/drivers/{driverId}/track',
    '/api/v1/telemetry/drivers/{driverId}/points',
    '/metrics',
    '/api/v1/drivers/me/status',
    '/api/v1/vehicles',
    '/api/v1/zones',
    '/api/v1/zones/geojson',
    '/api/v1/zones/check-point',
    '/api/v1/shipments',
    '/api/v1/shipments/{shipmentId}',
    '/api/v1/shipments/{shipmentId}/transition',
    '/api/v1/shipments/{shipmentId}/events',
    '/api/v1/alerts',
    '/api/v1/alerts/stats',
    '/api/v1/alerts/{alertId}/acknowledge',
    '/api/v1/alerts/{alertId}/resolve',
  ])
    assert(path in openApiDocument.paths, `OpenAPI should document ${path}`)
  assert.equal(swaggerUi.status, 200)
  assert.match(await swaggerUi.text(), /swagger-ui/)

  const suffix = randomUUID()
  const credentials = {
    email: `phase4-${suffix}@routecommand.test`,
    password: 'phase-four-test-password',
    name: 'Phase Four Integration',
  }
  const registered = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  assert.equal(registered.status, 201)
  const registerBody = (await registered.json()) as { data: { accessToken: string } }
  const setCookie = registered.headers.get('set-cookie')
  const cookie = setCookie?.match(/routecommand_refresh=([^;]+)/)?.[1]
  assert(registerBody.data.accessToken)
  assert(cookie)
  assert.match(setCookie ?? '', /HttpOnly/i)
  assert.match(setCookie ?? '', /Secure/i)
  assert.match(setCookie ?? '', /SameSite=Strict/i)
  assert.match(setCookie ?? '', /Path=\/api\/v1\/auth/i)

  const currentUser = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${registerBody.data.accessToken}` },
  })
  assert.equal(currentUser.status, 200)
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/users`, {
        headers: { authorization: `Bearer ${registerBody.data.accessToken}` },
      })
    ).status,
    403,
    'customer role must not access administrator user management',
  )
  assert.equal((await fetch(`${baseUrl}/api/v1/users`)).status, 401)
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { cookie: `routecommand_refresh=${cookie}` },
      })
    ).status,
    403,
    'refresh must reject requests without the CSRF header',
  )
  for (const [method, path, body] of [
    ['GET', '/api/v1/auth/me', undefined],
    ['POST', '/api/v1/auth/logout', undefined],
    ['POST', '/api/v1/auth/logout-all', undefined],
    ['POST', '/api/v1/auth/change-password', undefined],
  ] as const) {
    const denied = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert.equal(denied.status, 401, `${method} ${path} must require authentication`)
  }

  let mailStatus: string | undefined
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{ status: string }>(
      `SELECT status FROM email_logs WHERE recipient_email = $1 ORDER BY queued_at DESC LIMIT 1`,
      [credentials.email],
    )
    mailStatus = result.rows[0]?.status
    if (mailStatus === 'SENT' || mailStatus === 'FAILED') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(mailStatus, 'SENT', 'registration verification email should be delivered to Mailpit')

  const refreshed = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `routecommand_refresh=${cookie}`, 'x-requested-with': 'RouteCommand' },
  })
  assert.equal(refreshed.status, 200)
  const refreshBody = (await refreshed.json()) as { data: { accessToken: string } }
  assert(refreshBody.data.accessToken)

  const replayed = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `routecommand_refresh=${cookie}`, 'x-requested-with': 'RouteCommand' },
  })
  assert.equal(replayed.status, 401, 'reuse of a rotated refresh token must be rejected')
  const revokedSession = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${refreshBody.data.accessToken}` },
  })
  assert.equal(revokedSession.status, 401, 'refresh reuse must revoke the complete token family')

  const loggedIn = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  assert.equal(loggedIn.status, 200)
  const loginBody = (await loggedIn.json()) as { data: { accessToken: string } }
  const loggedOut = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${loginBody.data.accessToken}`,
      'x-requested-with': 'RouteCommand',
    },
  })
  assert.equal(loggedOut.status, 204)
  const revokedAccess = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${loginBody.data.accessToken}` },
  })
  assert.equal(revokedAccess.status, 401)

  const forgotKnown = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: credentials.email }),
  })
  const forgotUnknown = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `missing-${suffix}@routecommand.test` }),
  })
  assert.equal(forgotKnown.status, 202)
  assert.equal(forgotUnknown.status, 202)
  assert.deepEqual(await forgotKnown.json(), await forgotUnknown.json())

  const passwordHash = await (
    await import('../../src/modules/auth/service.js')
  ).hashPassword('admin-phase4-integration-password')
  await databaseModule.pool.query(
    `INSERT INTO users (email, name, role, password_hash, email_verified_at)
     VALUES ($1, 'Phase 4 Dispatcher', 'DISPATCHER', $2, now())`,
    [`dispatcher-${suffix}@routecommand.test`, passwordHash],
  )
  const adminInsert = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, email_verified_at)
     VALUES ($1, 'Phase 4 Admin', 'ADMIN', $2, now()) RETURNING id`,
    [`admin-${suffix}@routecommand.test`, passwordHash],
  )
  const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `admin-${suffix}@routecommand.test`,
      password: 'admin-phase4-integration-password',
    }),
  })
  assert.equal(adminLogin.status, 200)
  const adminSession = (await adminLogin.json()) as { data: { accessToken: string } }
  const managedDriver = await fetch(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminSession.data.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: `driver-${suffix}@routecommand.test`,
      name: 'Managed Driver',
      password: 'driver-phase4-integration-password',
      role: 'DRIVER',
      licenseNo: `LIC-${suffix}`,
    }),
  })
  assert.equal(managedDriver.status, 201)
  const managedDriverBody = (await managedDriver.json()) as { data: { id: string; role: string } }
  assert.equal(managedDriverBody.data.role, 'DRIVER')
  const driverProfile = await databaseModule.pool.query<{ id: string; count: string }>(
    'SELECT id, count(*) OVER ()::text AS count FROM drivers WHERE user_id = $1',
    [managedDriverBody.data.id],
  )
  assert.equal(
    driverProfile.rows[0]?.count,
    '1',
    'admin creation must create the driver profile atomically',
  )
  const customerRecord = await databaseModule.pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [credentials.email],
  )
  const shipmentRecord = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO shipments
      (tracking_code, customer_id, driver_id, pickup_address, pickup_location,
       dropoff_address, dropoff_location, weight_kg)
     VALUES ($1, $2, $3, 'Pickup', ST_SetSRID(ST_MakePoint(-1, 1), 4326)::geography,
             'Dropoff', ST_SetSRID(ST_MakePoint(-1.1, 1.1), 4326)::geography, 1)
     RETURNING id`,
    [`RC-P4-${suffix.slice(0, 8)}`, customerRecord.rows[0]!.id, driverProfile.rows[0]!.id],
  )
  const { assertCustomerOwnsShipment, assertDriverOwnsShipment } =
    await import('../../src/modules/auth/ownership.js')
  const shipmentId = shipmentRecord.rows[0]!.id
  await assertCustomerOwnsShipment(customerRecord.rows[0]!.id, shipmentId)
  await assertDriverOwnsShipment(managedDriverBody.data.id, shipmentId)
  await assert.rejects(
    assertCustomerOwnsShipment(adminInsert.rows[0]?.id ?? '', shipmentId),
    (error: unknown) => error instanceof ForbiddenError,
  )
  await assert.rejects(
    assertDriverOwnsShipment(adminInsert.rows[0]?.id ?? '', shipmentId),
    (error: unknown) => error instanceof ForbiddenError,
  )
  await assert.rejects(
    assertCustomerOwnsShipment(customerRecord.rows[0]!.id, randomUUID()),
    (error: unknown) => error instanceof NotFoundError,
  )
  const dispatcherLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `dispatcher-${suffix}@routecommand.test`,
      password: 'admin-phase4-integration-password',
    }),
  })
  const driverLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `driver-${suffix}@routecommand.test`,
      password: 'driver-phase4-integration-password',
    }),
  })
  assert.equal(dispatcherLogin.status, 200)
  assert.equal(driverLogin.status, 200)
  const dispatcherToken = ((await dispatcherLogin.json()) as { data: { accessToken: string } }).data
    .accessToken
  const driverToken = ((await driverLogin.json()) as { data: { accessToken: string } }).data
    .accessToken
  const { verifyAccessToken } = await import('../../src/modules/auth/service.js')
  const driverClaims = await verifyAccessToken(driverToken)
  assert.equal(driverClaims.driverId, driverProfile.rows[0]!.id)

  const unauthenticatedSocket = createRealtimeSocket()
  await assert.rejects(waitForSocketConnect(unauthenticatedSocket))
  unauthenticatedSocket.disconnect()

  const dispatcherSocket = createRealtimeSocket(dispatcherToken)
  const initialOpsSnapshot = waitForOpsSnapshot(dispatcherSocket)
  await waitForSocketConnect(dispatcherSocket)
  assert.equal((await initialOpsSnapshot).positions.length, 0)

  const driverSocket = createRealtimeSocket(driverToken)
  await waitForSocketConnect(driverSocket)
  const dispatcherJoin = await new Promise<{ ok: boolean }>((resolve) => {
    dispatcherSocket.emit('subscribe:shipment', { shipmentId }, resolve)
  })
  assert.equal(dispatcherJoin.ok, true, 'dispatchers may subscribe to shipment updates')
  const driverJoin = await new Promise<{ ok: boolean }>((resolve) => {
    driverSocket.emit('subscribe:shipment', { shipmentId }, resolve)
  })
  assert.equal(driverJoin.ok, true, 'the assigned driver may subscribe to shipment updates')

  const unauthorizedCustomerEmail = `unrelated-${suffix}@routecommand.test`
  await databaseModule.pool.query(
    `INSERT INTO users (email, name, role, password_hash, email_verified_at)
     VALUES ($1, 'Unrelated Customer', 'CUSTOMER', $2, now())`,
    [unauthorizedCustomerEmail, passwordHash],
  )
  const unauthorizedCustomerToken = await loginAs(
    unauthorizedCustomerEmail,
    'admin-phase4-integration-password',
  )
  const unauthorizedCustomerSocket = createRealtimeSocket(unauthorizedCustomerToken)
  await waitForSocketConnect(unauthorizedCustomerSocket)
  const deniedShipmentJoin = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
    unauthorizedCustomerSocket.emit('subscribe:shipment', { shipmentId }, resolve)
  })
  assert.equal(deniedShipmentJoin.ok, false)
  assert.equal(
    deniedShipmentJoin.code,
    'FORBIDDEN',
    'customers cannot subscribe to another customer’s shipment',
  )

  const realtimePositionPromise = waitForDriverPosition(dispatcherSocket, driverProfile.rows[0]!.id)
  const realtimeTelemetryAck = await new Promise<TelemetryAck>((resolve) => {
    driverSocket.emit(
      'telemetry:update',
      {
        lat: 6.5244,
        lng: 3.3792,
        accuracyM: 8,
        speedMps: 4,
        recordedAt: new Date(Date.now() - 30_000).toISOString(),
      },
      resolve,
    )
  })
  assert.equal(
    realtimeTelemetryAck.ok,
    true,
    'driver socket telemetry should enter the existing pipeline',
  )
  const realtimePosition = await realtimePositionPromise
  assert.equal(realtimePosition.driverId, driverProfile.rows[0]!.id)
  assert(realtimePosition.sequence > 0, 'live position events carry a server sequence')

  const snapshotPromise = waitForOpsSnapshot(dispatcherSocket)
  dispatcherSocket.emit('ops:snapshot:request', () => undefined)
  const liveSnapshot = await snapshotPromise
  assert(
    liveSnapshot.positions.some((position) => position.driverId === driverProfile.rows[0]!.id),
    'operations snapshot includes the latest Redis driver position',
  )

  const driverRefreshCookie = driverLogin.headers
    .get('set-cookie')
    ?.match(/routecommand_refresh=([^;]+)/)?.[1]
  assert(driverRefreshCookie, 'driver login should issue a refresh cookie')
  const refreshedDriver = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      cookie: `routecommand_refresh=${driverRefreshCookie}`,
      'x-requested-with': 'RouteCommand',
    },
  })
  assert.equal(refreshedDriver.status, 200)
  const refreshedDriverToken = (
    (await refreshedDriver.json()) as {
      data: { accessToken: string }
    }
  ).data.accessToken
  const socketRefreshAck = await new Promise<{ ok: boolean }>((resolve) => {
    driverSocket.emit('auth:refresh', { accessToken: refreshedDriverToken }, resolve)
  })
  assert.equal(socketRefreshAck.ok, true, 'an active socket can refresh its access token')

  dispatcherSocket.disconnect()
  const restoredSnapshotPromise = waitForOpsSnapshot(dispatcherSocket)
  const dispatcherReconnect = waitForSocketConnect(dispatcherSocket)
  await dispatcherReconnect
  const restoredSnapshot = await restoredSnapshotPromise
  assert(
    restoredSnapshot.positions.some((position) => position.driverId === driverProfile.rows[0]!.id),
    'reconnecting operations clients recover live positions from a fresh snapshot',
  )

  const simulatedDriverIds = Array.from({ length: 200 }, () => randomUUID())
  const simulatedDriverSet = new Set(simulatedDriverIds)
  const receivedSimulatedDrivers = new Set<string>()
  const rssBeforeFanout = process.memoryUsage().rss
  const cpuBeforeFanout = process.cpuUsage()
  const allSimulatedPositions = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      dispatcherSocket.off('driver:position', onSimulatedPosition)
      reject(
        new Error(
          `Dispatcher received ${receivedSimulatedDrivers.size}/200 simulated driver positions.`,
        ),
      )
    }, 5_000)
    const onSimulatedPosition = (position: DriverPositionEvent) => {
      if (!simulatedDriverSet.has(position.driverId)) return
      receivedSimulatedDrivers.add(position.driverId)
      if (receivedSimulatedDrivers.size !== simulatedDriverIds.length) return
      clearTimeout(timeout)
      dispatcherSocket.off('driver:position', onSimulatedPosition)
      resolve()
    }
    dispatcherSocket.on('driver:position', onSimulatedPosition)
  })
  const redisLivePublisher = redisModule.redisPublisher
  await Promise.all(
    simulatedDriverIds.map((simulatedDriverId, index) =>
      redisLivePublisher.publish(
        'routecommand:telemetry:live',
        JSON.stringify({
          driverId: simulatedDriverId,
          lat: 6.5 + (index % 20) / 10_000,
          lng: 3.3 + Math.floor(index / 20) / 10_000,
          accuracyM: 8,
          speedMps: 4,
          headingDeg: null,
          recordedAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        }),
      ),
    ),
  )
  await allSimulatedPositions
  const fanoutCpu = process.cpuUsage(cpuBeforeFanout)
  const fanoutCpuMs = (fanoutCpu.user + fanoutCpu.system) / 1_000
  const fanoutRssGrowth = process.memoryUsage().rss - rssBeforeFanout
  assert.equal(receivedSimulatedDrivers.size, 200)
  assert(fanoutCpuMs < 5_000, `200-driver fan-out CPU should stay below 5s; used ${fanoutCpuMs}ms`)
  assert(
    fanoutRssGrowth < 128 * 1024 * 1024,
    `200-driver fan-out RSS growth should stay below 128 MB; grew ${fanoutRssGrowth} bytes`,
  )

  const telemetryStartAt = Date.now()
  const telemetryBatch = await fetch(`${baseUrl}/api/v1/telemetry/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${driverToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      points: [
        {
          lat: 6.5244,
          lng: 3.3792,
          accuracyM: 8,
          speedMps: 4,
          headingDeg: 85,
          recordedAt: new Date(telemetryStartAt - 1_000).toISOString(),
        },
        {
          lat: 6.5245,
          lng: 3.3793,
          accuracyM: 150,
          speedMps: 4,
          recordedAt: new Date(telemetryStartAt - 500).toISOString(),
        },
      ],
    }),
  })
  assert.equal(telemetryBatch.status, 202)
  const telemetryBatchBody = (await telemetryBatch.json()) as {
    data: { queued: number; filtered: number; liveUpdated: number }
  }
  assert.deepEqual(telemetryBatchBody.data, { queued: 2, filtered: 1, liveUpdated: 1 })
  const dispatcherTelemetry = await fetch(`${baseUrl}/api/v1/telemetry/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dispatcherToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ points: [] }),
  })
  assert.equal(dispatcherTelemetry.status, 403, 'only driver sessions may submit telemetry')
  const nullIslandTelemetry = await fetch(`${baseUrl}/api/v1/telemetry/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${driverToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      points: [{ lat: 0, lng: 0, accuracyM: 2, recordedAt: new Date().toISOString() }],
    }),
  })
  assert.equal(nullIslandTelemetry.status, 422, 'Null Island telemetry must be rejected')
  let telemetryRows:
    { count: number; filtered_count: number; low_accuracy_count: number } | undefined
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await databaseModule.pool.query<{ count: number; filtered_count: number }>(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE is_filtered)::int AS filtered_count,
              count(*) FILTER (WHERE 'LOW_ACCURACY' = ANY(filter_reasons))::int AS low_accuracy_count
       FROM telemetry_points WHERE driver_id = $1 AND recorded_at >= $2`,
      [driverProfile.rows[0]!.id, new Date(telemetryStartAt - 2_000)],
    )
    telemetryRows = result.rows[0]
    if (telemetryRows?.count === 2) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(telemetryRows?.count, 2, 'the Redis stream worker must persist the complete batch')
  assert.equal(telemetryRows?.filtered_count, 1, 'low-accuracy fixes persist as filtered history')
  assert.equal(telemetryRows?.low_accuracy_count, 1, 'history retains the quality filter reason')
  const stressStart = Date.now() - 20_000_000
  let stressQueued = 0
  for (let offset = 0; offset < 10_000; offset += 500) {
    const points = Array.from({ length: 500 }, (_, index) => ({
      lat: 6.5244,
      lng: 3.3792,
      accuracyM: 8,
      recordedAt: new Date(stressStart + (offset + index) * 1_000).toISOString(),
    }))
    const response = await fetch(`${baseUrl}/api/v1/telemetry/batch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${driverToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ points }),
    })
    assert.equal(response.status, 202, `10k telemetry batch ${offset / 500 + 1} should queue`)
    stressQueued += ((await response.json()) as { data: { queued: number } }).data.queued
  }
  assert.equal(stressQueued, 10_000, 'the API should enqueue all 10k stress points')
  let stressRows = 0
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await databaseModule.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM telemetry_points
       WHERE driver_id = $1 AND recorded_at >= $2 AND recorded_at < $3`,
      [driverProfile.rows[0]!.id, new Date(stressStart), new Date(stressStart + 10_000_000)],
    )
    stressRows = result.rows[0]?.count ?? 0
    if (stressRows === 10_000) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(stressRows, 10_000, 'the worker should bulk-persist the full 10k point run')
  const duplicateResponse = await fetch(`${baseUrl}/api/v1/telemetry/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${driverToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      points: [
        {
          lat: 6.5244,
          lng: 3.3792,
          accuracyM: 8,
          recordedAt: new Date(stressStart).toISOString(),
        },
      ],
    }),
  })
  assert.equal(
    duplicateResponse.status,
    202,
    'replayed points should still be accepted by the buffer',
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  const deduplicatedCount = await databaseModule.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM telemetry_points
     WHERE driver_id = $1 AND recorded_at >= $2 AND recorded_at < $3`,
    [driverProfile.rows[0]!.id, new Date(stressStart), new Date(stressStart + 10_000_000)],
  )
  assert.equal(
    deduplicatedCount.rows[0]?.count,
    10_000,
    'duplicate driver/timestamp rows are ignored',
  )
  const trackResponse = await fetch(
    `${baseUrl}/api/v1/telemetry/drivers/${driverProfile.rows[0]!.id}/track?from=${encodeURIComponent(new Date(stressStart).toISOString())}&to=${encodeURIComponent(new Date(stressStart + 10_000_000).toISOString())}`,
    { headers: { authorization: `Bearer ${dispatcherToken}` } },
  )
  assert.equal(trackResponse.status, 200, 'dispatcher can read a driver track')
  const track = (await trackResponse.json()) as {
    data: { geometry: { type: string; coordinates: unknown[] }; properties: { pointCount: number } }
  }
  assert.equal(track.data.geometry.type, 'LineString')
  assert.equal(track.data.properties.pointCount, 10_000)
  const pointsPage = await fetch(
    `${baseUrl}/api/v1/telemetry/drivers/${driverProfile.rows[0]!.id}/points?limit=2`,
    { headers: { authorization: `Bearer ${dispatcherToken}` } },
  )
  assert.equal(pointsPage.status, 200)
  const page = (await pointsPage.json()) as { data: unknown[]; nextCursor: string | null }
  assert.equal(page.data.length, 2)
  assert(page.nextCursor)
  const nextPage = await fetch(
    `${baseUrl}/api/v1/telemetry/drivers/${driverProfile.rows[0]!.id}/points?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
    { headers: { authorization: `Bearer ${dispatcherToken}` } },
  )
  assert.equal(((await nextPage.json()) as { data: unknown[] }).data.length, 2)
  const metrics = await fetch(`${baseUrl}/metrics`, {
    headers: { authorization: `Bearer ${adminSession.data.accessToken}` },
  })
  assert.equal(metrics.status, 200)
  const metricsBody = await metrics.text()
  assert.match(metricsBody, /routecommand_telemetry_buffer_depth/)
  const flushedPoints = Number(
    metricsBody.match(/routecommand_telemetry_flush_points_total (\d+(?:\.\d+)?)/)?.[1],
  )
  const flushBatches = Number(
    metricsBody.match(/routecommand_telemetry_flush_batches_total (\d+(?:\.\d+)?)/)?.[1],
  )
  const ingestionLatency = Number(
    metricsBody.match(/routecommand_telemetry_ingestion_latency_ms_avg (\d+(?:\.\d+)?)/)?.[1],
  )
  assert(flushedPoints >= 10_002, 'metrics should count the 10k history run')
  assert(
    flushBatches > 0 && flushBatches < flushedPoints,
    'history writes must batch multiple fixes',
  )
  assert(ingestionLatency > 0, 'ingestion latency must be measured')
  const deniedMetrics = await fetch(`${baseUrl}/metrics`, {
    headers: { authorization: `Bearer ${dispatcherToken}` },
  })
  assert.equal(deniedMetrics.status, 403, 'telemetry metrics are restricted to administrators')
  const cachedPosition = await redisModule.redisClient.hGet(
    `routecommand:driver:${driverProfile.rows[0]!.id}:loc`,
    'point',
  )
  assert(cachedPosition, 'an accepted fix should update the Redis latest-position hash')
  const geoMember = await redisModule.redisClient.sendCommand([
    'GEOPOS',
    'routecommand:drivers:geo',
    driverProfile.rows[0]!.id,
  ])
  assert(
    Array.isArray(geoMember) && geoMember[0],
    'an accepted fix should update the Redis geo index',
  )
  const customerTokenForMatrix = await loginAs(credentials.email, credentials.password)
  const fleetHeaders = (token: string) => ({ authorization: `Bearer ${token}` })
  const warmZoneCache = await fetch(`${baseUrl}/api/v1/zones/geojson`, {
    headers: fleetHeaders(dispatcherToken),
  })
  assert.equal(warmZoneCache.status, 200)
  const zoneGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [3.3, 6.4],
        [3.4, 6.4],
        [3.4, 6.5],
        [3.3, 6.5],
        [3.3, 6.4],
      ],
    ],
  }
  const createdZoneResponse = await fetch(`${baseUrl}/api/v1/zones`, {
    method: 'POST',
    headers: { ...fleetHeaders(adminSession.data.accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `Phase Six Zone ${suffix}`,
      type: 'DELIVERY',
      geometry: zoneGeometry,
    }),
  })
  assert.equal(createdZoneResponse.status, 201)
  const createdZone = (await createdZoneResponse.json()) as {
    data: { id: string; name: string; updatedAt: string; geometry: { type: string } }
  }
  assert.equal(createdZone.data.geometry.type, 'MultiPolygon')
  const zoneDetail = await fetch(`${baseUrl}/api/v1/zones/${createdZone.data.id}`, {
    headers: fleetHeaders(dispatcherToken),
  })
  assert.equal(zoneDetail.status, 200)
  const zoneCollection = await fetch(`${baseUrl}/api/v1/zones/geojson`, {
    headers: fleetHeaders(dispatcherToken),
  })
  assert.equal(zoneCollection.status, 200)
  const zoneGeoJson = (await zoneCollection.json()) as {
    data: { type: string; features: { id: string }[] }
  }
  assert.equal(zoneGeoJson.data.type, 'FeatureCollection')
  assert(zoneGeoJson.data.features.some((feature) => feature.id === createdZone.data.id))

  const zoneSpatialClient = await databaseModule.pool.connect()
  try {
    await zoneSpatialClient.query('BEGIN')
    await zoneSpatialClient.query('SET LOCAL enable_seqscan = off')
    const zonePlan = await zoneSpatialClient.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id FROM zones
       WHERE is_active
         AND ST_Covers(
           geom,
           ST_SetSRID(ST_MakePoint(3.35, 6.45), 4326)::geography
         )`,
    )
    assert.match(
      zonePlan.rows.map((row) => row['QUERY PLAN']).join('\n'),
      /zones_geom_gist_idx/,
      'point-in-zone query should use the zone GiST index',
    )
  } finally {
    await zoneSpatialClient.query('ROLLBACK')
    zoneSpatialClient.release()
  }

  for (const [point, expectedInside, label] of [
    [{ lng: 3.35, lat: 6.45 }, true, 'inside'],
    [{ lng: 3.3, lat: 6.45 }, true, 'on boundary'],
    [{ lng: 3.5, lat: 6.5 }, false, 'outside'],
  ] as const) {
    const check = await fetch(`${baseUrl}/api/v1/zones/check-point`, {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify(point),
    })
    assert.equal(check.status, 200)
    const checked = (await check.json()) as { data: { id: string }[] }
    assert.equal(
      checked.data.some((zone) => zone.id === createdZone.data.id),
      expectedInside,
      `point-in-zone check should be correct for a point ${label}`,
    )
  }

  const selfIntersectingZone = await fetch(`${baseUrl}/api/v1/zones`, {
    method: 'POST',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `Invalid Zone ${suffix}`,
      type: 'CUSTOM',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [3.3, 6.4],
            [3.4, 6.5],
            [3.3, 6.5],
            [3.4, 6.4],
            [3.3, 6.4],
          ],
        ],
      },
    }),
  })
  assert.equal(selfIntersectingZone.status, 400, 'self-intersecting zones are rejected')

  const staleZoneUpdate = await fetch(`${baseUrl}/api/v1/zones/${createdZone.data.id}`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      name: 'Stale update',
    }),
  })
  assert.equal(staleZoneUpdate.status, 409, 'stale zone edits are rejected')
  const updateZoneResponse = await fetch(`${baseUrl}/api/v1/zones/${createdZone.data.id}`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedUpdatedAt: createdZone.data.updatedAt,
      name: `Updated Phase Six Zone ${suffix}`,
      geometry: zoneGeometry,
    }),
  })
  assert.equal(updateZoneResponse.status, 200)
  const updatedZone = (await updateZoneResponse.json()) as { data: { updatedAt: string } }
  const deactivateZoneResponse = await fetch(`${baseUrl}/api/v1/zones/${createdZone.data.id}`, {
    method: 'DELETE',
    headers: { ...fleetHeaders(adminSession.data.accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({ expectedUpdatedAt: updatedZone.data.updatedAt }),
  })
  assert.equal(deactivateZoneResponse.status, 200)
  const inactiveZone = (await deactivateZoneResponse.json()) as { data: { isActive: boolean } }
  assert.equal(inactiveZone.data.isActive, false)
  const activeGeoJsonAfterDelete = await fetch(`${baseUrl}/api/v1/zones/geojson`, {
    headers: fleetHeaders(dispatcherToken),
  })
  const activeCollectionAfterDelete = (await activeGeoJsonAfterDelete.json()) as {
    data: { features: { id: string }[] }
  }
  assert(
    !activeCollectionAfterDelete.data.features.some(
      (feature) => feature.id === createdZone.data.id,
    ),
    'inactive zones stay persisted but disappear from the active map collection',
  )
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/zones`, {
        headers: fleetHeaders(customerTokenForMatrix),
      })
    ).status,
    403,
    'customers cannot access operational zones',
  )

  const { domainEventBus } = await import('../../src/core/events/domain-event-bus.js')
  const { processGeofenceFix } = await import('../../src/modules/geofence/worker.js')
  const testRestrictedZone = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO zones (name, type, geom, color, is_active, created_by)
     VALUES ($1, 'RESTRICTED', ST_Multi(ST_GeomFromText(
       'POLYGON((3.2 6.45,3.202 6.45,3.202 6.452,3.2 6.452,3.2 6.45))', 4326
     ))::geography, '#B84B3B', true, $2) RETURNING id`,
    [`Phase Ten Restricted ${suffix}`, adminInsert.rows[0]!.id],
  )
  const testDepotZone = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO zones (name, type, geom, color, is_active, created_by)
     VALUES ($1, 'DEPOT', ST_Multi(ST_GeomFromText(
       'POLYGON((3.32 6.62,3.35 6.62,3.35 6.64,3.32 6.64,3.32 6.62))', 4326
     ))::geography, '#5374A5', true, $2) RETURNING id`,
    [`Phase Ten Depot ${suffix}`, adminInsert.rows[0]!.id],
  )
  const phase10DriverId = driverProfile.rows[0]!.id
  await databaseModule.pool.query('DELETE FROM geofence_states WHERE driver_id = $1', [
    phase10DriverId,
  ])
  const publishGeofenceFix = async (lat: number, lng: number) => {
    await processGeofenceFix({
      driverId: phase10DriverId,
      lat,
      lng,
      accuracyM: 8,
      speedMps: 5,
      headingDeg: null,
      recordedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    })
  }
  const outsideAlertZone = { lat: 6.451, lng: 3.203 }
  await publishGeofenceFix(outsideAlertZone.lat, outsideAlertZone.lng)
  const initialGeofenceState = await databaseModule.pool.query<{ is_inside: boolean }>(
    'SELECT is_inside FROM geofence_states WHERE driver_id = $1 AND zone_id = $2',
    [phase10DriverId, testRestrictedZone.rows[0]!.id],
  )
  assert.equal(initialGeofenceState.rows[0]?.is_inside, false)
  const initialDepotState = await databaseModule.pool.query<{ is_inside: boolean }>(
    'SELECT is_inside FROM geofence_states WHERE driver_id = $1 AND zone_id = $2',
    [phase10DriverId, testDepotZone.rows[0]!.id],
  )
  assert.equal(initialDepotState.rows[0]?.is_inside, false)

  const restrictedAlertEvent = waitForAlertCreated(dispatcherSocket, 'RESTRICTED_ZONE_BREACH')
  await publishGeofenceFix(6.451, 3.2015)
  const pendingGeofenceState = await databaseModule.pool.query<{
    is_inside: boolean
    pending_count: number
  }>('SELECT is_inside, pending_count FROM geofence_states WHERE driver_id = $1 AND zone_id = $2', [
    phase10DriverId,
    testRestrictedZone.rows[0]!.id,
  ])
  assert.equal(pendingGeofenceState.rows[0]?.is_inside, false)
  assert.equal(pendingGeofenceState.rows[0]?.pending_count, 1)
  await publishGeofenceFix(6.4512, 3.2014)
  const confirmedGeofenceState = await databaseModule.pool.query<{
    is_inside: boolean
    pending_count: number
  }>('SELECT is_inside, pending_count FROM geofence_states WHERE driver_id = $1 AND zone_id = $2', [
    phase10DriverId,
    testRestrictedZone.rows[0]!.id,
  ])
  assert.equal(confirmedGeofenceState.rows[0]?.is_inside, true)
  assert.equal(confirmedGeofenceState.rows[0]?.pending_count, 0)
  const restrictedAlertEventResult = await restrictedAlertEvent
  assert.equal(restrictedAlertEventResult.severity, 'CRITICAL')

  const openRestrictedAlertsResponse = await fetch(
    `${baseUrl}/api/v1/alerts?status=OPEN&type=RESTRICTED_ZONE_BREACH&driverId=${phase10DriverId}`,
    { headers: fleetHeaders(dispatcherToken) },
  )
  assert.equal(openRestrictedAlertsResponse.status, 200)
  const openRestrictedAlerts = (await openRestrictedAlertsResponse.json()) as {
    data: { id: string; status: string }[]
    meta: { total: number }
  }
  assert.equal(openRestrictedAlerts.meta.total, 1, 'a confirmed restricted entry creates one alert')
  const restrictedAlertId = openRestrictedAlerts.data[0]!.id

  await publishGeofenceFix(6.4513, 3.2013)
  const deduplicatedAlertCount = await databaseModule.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM alerts
     WHERE type = 'RESTRICTED_ZONE_BREACH' AND driver_id = $1 AND zone_id = $2
       AND status <> 'RESOLVED'`,
    [phase10DriverId, testRestrictedZone.rows[0]!.id],
  )
  assert.equal(deduplicatedAlertCount.rows[0]?.count, 1, 'staying inside does not duplicate alerts')

  const acknowledgeAlertResponse = await fetch(
    `${baseUrl}/api/v1/alerts/${restrictedAlertId}/acknowledge`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Integration acknowledgement' }),
    },
  )
  assert.equal(acknowledgeAlertResponse.status, 200)
  assert.equal(
    ((await acknowledgeAlertResponse.json()) as { data: { status: string } }).data.status,
    'ACKNOWLEDGED',
  )
  const resolveAlertResponse = await fetch(
    `${baseUrl}/api/v1/alerts/${restrictedAlertId}/resolve`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Integration resolution' }),
    },
  )
  assert.equal(resolveAlertResponse.status, 200)
  assert.equal(
    ((await resolveAlertResponse.json()) as { data: { status: string } }).data.status,
    'RESOLVED',
  )
  const alertAuditCount = await databaseModule.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_logs
     WHERE entity = 'alert' AND entity_id = $1
       AND action IN ('alerts.acknowledged', 'alerts.resolved')`,
    [restrictedAlertId],
  )
  assert.equal(alertAuditCount.rows[0]?.count, 2, 'both alert actions are audited')

  const depotPickupShipment = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO shipments
      (tracking_code, customer_id, driver_id, status, pickup_address, pickup_location,
       dropoff_address, dropoff_location, weight_kg)
     VALUES ($1, $2, $3, 'ASSIGNED', 'Depot', ST_SetSRID(ST_MakePoint(3.33, 6.63), 4326)::geography,
       'Dropoff', ST_SetSRID(ST_MakePoint(3.4, 6.5), 4326)::geography, 1) RETURNING id`,
    [`RC-P10-D-${suffix.slice(0, 8)}`, customerRecord.rows[0]!.id, phase10DriverId],
  )
  await publishGeofenceFix(6.63, 3.319)
  const pickupSuggestion = waitForShipmentSuggestion(
    driverSocket,
    depotPickupShipment.rows[0]!.id,
    'PICKED_UP',
  )
  await publishGeofenceFix(6.63, 3.321)
  await publishGeofenceFix(6.631, 3.322)
  assert.equal((await pickupSuggestion).reason, 'DEPOT_GEOFENCE')

  const arrivalSuggestionShipment = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO shipments
      (tracking_code, customer_id, driver_id, status, pickup_address, pickup_location,
       dropoff_address, dropoff_location, weight_kg)
     VALUES ($1, $2, $3, 'IN_TRANSIT', 'Pickup', ST_SetSRID(ST_MakePoint(3.3, 6.4), 4326)::geography,
       'Near dropoff', ST_SetSRID(ST_MakePoint(3.4, 6.5), 4326)::geography, 1) RETURNING id`,
    [`RC-P10-A-${suffix.slice(0, 8)}`, customerRecord.rows[0]!.id, phase10DriverId],
  )
  const arrivalSuggestion = waitForShipmentSuggestion(
    driverSocket,
    arrivalSuggestionShipment.rows[0]!.id,
    'ARRIVED',
  )
  await publishGeofenceFix(6.5, 3.4)
  assert.equal((await arrivalSuggestion).reason, 'NEAR_DROPOFF')
  const suggestionDidNotAdvanceShipment = await databaseModule.pool.query<{ status: string }>(
    'SELECT status FROM shipments WHERE id = $1',
    [arrivalSuggestionShipment.rows[0]!.id],
  )
  assert.equal(
    suggestionDidNotAdvanceShipment.rows[0]?.status,
    'IN_TRANSIT',
    'near-dropoff suggestion must not transition shipment status automatically',
  )

  const fleetEvents: string[] = []
  const stopAssignmentListener = domainEventBus.subscribe('driver.vehicleAssigned', () => {
    fleetEvents.push('driver.vehicleAssigned')
  })
  const stopStatusListener = domainEventBus.subscribe('driver.statusChanged', () => {
    fleetEvents.push('driver.statusChanged')
  })
  const selfStatusChange = await fetch(`${baseUrl}/api/v1/drivers/me/status`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(driverToken), 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'ON_BREAK' }),
  })
  assert.equal(selfStatusChange.status, 200, 'drivers can change their own availability')
  assert(fleetEvents.includes('driver.statusChanged'), 'self status changes publish after commit')
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/drivers/me`, { headers: fleetHeaders(driverToken) })).status,
    200,
  )
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/drivers`, { headers: fleetHeaders(driverToken) })).status,
    403,
  )
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/drivers`, { headers: fleetHeaders(customerTokenForMatrix) }))
      .status,
    403,
  )
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/vehicles`, { headers: fleetHeaders(customerTokenForMatrix) }))
      .status,
    403,
  )
  const dispatcherDrivers = await fetch(`${baseUrl}/api/v1/drivers?limit=10`, {
    headers: fleetHeaders(dispatcherToken),
  })
  assert.equal(dispatcherDrivers.status, 200, 'dispatchers can list drivers')

  const fleetVehicle = await fetch(`${baseUrl}/api/v1/vehicles`, {
    method: 'POST',
    headers: { ...fleetHeaders(adminSession.data.accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({ plate: `FLEET-${suffix.slice(0, 8)}`, type: 'VAN', capacityKg: 1200 }),
  })
  assert.equal(fleetVehicle.status, 201)
  const fleetVehicleRecord = (await fleetVehicle.json()) as { data: { id: string } }
  const duplicatePlate = await fetch(`${baseUrl}/api/v1/vehicles`, {
    method: 'POST',
    headers: { ...fleetHeaders(adminSession.data.accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({ plate: `FLEET-${suffix.slice(0, 8)}`, type: 'VAN', capacityKg: 1200 }),
  })
  assert.equal(duplicatePlate.status, 409, 'duplicate vehicle plates return a conflict')
  const assignedVehicle = await fetch(
    `${baseUrl}/api/v1/drivers/${driverProfile.rows[0]!.id}/assign-vehicle`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ vehicleId: fleetVehicleRecord.data.id }),
    },
  )
  assert.equal(assignedVehicle.status, 200)
  assert(
    fleetEvents.includes('driver.vehicleAssigned'),
    'vehicle assignment event is published after commit',
  )
  await databaseModule.pool.query(
    `UPDATE drivers SET status = 'AVAILABLE',
       last_known_location = ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography,
       last_seen_at = now()
     WHERE id = $1`,
    [driverProfile.rows[0]!.id],
  )
  const secondDriverResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers: { ...fleetHeaders(adminSession.data.accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `driver-two-${suffix}@routecommand.test`,
      name: 'Second Fleet Driver',
      password: 'driver-two-phase5-password',
      role: 'DRIVER',
      licenseNo: `LIC2-${suffix}`,
    }),
  })
  assert.equal(secondDriverResponse.status, 201)
  const secondDriverUser = (await secondDriverResponse.json()) as { data: { id: string } }
  const secondDriverProfile = await databaseModule.pool.query<{ id: string }>(
    'SELECT id FROM drivers WHERE user_id = $1',
    [secondDriverUser.data.id],
  )
  await databaseModule.pool.query("UPDATE drivers SET status = 'AVAILABLE' WHERE id = $1", [
    secondDriverProfile.rows[0]!.id,
  ])
  const conflictingAssignment = await fetch(
    `${baseUrl}/api/v1/drivers/${secondDriverProfile.rows[0]!.id}/assign-vehicle`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ vehicleId: fleetVehicleRecord.data.id }),
    },
  )
  assert.equal(
    conflictingAssignment.status,
    409,
    'one vehicle cannot be assigned to two active drivers',
  )
  const nearbyAtOrigin = await fetch(`${baseUrl}/api/v1/drivers/nearby?lng=3&lat=6&radiusM=100`, {
    headers: fleetHeaders(dispatcherToken),
  })
  const nearbyAtOriginPayload = (await nearbyAtOrigin.json()) as {
    data?: { id: string; distanceMeters: number }[]
    error?: { code: string; message: string; requestId: string }
  }
  assert.equal(
    nearbyAtOrigin.status,
    200,
    `nearby search failed: ${JSON.stringify(nearbyAtOriginPayload.error ?? nearbyAtOriginPayload)}`,
  )
  const nearbyBody = nearbyAtOriginPayload as { data: { id: string; distanceMeters: number }[] }
  assert.equal(nearbyBody.data[0]?.id, driverProfile.rows[0]!.id)
  assert(nearbyBody.data[0]!.distanceMeters <= 100)
  await databaseModule.pool.query(
    `UPDATE drivers SET last_known_location = ST_Project(
       ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography, 100, radians(90)
     ) WHERE id = $1`,
    [driverProfile.rows[0]!.id],
  )
  const boundaryDistance = await databaseModule.pool.query<{ distance_meters: number }>(
    `SELECT ST_Distance(
       last_known_location,
       ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography
     )::float8 AS distance_meters
     FROM drivers WHERE id = $1`,
    [driverProfile.rows[0]!.id],
  )
  // ST_Project and ST_DWithin can differ by a tiny amount at exact equality on geography.
  const boundaryRadius = boundaryDistance.rows[0]!.distance_meters + 0.01
  const boundaryPredicate = await databaseModule.pool.query<{ included: boolean }>(
    `SELECT ST_DWithin(
       last_known_location,
       ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography,
       $2::float8
     ) AS included
     FROM drivers WHERE id = $1`,
    [driverProfile.rows[0]!.id, boundaryRadius],
  )
  assert.equal(
    boundaryPredicate.rows[0]?.included,
    true,
    `PostGIS should include a point 1 cm inside its measured boundary (${boundaryRadius.toFixed(6)} m)`,
  )
  const nearbyAtBoundary = await fetch(
    `${baseUrl}/api/v1/drivers/nearby?lng=3&lat=6&radiusM=${boundaryRadius}`,
    { headers: fleetHeaders(dispatcherToken) },
  )
  assert.equal(nearbyAtBoundary.status, 200)
  const boundaryBody = (await nearbyAtBoundary.json()) as {
    data?: { id: string; distanceMeters: number }[]
    error?: { code: string; message: string }
  }
  assert(
    boundaryBody.data?.some((driver) => driver.id === driverProfile.rows[0]!.id),
    `nearby boundary search omitted the driver at ${boundaryRadius.toFixed(6)} m: ${JSON.stringify(boundaryBody)}`,
  )
  const boundaryDriver = boundaryBody.data!.find(
    (driver) => driver.id === driverProfile.rows[0]!.id,
  )!
  assert(Math.abs(boundaryDriver.distanceMeters - 100) < 0.01)
  const spatialClient = await databaseModule.pool.connect()
  try {
    await spatialClient.query('BEGIN')
    await spatialClient.query('SET LOCAL enable_seqscan = off')
    const spatialPlan = await spatialClient.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id FROM drivers
       WHERE status = 'AVAILABLE'
         AND last_known_location IS NOT NULL
         AND ST_DWithin(
           last_known_location,
           ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography,
           100
         )
       ORDER BY ST_Distance(
         last_known_location,
         ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography
       ), id
       LIMIT 50`,
    )
    const planText = spatialPlan.rows.map((row) => row['QUERY PLAN']).join('\n')
    assert.match(planText, /drivers_last_known_location_gist_idx/)
  } finally {
    await spatialClient.query('ROLLBACK')
    spatialClient.release()
  }
  const nearbyEmpty = await fetch(`${baseUrl}/api/v1/drivers/nearby?lng=20&lat=20&radiusM=1`, {
    headers: fleetHeaders(dispatcherToken),
  })
  assert.equal(
    ((await nearbyEmpty.json()) as { data: unknown[] }).data.length,
    0,
    'nearby search returns an empty array when no drivers are in range',
  )
  await databaseModule.pool.query("UPDATE shipments SET status = 'ASSIGNED' WHERE id = $1", [
    shipmentId,
  ])
  const activeVehicleDelete = await fetch(
    `${baseUrl}/api/v1/vehicles/${fleetVehicleRecord.data.id}`,
    { method: 'DELETE', headers: fleetHeaders(adminSession.data.accessToken) },
  )
  assert.equal(activeVehicleDelete.status, 409, 'an active driver prevents vehicle deactivation')
  const offlineWarning = await fetch(`${baseUrl}/api/v1/drivers/${driverProfile.rows[0]!.id}`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'OFFLINE' }),
  })
  assert.equal(
    offlineWarning.status,
    409,
    'active shipments require explicit confirmation before going offline',
  )
  assert.equal(
    ((await offlineWarning.json()) as { error: { details: { reason: string } } }).error.details
      .reason,
    'ACTIVE_SHIPMENTS',
  )
  const forcedOffline = await fetch(`${baseUrl}/api/v1/drivers/${driverProfile.rows[0]!.id}`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'OFFLINE', force: true }),
  })
  assert.equal(forcedOffline.status, 200)
  assert(
    fleetEvents.includes('driver.statusChanged'),
    'driver status event is published after commit',
  )
  stopAssignmentListener()
  stopStatusListener()

  const shipmentDriverUser = await fetch(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers: { ...fleetHeaders(adminSession.data.accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `shipment-driver-${suffix}@routecommand.test`,
      name: 'Shipment Integration Driver',
      password: 'shipment-driver-phase7-password',
      role: 'DRIVER',
      licenseNo: `SHP-${suffix}`,
    }),
  })
  assert.equal(shipmentDriverUser.status, 201)
  const shipmentDriverUserBody = (await shipmentDriverUser.json()) as { data: { id: string } }
  const shipmentDriverProfile = await databaseModule.pool.query<{ id: string }>(
    'SELECT id FROM drivers WHERE user_id = $1',
    [shipmentDriverUserBody.data.id],
  )
  const shipmentDriverId = shipmentDriverProfile.rows[0]!.id
  const dispatchVehicle = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO vehicles (plate, type, capacity_kg)
     VALUES ($1, 'VAN', 1200) RETURNING id`,
    [`DSP-${suffix.slice(0, 8)}`],
  )
  await databaseModule.pool.query(
    `UPDATE drivers SET status = 'AVAILABLE', last_known_location =
       ST_SetSRID(ST_MakePoint(3.35, 6.60), 4326)::geography,
       last_seen_at = now(), vehicle_id = $2 WHERE id = $1`,
    [shipmentDriverId, dispatchVehicle.rows[0]!.id],
  )
  await databaseModule.pool.query(
    `INSERT INTO telemetry_points (driver_id, location, accuracy_m, recorded_at, source)
     VALUES ($1, ST_SetSRID(ST_MakePoint(3.35, 6.60), 4326)::geography, 5, now(), 'SIMULATOR')`,
    [shipmentDriverId],
  )
  const shipmentDriverLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `shipment-driver-${suffix}@routecommand.test`,
      password: 'shipment-driver-phase7-password',
    }),
  })
  assert.equal(shipmentDriverLogin.status, 200)
  const shipmentDriverToken = (
    (await shipmentDriverLogin.json()) as { data: { accessToken: string } }
  ).data.accessToken

  const dispatchDriverSocket = createRealtimeSocket(shipmentDriverToken)
  await waitForSocketConnect(dispatchDriverSocket)

  const secondCustomer = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, email_verified_at)
     VALUES ($1, 'Second Shipment Customer', 'CUSTOMER', $2, now()) RETURNING id`,
    [`second-shipment-customer-${suffix}@routecommand.test`, passwordHash],
  )
  const secondCustomerToken = await loginAs(
    `second-shipment-customer-${suffix}@routecommand.test`,
    'admin-phase4-integration-password',
  )
  const shipmentEventsModule = await import('../../src/core/events/domain-event-bus.js')
  const shipmentRequestedEvents: { shipmentId: string; customerId: string; eventId: string }[] = []
  const stopShipmentRequestedListener = shipmentEventsModule.domainEventBus.subscribe(
    'shipment.requested',
    (event) => shipmentRequestedEvents.push(event),
  )
  const createCustomerShipment = await fetch(`${baseUrl}/api/v1/shipments`, {
    method: 'POST',
    headers: { ...fleetHeaders(customerTokenForMatrix), 'content-type': 'application/json' },
    body: JSON.stringify({
      pickupAddress: 'Integration pickup',
      pickup: { lat: 6.6, lng: 3.35 },
      dropoffAddress: 'Integration dropoff',
      dropoff: { lat: 6.61, lng: 3.36 },
      weightKg: 2.5,
      priority: 'HIGH',
    }),
  })
  assert.equal(createCustomerShipment.status, 201)
  const createdShipment = (await createCustomerShipment.json()) as {
    data: {
      id: string
      trackingCode: string
      customerId: string
      status: string
      eta: string | null
    }
  }
  assert.match(createdShipment.data.trackingCode, /^RC-[0-9A-HJKMNP-TV-Z]{10}$/)
  assert.equal(createdShipment.data.customerId, customerRecord.rows[0]!.id)
  assert.equal(createdShipment.data.status, 'CREATED')
  assert(createdShipment.data.eta, 'shipment creation should calculate an initial ETA')
  assert.equal(
    shipmentRequestedEvents.length,
    1,
    'customer request event should publish after commit',
  )
  assert.equal(shipmentRequestedEvents[0]?.shipmentId, createdShipment.data.id)

  const requestEvent = shipmentRequestedEvents[0]!
  const dispatcherRecord = await databaseModule.pool.query<{ id: string; email: string }>(
    "SELECT id, email::text AS email FROM users WHERE role = 'DISPATCHER' AND is_active AND email_verified_at IS NOT NULL LIMIT 1",
  )
  assert(dispatcherRecord.rows[0], 'notification test needs a verified dispatcher recipient')
  const notificationEventsModule = await import('../../src/core/events/domain-event-bus.js')
  notificationEventsModule.domainEventBus.publish('shipment.requested', requestEvent)
  notificationEventsModule.domainEventBus.publish('shipment.requested', requestEvent)
  let dispatcherEmailCount = 0
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM email_logs WHERE dedupe_key = $1',
      [
        `shipment:${requestEvent.shipmentId}:${requestEvent.eventId}:${dispatcherRecord.rows[0].id}`,
      ],
    )
    dispatcherEmailCount = Number(result.rows[0]?.count ?? 0)
    if (dispatcherEmailCount === 1) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    dispatcherEmailCount,
    1,
    'replaying the same shipment request event must queue exactly one dispatcher email',
  )

  const securityShipmentFixtures = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO shipments
      (tracking_code, customer_id, pickup_address, pickup_location, dropoff_address, dropoff_location, weight_kg)
     VALUES ($1, $2, 'Security pickup 1', ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography,
             'Security dropoff 1', ST_SetSRID(ST_MakePoint(3.1, 6.1), 4326)::geography, 1),
            ($3, $2, 'Security pickup 2', ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography,
             'Security dropoff 2', ST_SetSRID(ST_MakePoint(3.1, 6.1), 4326)::geography, 1),
            ($4, $2, 'Security pickup 3', ST_SetSRID(ST_MakePoint(3, 6), 4326)::geography,
             'Security dropoff 3', ST_SetSRID(ST_MakePoint(3.1, 6.1), 4326)::geography, 1)
     RETURNING id`,
    [
      `RC-SEC-${suffix.slice(0, 6)}A`,
      customerRecord.rows[0]!.id,
      `RC-SEC-${suffix.slice(0, 6)}B`,
      `RC-SEC-${suffix.slice(0, 6)}C`,
    ],
  )
  notificationEventsModule.domainEventBus.publish('security.signal', {
    type: 'customer_shipment_created',
    userId: customerRecord.rows[0]!.id,
    occurredAt: new Date().toISOString(),
    evidence: { integrationReplay: true },
  })
  notificationEventsModule.domainEventBus.publish('security.signal', {
    type: 'customer_shipment_created',
    userId: customerRecord.rows[0]!.id,
    occurredAt: new Date().toISOString(),
    evidence: { integrationReplay: true },
  })
  let massRequestEvent:
    | { type: string; severity: string; evidence: { count: number }; matchingEvents: number }
    | undefined
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{
      type: string
      severity: string
      evidence: { count: number }
      matchingEvents: number
    }>(
      `SELECT type, severity::text AS severity, evidence, count(*) OVER ()::int AS "matchingEvents"
       FROM security_events
       WHERE user_id = $1 AND type = 'MASS_SHIPMENT_REQUESTS' ORDER BY created_at DESC LIMIT 1`,
      [customerRecord.rows[0]!.id],
    )
    massRequestEvent = result.rows[0]
    if ((massRequestEvent?.evidence.count ?? 0) >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(massRequestEvent?.severity, 'MEDIUM', 'shipment request bursts create medium alerts')
  assert((massRequestEvent?.evidence.count ?? 0) >= 2, 'repeat request signals aggregate')
  assert.equal(massRequestEvent?.matchingEvents, 1, 'request signals create one deduplicated event')

  await databaseModule.pool.query(
    `INSERT INTO shipment_events (shipment_id, actor_id, status, note)
     SELECT id, $1, 'CANCELLED', 'Integration security burst fixture.'
     FROM shipments WHERE id = ANY($2::uuid[])`,
    [customerRecord.rows[0]!.id, securityShipmentFixtures.rows.map((shipment) => shipment.id)],
  )
  notificationEventsModule.domainEventBus.publish('security.signal', {
    type: 'customer_shipment_cancelled',
    userId: customerRecord.rows[0]!.id,
    occurredAt: new Date().toISOString(),
    evidence: { integrationReplay: true },
  })
  notificationEventsModule.domainEventBus.publish('security.signal', {
    type: 'customer_shipment_cancelled',
    userId: customerRecord.rows[0]!.id,
    occurredAt: new Date().toISOString(),
    evidence: { integrationReplay: true },
  })
  let massCancellationEvent:
    | { type: string; severity: string; evidence: { count: number }; matchingEvents: number }
    | undefined
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{
      type: string
      severity: string
      evidence: { count: number }
      matchingEvents: number
    }>(
      `SELECT type, severity::text AS severity, evidence, count(*) OVER ()::int AS "matchingEvents"
       FROM security_events
       WHERE user_id = $1 AND type = 'MASS_SHIPMENT_CANCELLATIONS'
       ORDER BY created_at DESC LIMIT 1`,
      [customerRecord.rows[0]!.id],
    )
    massCancellationEvent = result.rows[0]
    if ((massCancellationEvent?.evidence.count ?? 0) >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    massCancellationEvent?.severity,
    'MEDIUM',
    'customer cancellation bursts create medium alerts',
  )
  assert((massCancellationEvent?.evidence.count ?? 0) >= 2, 'repeat cancellation signals aggregate')
  assert.equal(
    massCancellationEvent?.matchingEvents,
    1,
    'cancellation signals create one deduplicated event',
  )

  notificationEventsModule.domainEventBus.publish('security.signal', {
    type: 'login_location_changed',
    userId: customerRecord.rows[0]!.id,
    occurredAt: new Date().toISOString(),
    evidence: {
      previousGeolocation: JSON.stringify({ country: 'NG', region: 'LA' }),
      currentGeolocation: JSON.stringify({ country: 'GB', region: 'ENG' }),
      previousLoginAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    },
  })
  let impossibleTravelEvent: { type: string; severity: string } | undefined
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{ type: string; severity: string }>(
      `SELECT type, severity::text AS severity FROM security_events
       WHERE user_id = $1 AND type = 'IMPOSSIBLE_TRAVEL' ORDER BY created_at DESC LIMIT 1`,
      [customerRecord.rows[0]!.id],
    )
    impossibleTravelEvent = result.rows[0]
    if (impossibleTravelEvent) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    impossibleTravelEvent?.severity,
    'HIGH',
    'different country logins in an implausibly short interval create a high event',
  )

  const dispatcherCustomerOptions = await fetch(`${baseUrl}/api/v1/shipments/customers?limit=10`, {
    headers: fleetHeaders(dispatcherToken),
  })
  assert.equal(dispatcherCustomerOptions.status, 200)
  const customerOptionBody = (await dispatcherCustomerOptions.json()) as {
    data: { id: string; name: string; email: string }[]
  }
  assert(customerOptionBody.data.some((customer) => customer.id === customerRecord.rows[0]!.id))
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/shipments/customers`, {
        headers: fleetHeaders(customerTokenForMatrix),
      })
    ).status,
    403,
  )

  const secondShipmentResponse = await fetch(`${baseUrl}/api/v1/shipments`, {
    method: 'POST',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: secondCustomer.rows[0]!.id,
      pickupAddress: 'Second pickup',
      pickup: { lat: 6.5, lng: 3.4 },
      dropoffAddress: 'Second dropoff',
      dropoff: { lat: 6.51, lng: 3.41 },
      weightKg: 1,
    }),
  })
  assert.equal(secondShipmentResponse.status, 201)
  const secondShipment = (await secondShipmentResponse.json()) as { data: { id: string } }
  const customerList = await fetch(`${baseUrl}/api/v1/shipments`, {
    headers: fleetHeaders(customerTokenForMatrix),
  })
  assert.equal(customerList.status, 200)
  const customerListBody = (await customerList.json()) as {
    data: { id: string; customerId: string }[]
  }
  assert(
    customerListBody.data.every((shipment) => shipment.customerId === customerRecord.rows[0]!.id),
  )
  assert(!customerListBody.data.some((shipment) => shipment.id === secondShipment.data.id))
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/shipments/${createdShipment.data.id}`, {
        headers: fleetHeaders(secondCustomerToken),
      })
    ).status,
    403,
  )

  const dispatchShipmentResponse = await fetch(`${baseUrl}/api/v1/shipments`, {
    method: 'POST',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: secondCustomer.rows[0]!.id,
      pickupAddress: 'Dispatch test pickup',
      pickup: { lat: 6.6, lng: 3.35 },
      dropoffAddress: 'Dispatch test dropoff',
      dropoff: { lat: 6.61, lng: 3.36 },
      weightKg: 10,
      priority: 'HIGH',
    }),
  })
  assert.equal(dispatchShipmentResponse.status, 201)
  const dispatchShipment = (await dispatchShipmentResponse.json()) as {
    data: { id: string; status: string }
  }
  const dispatchSuggestionsResponse = await fetch(
    `${baseUrl}/api/v1/dispatch/suggestions?shipmentId=${dispatchShipment.data.id}`,
    { headers: fleetHeaders(dispatcherToken) },
  )
  assert.equal(dispatchSuggestionsResponse.status, 200)
  const dispatchSuggestions = (await dispatchSuggestionsResponse.json()) as {
    data: { driverId: string; distanceM: number; capacityKg: number; lastSeenAt: string }[]
  }
  const closestDispatchDriver = dispatchSuggestions.data[0]
  assert.equal(
    closestDispatchDriver?.driverId,
    shipmentDriverId,
    'the nearest eligible fresh driver should rank first',
  )
  assert(
    Math.abs(closestDispatchDriver.distanceM) < 0.01,
    'PostGIS suggestion distance should match the hand-computed zero-meter pickup distance',
  )
  assert(closestDispatchDriver.capacityKg >= 10, 'suggested vehicle must support shipment weight')
  assert(Date.now() - Date.parse(closestDispatchDriver.lastSeenAt) < 30_000)

  const assignedRealtime = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      dispatchDriverSocket.off('shipment:updated', onUpdate)
      reject(new Error('Assigned driver did not receive the dispatch update in realtime.'))
    }, 5_000)
    const onUpdate = (event: { shipmentId: string; status?: string }) => {
      if (event.shipmentId !== dispatchShipment.data.id || event.status !== 'ASSIGNED') return
      clearTimeout(timer)
      dispatchDriverSocket.off('shipment:updated', onUpdate)
      resolve()
    }
    dispatchDriverSocket.on('shipment:updated', onUpdate)
  })
  const assignmentPayload = JSON.stringify({
    shipmentId: dispatchShipment.data.id,
    driverId: shipmentDriverId,
  })
  const competingAssignments = await Promise.all(
    Array.from({ length: 2 }, () =>
      fetch(`${baseUrl}/api/v1/dispatch/assign`, {
        method: 'POST',
        headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
        body: assignmentPayload,
      }),
    ),
  )
  assert.deepEqual(
    competingAssignments.map((response) => response.status).sort(),
    [200, 409],
    'concurrent dispatchers must produce one assignment and one state conflict',
  )
  await assignedRealtime
  const acceptedDispatch = await fetch(
    `${baseUrl}/api/v1/shipments/${dispatchShipment.data.id}/accept`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
  assert.equal(acceptedDispatch.status, 200, 'assigned driver can accept the job')
  const declinedDispatch = await fetch(
    `${baseUrl}/api/v1/shipments/${dispatchShipment.data.id}/reject`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Driver integration test decline.' }),
    },
  )
  assert.equal(declinedDispatch.status, 200, 'assigned driver can decline and return the job')
  const returnedDispatch = await databaseModule.pool.query<{
    status: string
    driver_id: string | null
  }>('SELECT status::text, driver_id FROM shipments WHERE id = $1', [dispatchShipment.data.id])
  assert.equal(returnedDispatch.rows[0]?.status, 'CREATED')
  assert.equal(returnedDispatch.rows[0]?.driver_id, null)

  const timeoutAssignment = await fetch(`${baseUrl}/api/v1/dispatch/assign`, {
    method: 'POST',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: assignmentPayload,
  })
  assert.equal(timeoutAssignment.status, 200)
  await databaseModule.pool.query(
    `UPDATE shipment_events SET created_at = now() - interval '60 seconds'
     WHERE shipment_id = $1`,
    [dispatchShipment.data.id],
  )
  await databaseModule.pool.query(
    `UPDATE shipment_events SET created_at = now() - interval '31 seconds'
     WHERE id = (
       SELECT id FROM shipment_events
       WHERE shipment_id = $1 AND status = 'ASSIGNED'
       ORDER BY created_at DESC, id DESC LIMIT 1
     )`,
    [dispatchShipment.data.id],
  )
  const shipmentService = await import('../../src/modules/shipments/service.js')
  assert.equal(await shipmentService.requeueTimedOutAssignments(dispatchShipment.data.id), 1)
  const timedOutDispatch = await databaseModule.pool.query<{
    status: string
    driver_id: string | null
    driver_status: string
  }>(
    `SELECT s.status::text, s.driver_id, d.status::text AS driver_status
     FROM shipments s JOIN drivers d ON d.id = $2 WHERE s.id = $1`,
    [dispatchShipment.data.id, shipmentDriverId],
  )
  assert.equal(timedOutDispatch.rows[0]?.status, 'CREATED')
  assert.equal(timedOutDispatch.rows[0]?.driver_id, null)
  assert.equal(timedOutDispatch.rows[0]?.driver_status, 'AVAILABLE')

  const batchVehicle = await databaseModule.pool.query<{ id: string }>(
    `INSERT INTO vehicles (plate, type, capacity_kg)
     VALUES ($1, 'VAN', 350) RETURNING id`,
    [`BAT-${suffix.slice(0, 8)}`],
  )
  await databaseModule.pool.query(
    `UPDATE drivers SET status = 'AVAILABLE', vehicle_id = $2,
       last_known_location = ST_SetSRID(ST_MakePoint(3.4, 6.45), 4326)::geography,
       last_seen_at = now() WHERE id = $1`,
    [secondDriverProfile.rows[0]!.id, batchVehicle.rows[0]!.id],
  )
  await databaseModule.pool.query(
    `INSERT INTO telemetry_points (driver_id, location, accuracy_m, recorded_at, source)
     VALUES ($1, ST_SetSRID(ST_MakePoint(3.4, 6.45), 4326)::geography, 5, now(), 'SIMULATOR')`,
    [secondDriverProfile.rows[0]!.id],
  )
  await databaseModule.pool.query(
    `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
     WHERE driver_id = $1 AND type = 'SIGNAL_LOST' AND status <> 'RESOLVED'`,
    [secondDriverProfile.rows[0]!.id],
  )
  const batchShipmentInputs = [
    { pickupAddress: 'Nearest batch pickup', pickup: { lat: 6.45, lng: 3.4 } },
    { pickupAddress: 'Next batch pickup', pickup: { lat: 6.451, lng: 3.4 } },
  ]
  const batchShipmentIds: string[] = []
  for (const [index, pickup] of batchShipmentInputs.entries()) {
    const created = await fetch(`${baseUrl}/api/v1/shipments`, {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: secondCustomer.rows[0]!.id,
        pickupAddress: pickup.pickupAddress,
        pickup: pickup.pickup,
        dropoffAddress: `Batch dropoff ${index + 1}`,
        dropoff: { lat: 6.46, lng: 3.41 },
        weightKg: 25,
      }),
    })
    assert.equal(created.status, 201)
    const createdBody = (await created.json()) as { data: { id: string } }
    batchShipmentIds.push(createdBody.data.id)
  }
  const batchAssignment = await fetch(`${baseUrl}/api/v1/dispatch/assign-batch`, {
    method: 'POST',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      shipmentIds: [...batchShipmentIds].reverse(),
      driverId: secondDriverProfile.rows[0]!.id,
    }),
  })
  assert.equal(batchAssignment.status, 200, 'qualified drivers can receive a shipment batch')
  const batchAssignmentBody = (await batchAssignment.json()) as {
    data: {
      totalWeightKg: number
      stops: { sequence: number; distanceFromPreviousM: number; shipment: { id: string } }[]
    }
  }
  assert.equal(batchAssignmentBody.data.totalWeightKg, 50)
  assert.deepEqual(
    batchAssignmentBody.data.stops.map((stop) => stop.shipment.id),
    batchShipmentIds,
    'batch stops should follow nearest-neighbor pickup order, independent of request order',
  )
  assert.deepEqual(
    batchAssignmentBody.data.stops.map((stop) => stop.sequence),
    [1, 2],
  )
  assert.equal(batchAssignmentBody.data.stops[0]?.distanceFromPreviousM, 0)
  for (const shipmentId of batchShipmentIds) {
    const canceledBatchStop = await fetch(`${baseUrl}/api/v1/shipments/${shipmentId}/cancel`, {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Integration batch test cleanup.' }),
    })
    assert.equal(canceledBatchStop.status, 200, 'batch test shipment can be safely canceled')
  }

  const rejectedIllegalTransition = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'DELIVERED' }),
    },
  )
  assert.equal(rejectedIllegalTransition.status, 409, 'illegal state transitions return conflict')
  const assignedWithoutDriver = await fetch(
    `${baseUrl}/api/v1/shipments/${secondShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'ASSIGNED' }),
    },
  )
  assert.equal(
    assignedWithoutDriver.status,
    409,
    'dispatcher must select a driver before assignment',
  )

  const assignedDriver = await fetch(`${baseUrl}/api/v1/shipments/${createdShipment.data.id}`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({ driverId: shipmentDriverId }),
  })
  assert.equal(assignedDriver.status, 200)
  const assignedShipment = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'ASSIGNED' }),
    },
  )
  assert.equal(assignedShipment.status, 200)
  const acceptanceDenied = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'ACCEPTED' }),
    },
  )
  assert.equal(acceptanceDenied.status, 409, 'only the assigned driver may accept a shipment')
  const accepted = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'ACCEPTED' }),
    },
  )
  assert.equal(accepted.status, 200)
  const pickedUp = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'PICKED_UP', location: { lat: 6.6, lng: 3.35 } }),
    },
  )
  assert.equal(pickedUp.status, 200, 'nearby driver with recent accurate telemetry may pick up')
  const customerCancelAfterPickup = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/cancel`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(customerTokenForMatrix), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Too late to cancel' }),
    },
  )
  assert.equal(customerCancelAfterPickup.status, 409, 'customers cannot cancel after pickup')
  const postPickupEdit = await fetch(`${baseUrl}/api/v1/shipments/${createdShipment.data.id}`, {
    method: 'PATCH',
    headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'Late edit' }),
  })
  assert.equal(postPickupEdit.status, 409, 'shipment edits stop after pickup')

  const transitionKey = `phase7-${suffix}`
  const inTransitInput = JSON.stringify({ toStatus: 'IN_TRANSIT', note: 'Departed pickup' })
  const inTransit = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: {
        ...fleetHeaders(shipmentDriverToken),
        'content-type': 'application/json',
        'Idempotency-Key': transitionKey,
      },
      body: inTransitInput,
    },
  )
  assert.equal(inTransit.status, 200)
  const firstTransitResult = (await inTransit.json()) as { data: { event: { id: string } } }
  const transitReplay = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: {
        ...fleetHeaders(shipmentDriverToken),
        'content-type': 'application/json',
        'Idempotency-Key': transitionKey,
      },
      body: inTransitInput,
    },
  )
  assert.equal(transitReplay.status, 200)
  const replayResult = (await transitReplay.json()) as { data: { event: { id: string } } }
  assert.equal(replayResult.data.event.id, firstTransitResult.data.event.id)
  const mismatchedReplay = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: {
        ...fleetHeaders(shipmentDriverToken),
        'content-type': 'application/json',
        'Idempotency-Key': transitionKey,
      },
      body: JSON.stringify({ toStatus: 'ARRIVED' }),
    },
  )
  assert.equal(
    mismatchedReplay.status,
    409,
    'an idempotency key cannot be reused for another request',
  )

  for (const nextStatus of ['ARRIVED', 'DELIVERED'] as const) {
    const statusResponse = await fetch(
      `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
      {
        method: 'POST',
        headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
        body: JSON.stringify({ toStatus: nextStatus }),
      },
    )
    assert.equal(statusResponse.status, 200, `assigned driver may transition to ${nextStatus}`)
  }
  const failedDelivery = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(dispatcherToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'FAILED_DELIVERY', note: 'Customer unavailable' }),
    },
  )
  assert.equal(failedDelivery.status, 200)
  const retryTransit = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'IN_TRANSIT' }),
    },
  )
  assert.equal(retryTransit.status, 200)
  const returned = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(shipmentDriverToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'RETURNED' }),
    },
  )
  assert.equal(returned.status, 200)
  const returnedDriverStatus = await databaseModule.pool.query<{ status: string }>(
    'SELECT status::text AS status FROM drivers WHERE id = $1',
    [shipmentDriverId],
  )
  assert.equal(
    returnedDriverStatus.rows[0]?.status,
    'AVAILABLE',
    'terminal shipment releases its driver',
  )
  const shipmentTimeline = await fetch(
    `${baseUrl}/api/v1/shipments/${createdShipment.data.id}/events`,
    {
      headers: fleetHeaders(customerTokenForMatrix),
    },
  )
  assert.equal(shipmentTimeline.status, 200)
  const timelineBody = (await shipmentTimeline.json()) as { data: { status: string }[] }
  assert.deepEqual(
    timelineBody.data.map((event) => event.status),
    [
      'CREATED',
      'ASSIGNED',
      'ACCEPTED',
      'PICKED_UP',
      'IN_TRANSIT',
      'ARRIVED',
      'DELIVERED',
      'FAILED_DELIVERY',
      'IN_TRANSIT',
      'RETURNED',
    ],
  )

  const customerCancellation = await fetch(
    `${baseUrl}/api/v1/shipments/${secondShipment.data.id}/cancel`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(secondCustomerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer changed their mind' }),
    },
  )
  assert.equal(
    customerCancellation.status,
    200,
    'customers can cancel their own request before pickup',
  )
  const cancellationTimeline = await fetch(
    `${baseUrl}/api/v1/shipments/${secondShipment.data.id}/events`,
    {
      headers: fleetHeaders(secondCustomerToken),
    },
  )
  const cancellationEvents = (await cancellationTimeline.json()) as {
    data: { status: string; note: string | null }[]
  }
  assert.equal(cancellationEvents.data.at(-1)?.status, 'CANCELLED')
  assert.equal(cancellationEvents.data.at(-1)?.note, 'Customer changed their mind')
  const transitionAfterCancellation = await fetch(
    `${baseUrl}/api/v1/shipments/${secondShipment.data.id}/transition`,
    {
      method: 'POST',
      headers: { ...fleetHeaders(secondCustomerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'ACCEPTED' }),
    },
  )
  assert.equal(
    transitionAfterCancellation.status,
    409,
    'cancelled shipment transitions are rejected',
  )
  stopShipmentRequestedListener()

  const inactiveVehicle = await fetch(`${baseUrl}/api/v1/vehicles/${fleetVehicleRecord.data.id}`, {
    method: 'DELETE',
    headers: fleetHeaders(adminSession.data.accessToken),
  })
  assert.equal(inactiveVehicle.status, 200)

  for (const [role, token] of [
    ['ADMIN', adminSession.data.accessToken],
    ['DISPATCHER', dispatcherToken],
    ['DRIVER', driverToken],
    ['CUSTOMER', customerTokenForMatrix],
  ] as const) {
    const self = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(self.status, 200, `${role} must be able to access their own profile`)
  }
  for (const token of [customerTokenForMatrix, dispatcherToken, driverToken]) {
    const denied = await fetch(`${baseUrl}/api/v1/users`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(denied.status, 403, 'non-admin roles must be denied administrator user management')
  }
  const adminUserList = await fetch(`${baseUrl}/api/v1/users`, {
    headers: { authorization: `Bearer ${adminSession.data.accessToken}` },
  })
  assert.equal(adminUserList.status, 200)
  for (const [method, path, body] of [
    ['GET', '/api/v1/users', undefined],
    ['GET', `/api/v1/users/${managedDriverBody.data.id}`, undefined],
    ['POST', `/api/v1/users/${managedDriverBody.data.id}/force-password-reset`, undefined],
    ['PATCH', `/api/v1/users/${managedDriverBody.data.id}`, undefined],
    ['DELETE', `/api/v1/users/${managedDriverBody.data.id}`, undefined],
    ['POST', '/api/v1/users', undefined],
  ] as const) {
    for (const [role, token] of [
      ['DISPATCHER', dispatcherToken],
      ['DRIVER', driverToken],
      ['CUSTOMER', customerTokenForMatrix],
    ] as const) {
      const denied = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      assert.equal(denied.status, 403, `${role} must be denied ${method} ${path}`)
    }
  }
  const managedDriverDetail = await fetch(`${baseUrl}/api/v1/users/${managedDriverBody.data.id}`, {
    headers: { authorization: `Bearer ${adminSession.data.accessToken}` },
  })
  assert.equal(managedDriverDetail.status, 200)
  const updatedManagedDriver = await fetch(`${baseUrl}/api/v1/users/${managedDriverBody.data.id}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminSession.data.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Managed Driver Updated' }),
  })
  assert.equal(updatedManagedDriver.status, 200)
  const forcedReset = await fetch(
    `${baseUrl}/api/v1/users/${managedDriverBody.data.id}/force-password-reset`,
    { method: 'POST', headers: { authorization: `Bearer ${adminSession.data.accessToken}` } },
  )
  assert.equal(forcedReset.status, 202)

  const roleAccounts = [
    {
      role: 'ADMIN',
      email: `admin-${suffix}@routecommand.test`,
      password: 'admin-phase4-integration-password',
    },
    {
      role: 'DISPATCHER',
      email: `dispatcher-${suffix}@routecommand.test`,
      password: 'admin-phase4-integration-password',
    },
    {
      role: 'DRIVER',
      email: `driver-${suffix}@routecommand.test`,
      password: 'driver-phase4-integration-password',
    },
    { role: 'CUSTOMER', ...credentials },
  ] as const
  for (const account of roleAccounts) {
    const newPassword = `${account.password}-changed`
    const changedPassword = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${
          account.role === 'ADMIN'
            ? adminSession.data.accessToken
            : account.role === 'DISPATCHER'
              ? dispatcherToken
              : account.role === 'DRIVER'
                ? driverToken
                : customerTokenForMatrix
        }`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: account.password, newPassword }),
    })
    assert.equal(changedPassword.status, 204, `${account.role} may change their own password`)

    const logoutToken = await loginAs(account.email, newPassword)
    const loggedOutRole = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${logoutToken}`,
        'x-requested-with': 'RouteCommand',
      },
    })
    assert.equal(loggedOutRole.status, 204, `${account.role} may log out`)
    assert.equal(
      (
        await fetch(`${baseUrl}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${logoutToken}` },
        })
      ).status,
      401,
      `${account.role} logout must revoke the current session`,
    )

    const logoutAllToken = await loginAs(account.email, newPassword)
    const loggedOutAll = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${logoutAllToken}`,
        'x-requested-with': 'RouteCommand',
      },
    })
    assert.equal(loggedOutAll.status, 204, `${account.role} may revoke all their sessions`)
    assert.equal(
      (
        await fetch(`${baseUrl}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${logoutAllToken}` },
        })
      ).status,
      401,
      `${account.role} logout-all must revoke access immediately`,
    )
  }
  const verifiedPasswordRecipients = await databaseModule.pool.query<{ email: string }>(
    `SELECT email::text AS email FROM users
     WHERE email = ANY($1::citext[]) AND is_active AND email_verified_at IS NOT NULL`,
    [roleAccounts.map((account) => account.email)],
  )
  let passwordNoticeCount = 0
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_logs
       WHERE template = 'security_password_changed' AND status = 'SENT'
         AND recipient_email = ANY($1::citext[])
         AND recipient_email IN (SELECT email FROM users WHERE is_active AND email_verified_at IS NOT NULL)`,
      [roleAccounts.map((account) => account.email)],
    )
    passwordNoticeCount = Number(result.rows[0]?.count ?? 0)
    if (passwordNoticeCount === verifiedPasswordRecipients.rowCount) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    passwordNoticeCount,
    verifiedPasswordRecipients.rowCount,
    'every password change for an active verified account must send a mandatory account email',
  )
  const adminAfterSelfService = await loginAs(
    `admin-${suffix}@routecommand.test`,
    'admin-phase4-integration-password-changed',
  )
  const activeDriverBeforeDeactivation = await loginAs(
    `driver-${suffix}@routecommand.test`,
    'driver-phase4-integration-password-changed',
  )
  const deactivatedDriver = await fetch(`${baseUrl}/api/v1/users/${managedDriverBody.data.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${adminAfterSelfService}` },
  })
  assert.equal(deactivatedDriver.status, 200)
  const inactiveDriverAccess = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${activeDriverBeforeDeactivation}` },
  })
  assert.equal(
    inactiveDriverAccess.status,
    401,
    'deactivation must invalidate active access tokens',
  )
  const offlineDriver = await databaseModule.pool.query<{ status: string }>(
    'SELECT status FROM drivers WHERE user_id = $1',
    [managedDriverBody.data.id],
  )
  assert.equal(offlineDriver.rows[0]?.status, 'OFFLINE')
  assert.equal(adminInsert.rowCount, 1)

  await databaseModule.pool.query('DROP TABLE alerts')
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: fileURLToPath(new URL('../../db/migrations/', import.meta.url)),
    direction: 'down',
    count: 4,
    migrationsTable: 'pgmigrations',
    migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
  })
  const rolledBackIdempotencyTable = await databaseModule.pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.shipment_transition_idempotency') IS NOT NULL AS present`,
  )
  assert.equal(
    rolledBackIdempotencyTable.rows[0]?.present,
    false,
    'migration 004 down removes idempotency storage',
  )
  const rolledBackTelemetryConstraint = await databaseModule.pool.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'telemetry_points_driver_recorded_key'
     ) AS present`,
  )
  assert.equal(
    rolledBackTelemetryConstraint.rows[0]?.present,
    false,
    'migration 005 down removes the telemetry deduplication constraint',
  )
  const missingAlertsAfterRollback = await databaseModule.pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.alerts') IS NOT NULL AS present`,
  )
  assert.equal(
    missingAlertsAfterRollback.rows[0]?.present,
    false,
    'the alert table is absent before the forward schema repair',
  )
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: fileURLToPath(new URL('../../db/migrations/', import.meta.url)),
    direction: 'up',
    count: 4,
    migrationsTable: 'pgmigrations',
    migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
  })
  const reappliedIdempotencyTable = await databaseModule.pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.shipment_transition_idempotency') IS NOT NULL AS present`,
  )
  assert.equal(reappliedIdempotencyTable.rows[0]?.present, true, 'migration 004 reapplies cleanly')
  const reappliedTelemetryConstraint = await databaseModule.pool.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'telemetry_points_driver_recorded_key'
     ) AS present`,
  )
  assert.equal(
    reappliedTelemetryConstraint.rows[0]?.present,
    true,
    'migration 005 reapplies cleanly',
  )
  const repairedAlertsTable = await databaseModule.pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.alerts') IS NOT NULL AS present`,
  )
  assert.equal(
    repairedAlertsTable.rows[0]?.present,
    true,
    'migration 006 restores an alerts table missing from an already-migrated database',
  )

  await databaseModule.pool.query(
    'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE email = $1',
    [credentials.email],
  )
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: credentials.email, password: 'incorrect-password' }),
    })
    assert.equal(failedLogin.status, 401)
  }
  const blockedLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...credentials, password: 'phase-four-test-password-changed' }),
  })
  assert.equal(blockedLogin.status, 401, 'repeated failed attempts must lock out login attempts')
  let accountLockedNoticeCount = 0
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_logs
       WHERE template = 'security_account_locked' AND status = 'SENT'
         AND recipient_email = $1`,
      [credentials.email],
    )
    accountLockedNoticeCount = Number(result.rows[0]?.count ?? 0)
    if (accountLockedNoticeCount > 0) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(accountLockedNoticeCount, 1, 'account lockout must send one mandatory user email')
  let bruteForceAdminEmailCount = 0
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await databaseModule.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM email_logs log
       JOIN notification_events notification ON notification.id = log.notification_event_id
       JOIN security_events event ON event.id = notification.entity_id
       WHERE log.template = 'security_admin_alert' AND event.type = 'BRUTE_FORCE_LOGIN'`,
    )
    bruteForceAdminEmailCount = Number(result.rows[0]?.count ?? 0)
    if (bruteForceAdminEmailCount > 0) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(
    bruteForceAdminEmailCount > 0,
    'a high-severity brute-force event must queue an administrator security email',
  )
  console.info(
    'Phase 4–11A integration checks passed: auth sessions/email, shipment notification dedupe, mandatory password-change and account-lock emails, request/cancellation-burst and impossible-travel security events, brute-force admin email, fleet and shipment rules, dispatch ranking/races/batch ordering, driver realtime accept/decline, assignment timeout requeue, PostGIS drivers/zones, debounced geofences, alert lifecycle/audit, 10k telemetry ingestion/dedupe, telemetry history/metrics, socket auth/rooms/refresh, reconnect snapshots, and migrations 004–007 rollback/reapplication.',
  )
} finally {
  for (const socket of realtimeSockets) socket.disconnect()
  stopNotificationHandlers?.()
  stopSecuritySignalWorker?.()
  stopSecurityEmailHandler?.()
  stopGeofenceWorker?.()
  await stopRealtimeGateway?.()
  if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()))
  await stopTelemetryWorker?.()
  const { closeEmailInfrastructure } = await import('../../src/infra/email-queue.js')
  await closeEmailInfrastructure()
  const [databaseModule, redisModule] = await Promise.all([
    import('../../src/db/pool.js'),
    import('../../src/infra/redis.js'),
  ])
  await Promise.allSettled([databaseModule.closeDatabasePool(), redisModule.closeRedisClients()])
  await Promise.allSettled([mailpit?.stop(), redis?.stop(), postgres?.stop()])
}
