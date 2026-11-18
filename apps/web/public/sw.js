const shellCache = 'routecommand-shell-v1'
const assetCache = 'routecommand-assets-v1'
const tileCache = 'routecommand-map-tiles-v1'
const shellFiles = [
  '/',
  '/manifest.webmanifest',
  '/icons/routecommand-192.svg',
  '/icons/routecommand-512.svg',
]
const maxAssetEntries = 100
const maxTileEntries = 200
const offlineDatabaseName = 'routecommand-driver-offline'
const offlineDatabaseVersion = 3
const telemetryStoreName = 'telemetry-points'
const actionStoreName = 'shipment-actions'
const apiBase = (
  new URL(self.location.href).searchParams.get('apiBase') || self.location.origin
).replace(/\/+$/, '')

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(shellCache).then((cache) => cache.addAll(shellFiles)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith('routecommand-') && ![shellCache, assetCache, tileCache].includes(key),
          )
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    }),
  )
})

async function trimCache(cacheName, maximum) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  const remove = Math.max(0, keys.length - maximum)
  await Promise.all(keys.slice(0, remove).map((request) => cache.delete(request)))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/')) || Response.error()),
    )
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(assetCache).then(async (cache) => {
        const cached = await cache.match(request)
        const update = fetch(request)
          .then(async (response) => {
            if (response.ok) {
              await cache.put(request, response.clone())
              await trimCache(assetCache, maxAssetEntries)
            }
            return response
          })
          .catch(() => cached || Response.error())
        return cached || update
      }),
    )
    return
  }

  const isMapTile = /\/\d+\/\d+\/\d+\.(png|jpe?g|webp|pbf)$/i.test(url.pathname)
  if (isMapTile) {
    event.respondWith(
      caches.open(tileCache).then(async (cache) => {
        const cached = await cache.match(request)
        try {
          const response = await fetch(request)
          if (response.ok || response.type === 'opaque') {
            await cache.put(request, response.clone())
            await trimCache(tileCache, maxTileEntries)
          }
          return response
        } catch {
          return cached || Response.error()
        }
      }),
    )
  }
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'routecommand-offline-sync') {
    event.waitUntil(syncOfflineQueue())
  }
})

function openOfflineDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineDatabaseName, offlineDatabaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(telemetryStoreName)) {
        const store = database.createObjectStore(telemetryStoreName, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt')
        store.createIndex('recordedAt', 'point.recordedAt')
        store.createIndex('actorUserId', 'actorUserId')
      } else {
        const store = request.transaction.objectStore(telemetryStoreName)
        if (!store.indexNames.contains('actorUserId')) {
          store.createIndex('actorUserId', 'actorUserId')
        }
      }
      if (!database.objectStoreNames.contains(actionStoreName)) {
        const store = database.createObjectStore(actionStoreName, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt')
        store.createIndex('actorUserId', 'actorUserId')
        store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline database unavailable'))
  })
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error || new Error('Offline transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error || new Error('Offline transaction aborted'))
  })
}

async function readTelemetryBatch(database, userId, maximum) {
  const transaction = database.transaction(telemetryStoreName, 'readonly')
  const cursorRequest = transaction.objectStore(telemetryStoreName).index('recordedAt').openCursor()
  const complete = transactionComplete(transaction)
  const records = await new Promise((resolve, reject) => {
    const entries = []
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor || entries.length >= maximum) {
        resolve(entries)
        return
      }
      if (cursor.value.actorUserId === userId) entries.push(cursor.value)
      cursor.continue()
    }
    cursorRequest.onerror = () =>
      reject(cursorRequest.error || new Error('Could not read telemetry queue'))
  })
  await complete
  return records
}

async function removeTelemetryBatch(database, ids) {
  const transaction = database.transaction(telemetryStoreName, 'readwrite')
  const complete = transactionComplete(transaction)
  const store = transaction.objectStore(telemetryStoreName)
  ids.forEach((id) => store.delete(id))
  await complete
}

async function readPendingActions(database, userId) {
  const transaction = database.transaction(actionStoreName, 'readonly')
  const cursorRequest = transaction.objectStore(actionStoreName).index('queuedAt').openCursor()
  const complete = transactionComplete(transaction)
  const records = await new Promise((resolve, reject) => {
    const actions = []
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        resolve(actions)
        return
      }
      const action = cursor.value
      if (action.actorUserId === userId && action.state === 'pending') actions.push(action)
      cursor.continue()
    }
    cursorRequest.onerror = () =>
      reject(cursorRequest.error || new Error('Could not read job queue'))
  })
  await complete
  return records
}

async function deleteAction(database, id) {
  const transaction = database.transaction(actionStoreName, 'readwrite')
  const complete = transactionComplete(transaction)
  transaction.objectStore(actionStoreName).delete(id)
  await complete
}

async function failAction(database, action, message) {
  const transaction = database.transaction(actionStoreName, 'readwrite')
  const complete = transactionComplete(transaction)
  transaction.objectStore(actionStoreName).put({ ...action, state: 'failed', lastError: message })
  await complete
}

async function refreshDriverSession() {
  const refresh = async () => {
    const response = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'RouteCommand',
      },
    })
    if (!response.ok) throw new Error('The saved driver session could not be refreshed.')
    const payload = await response.json()
    const user = payload?.data?.user
    const accessToken = payload?.data?.accessToken
    if (user?.role !== 'DRIVER' || typeof user.id !== 'string' || typeof accessToken !== 'string') {
      throw new Error('A valid driver session is required to sync offline changes.')
    }
    return { userId: user.id, accessToken }
  }
  return self.navigator.locks
    ? self.navigator.locks.request('routecommand-refresh-token', refresh)
    : refresh()
}

async function syncOfflineQueue() {
  const database = await openOfflineDatabase()
  try {
    const { userId, accessToken } = await refreshDriverSession()
    while (true) {
      const entries = await readTelemetryBatch(database, userId, 500)
      if (entries.length === 0) break
      const response = await fetch(`${apiBase}/api/v1/telemetry/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ points: entries.map((entry) => entry.point) }),
      })
      if (!response.ok) throw new Error('Offline location updates could not be uploaded.')
      await removeTelemetryBatch(
        database,
        entries.map((entry) => entry.id),
      )
    }

    const actions = await readPendingActions(database, userId)
    for (const action of actions) {
      const response = await fetch(
        `${apiBase}/api/v1/shipments/${encodeURIComponent(action.shipmentId)}/transition`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'Idempotency-Key': action.idempotencyKey,
          },
          body: JSON.stringify({
            toStatus: action.toStatus,
            ...(action.note ? { note: action.note } : {}),
          }),
        },
      )
      if (response.ok) {
        await deleteAction(database, action.id)
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 401 &&
        response.status !== 403
      ) {
        const payload = await response.json().catch(() => null)
        await failAction(
          database,
          action,
          payload?.error?.message || 'This saved job update needs review.',
        )
      } else {
        throw new Error('Offline job updates could not be synchronized.')
      }
    }
  } finally {
    database.close()
  }
}
