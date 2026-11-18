import type { ShipmentStatus, TelemetryPointInput } from '@routecommand/shared'
import type { NavigationState } from '@routecommand/shared'
import type { NavigationSession } from '../navigation/api/client.js'

const databaseName = 'routecommand-driver-offline'
const databaseVersion = 4
const pointStoreName = 'telemetry-points'
const actionStoreName = 'shipment-actions'
const navigationStoreName = 'navigation-sessions'
const pointLimit = 10_000
export const offlineQueueChangedEvent = 'routecommand:driver-offline-queue-changed'
const backgroundSyncTag = 'routecommand-offline-sync'
let lastBackgroundSyncRequest = 0

export interface QueuedTelemetryPoint {
  id: string
  actorUserId: string
  point: TelemetryPointInput
  queuedAt: string
}

export interface QueuedShipmentAction {
  id: string
  actorUserId: string
  shipmentId: string
  toStatus: ShipmentStatus
  note: string | null
  idempotencyKey: string
  queuedAt: string
  state: 'pending' | 'failed'
  lastError: string | null
}

function notifyQueueChanged() {
  window.dispatchEvent(new Event(offlineQueueChangedEvent))
}

export async function registerOfflineBackgroundSync() {
  if (!('serviceWorker' in navigator)) return
  if (Date.now() - lastBackgroundSyncRequest < 30_000) return
  lastBackgroundSyncRequest = Date.now()
  try {
    const registration = await navigator.serviceWorker.ready
    const syncRegistration = registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> }
    }
    await syncRegistration.sync?.register(backgroundSyncTag)
  } catch {
    // Background Sync is optional; foreground online/reconnect handling remains active.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('Offline storage is not available in this browser.'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(pointStoreName)) {
        const store = database.createObjectStore(pointStoreName, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt')
        store.createIndex('recordedAt', 'point.recordedAt')
        store.createIndex('actorUserId', 'actorUserId')
      } else {
        const store = request.transaction?.objectStore(pointStoreName)
        if (store && !store.indexNames.contains('actorUserId')) {
          store.createIndex('actorUserId', 'actorUserId')
        }
      }
      if (!database.objectStoreNames.contains(actionStoreName)) {
        const store = database.createObjectStore(actionStoreName, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt')
        store.createIndex('actorUserId', 'actorUserId')
        store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true })
      } else {
        const store = request.transaction?.objectStore(actionStoreName)
        if (store && !store.indexNames.contains('idempotencyKey')) {
          store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true })
        }
      }
      if (!database.objectStoreNames.contains(navigationStoreName)) {
        const store = database.createObjectStore(navigationStoreName, { keyPath: 'actorUserId' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open offline storage.'))
    request.onblocked = () => reject(new Error('Offline storage is busy in another tab.'))
  })
}

interface CachedNavigationSession {
  actorUserId: string
  session: NavigationSession
  state?: NavigationState | null
  updatedAt: string
}

export async function cacheNavigationSession(
  session: NavigationSession,
  actorUserId: string,
  state?: NavigationState | null,
): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(navigationStoreName, 'readwrite')
    transaction.objectStore(navigationStoreName).put({
      actorUserId,
      session,
      ...(state === undefined ? {} : { state }),
      updatedAt: new Date().toISOString(),
    } satisfies CachedNavigationSession)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function readCachedNavigationSession(
  actorUserId: string,
): Promise<{ session: NavigationSession; state: NavigationState | null } | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(navigationStoreName, 'readonly')
    const request = transaction.objectStore(navigationStoreName).get(actorUserId)
    const done = transactionDone(transaction)
    const value = await new Promise<CachedNavigationSession | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as CachedNavigationSession | undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not read saved navigation.'))
    })
    await done
    return value ? { session: value.session, state: value.state ?? null } : null
  } finally {
    database.close()
  }
}

export async function clearCachedNavigationSession(actorUserId: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(navigationStoreName, 'readwrite')
    transaction.objectStore(navigationStoreName).delete(actorUserId)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Offline storage write failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Offline storage write failed.'))
  })
}

export async function countQueuedTelemetry(actorUserId: string): Promise<number> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(pointStoreName, 'readonly')
    const request = transaction.objectStore(pointStoreName).index('actorUserId').count(actorUserId)
    const done = transactionDone(transaction)
    const count = await new Promise<number>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not count offline updates.'))
    })
    await done
    return count
  } finally {
    database.close()
  }
}

export async function queueTelemetryPoint(
  point: TelemetryPointInput,
  actorUserId: string,
): Promise<number> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(pointStoreName, 'readwrite')
    const store = transaction.objectStore(pointStoreName)
    const request = store.index('actorUserId').count(actorUserId)
    const done = transactionDone(transaction)
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const currentCount = request.result
        store.put({
          id: crypto.randomUUID(),
          actorUserId,
          point,
          queuedAt: new Date().toISOString(),
        })
        if (currentCount >= pointLimit) {
          const allRequest = store.index('actorUserId').getAll(actorUserId)
          allRequest.onsuccess = () => {
            const points = allRequest.result as QueuedTelemetryPoint[]
            points.sort(
              (first, second) =>
                Date.parse(first.point.recordedAt) - Date.parse(second.point.recordedAt),
            )
            const oldestWindow = Math.max(2, Math.ceil(points.length * 0.1))
            for (let index = 0; index < oldestWindow; index += 2) {
              const item = points[index]
              if (item) store.delete(item.id)
            }
            resolve()
          }
          allRequest.onerror = () =>
            reject(allRequest.error ?? new Error('Could not compact offline updates.'))
        } else {
          resolve()
        }
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Could not prepare offline storage.'))
    })
    await done
    const count = await countQueuedTelemetry(actorUserId)
    notifyQueueChanged()
    void registerOfflineBackgroundSync()
    return count
  } finally {
    database.close()
  }
}

export async function readQueuedTelemetry(
  actorUserId: string,
  limit = 500,
): Promise<QueuedTelemetryPoint[]> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(pointStoreName, 'readonly')
    const index = transaction.objectStore(pointStoreName).index('recordedAt')
    const request = index.openCursor()
    const done = transactionDone(transaction)
    const points = await new Promise<QueuedTelemetryPoint[]>((resolve, reject) => {
      const entries: QueuedTelemetryPoint[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || entries.length >= limit) {
          resolve(entries)
          return
        }
        const entry = cursor.value as QueuedTelemetryPoint
        if (entry.actorUserId === actorUserId) entries.push(entry)
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read offline updates.'))
    })
    await done
    return points
  } finally {
    database.close()
  }
}

export async function removeQueuedTelemetry(ids: string[], actorUserId: string): Promise<number> {
  if (ids.length === 0) return countQueuedTelemetry(actorUserId)
  const database = await openDatabase()
  try {
    const transaction = database.transaction(pointStoreName, 'readwrite')
    const store = transaction.objectStore(pointStoreName)
    for (const id of ids) store.delete(id)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
  notifyQueueChanged()
  return countQueuedTelemetry(actorUserId)
}

export async function queueShipmentAction(
  action: Omit<QueuedShipmentAction, 'id' | 'queuedAt' | 'state' | 'lastError'>,
): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readwrite')
    const store = transaction.objectStore(actionStoreName)
    const existing = store.index('idempotencyKey').get(action.idempotencyKey)
    const done = transactionDone(transaction)
    existing.onsuccess = () => {
      if (existing.result) return
      store.put({
        ...action,
        id: crypto.randomUUID(),
        queuedAt: new Date().toISOString(),
        state: 'pending',
        lastError: null,
      } satisfies QueuedShipmentAction)
    }
    existing.onerror = () => transaction.abort()
    await done
  } finally {
    database.close()
  }
  notifyQueueChanged()
  void registerOfflineBackgroundSync()
}

export async function readQueuedShipmentActions(
  actorUserId: string,
): Promise<QueuedShipmentAction[]> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readonly')
    const request = transaction.objectStore(actionStoreName).index('queuedAt').openCursor()
    const done = transactionDone(transaction)
    const actions = await new Promise<QueuedShipmentAction[]>((resolve, reject) => {
      const results: QueuedShipmentAction[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(results)
          return
        }
        const action = cursor.value as QueuedShipmentAction
        if (action.actorUserId === actorUserId && action.state === 'pending') results.push(action)
        cursor.continue()
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Could not read queued job actions.'))
    })
    await done
    return actions
  } finally {
    database.close()
  }
}

export async function countQueuedShipmentActions(actorUserId?: string): Promise<number> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readonly')
    const request = transaction.objectStore(actionStoreName).getAll()
    const done = transactionDone(transaction)
    const actions = await new Promise<QueuedShipmentAction[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as QueuedShipmentAction[])
      request.onerror = () =>
        reject(request.error ?? new Error('Could not count queued job actions.'))
    })
    await done
    return actorUserId
      ? actions.filter((action) => action.actorUserId === actorUserId).length
      : actions.length
  } finally {
    database.close()
  }
}

export async function getQueuedShipmentActionCounts(
  actorUserId: string,
): Promise<{ pending: number; failed: number }> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readonly')
    const request = transaction
      .objectStore(actionStoreName)
      .index('actorUserId')
      .getAll(actorUserId)
    const done = transactionDone(transaction)
    const actions = await new Promise<QueuedShipmentAction[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as QueuedShipmentAction[])
      request.onerror = () =>
        reject(request.error ?? new Error('Could not count queued job actions.'))
    })
    await done
    return {
      pending: actions.filter((action) => action.state === 'pending').length,
      failed: actions.filter((action) => action.state === 'failed').length,
    }
  } finally {
    database.close()
  }
}

export async function readFailedShipmentActions(
  actorUserId: string,
): Promise<QueuedShipmentAction[]> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readonly')
    const request = transaction.objectStore(actionStoreName).index('queuedAt').openCursor()
    const done = transactionDone(transaction)
    const actions = await new Promise<QueuedShipmentAction[]>((resolve, reject) => {
      const results: QueuedShipmentAction[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(results)
          return
        }
        const action = cursor.value as QueuedShipmentAction
        if (action.actorUserId === actorUserId && action.state === 'failed') results.push(action)
        cursor.continue()
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Could not read failed job actions.'))
    })
    await done
    return actions
  } finally {
    database.close()
  }
}

export async function clearFailedShipmentActions(actorUserId: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readwrite')
    const index = transaction.objectStore(actionStoreName).index('actorUserId')
    const request = index.openCursor(IDBKeyRange.only(actorUserId))
    const done = transactionDone(transaction)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const action = cursor.value as QueuedShipmentAction
      if (action.state === 'failed') cursor.delete()
      cursor.continue()
    }
    request.onerror = () => transaction.abort()
    await done
  } finally {
    database.close()
  }
  notifyQueueChanged()
}

export async function markShipmentActionFailed(id: string, message: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readwrite')
    const store = transaction.objectStore(actionStoreName)
    const done = transactionDone(transaction)
    const request = store.get(id)
    request.onsuccess = () => {
      const action = request.result as QueuedShipmentAction | undefined
      if (action) store.put({ ...action, state: 'failed', lastError: message })
    }
    request.onerror = () => transaction.abort()
    await done
  } finally {
    database.close()
  }
  notifyQueueChanged()
}

export async function removeQueuedShipmentAction(id: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(actionStoreName, 'readwrite')
    transaction.objectStore(actionStoreName).delete(id)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
  notifyQueueChanged()
}
