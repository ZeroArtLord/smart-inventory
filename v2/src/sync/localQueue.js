import { createLocalId } from '../core/ids.js';
import { STORES, put, getAll, runTransaction } from '../storage/database.js';

export const SYNC_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  CONFLICT: 'CONFLICT'
});

export async function enqueueSyncOperation({ entityType, entityId, operation, payload }) {
  const now = new Date().toISOString();
  const item = {
    id: createLocalId('sync'),
    entityType,
    entityId,
    operation,
    payload,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null
  };

  await put(STORES.SYNC_QUEUE, item);
  return item;
}

export async function listPendingOperations() {
  const items = await getAll(STORES.SYNC_QUEUE);
  return items
    .filter(item => item.status === SYNC_STATUS.PENDING || item.status === SYNC_STATUS.FAILED)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function recoverInterruptedOperations({ olderThanMs = 30000 } = {}) {
  const items = await getAll(STORES.SYNC_QUEUE);
  const now = Date.now();
  const interrupted = items.filter(item => {
    if (item.status !== SYNC_STATUS.SYNCING) return false;
    const updatedAt = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return !Number.isFinite(updatedAt) || (now - updatedAt) >= olderThanMs;
  });

  for (const item of interrupted) {
    await updateQueueItem(item.id, current => ({
      ...current,
      status: SYNC_STATUS.PENDING,
      updatedAt: new Date().toISOString(),
      lastError: 'Sincronización interrumpida; se reintentará.'
    }));
  }

  return interrupted.length;
}

export async function markSyncing(id) {
  return updateQueueItem(id, item => ({
    ...item,
    status: SYNC_STATUS.SYNCING,
    attempts: (item.attempts || 0) + 1,
    updatedAt: new Date().toISOString()
  }));
}

export async function markSynced(id) {
  return updateQueueItem(id, item => ({
    ...item,
    status: SYNC_STATUS.SYNCED,
    updatedAt: new Date().toISOString(),
    lastError: null
  }));
}

export async function markPending(id, message = null) {
  return updateQueueItem(id, item => ({
    ...item,
    status: SYNC_STATUS.PENDING,
    updatedAt: new Date().toISOString(),
    lastError: message
  }));
}

export async function markConflict(id, details = {}) {
  return updateQueueItem(id, item => ({
    ...item,
    status: SYNC_STATUS.CONFLICT,
    updatedAt: new Date().toISOString(),
    lastError: details.message || 'Conflicto de sincronización',
    conflict: {
      entityType: details.entityType || item.entityType,
      entityId: details.entityId || item.entityId,
      serverVersion: details.serverVersion ?? null,
      clientVersion: details.clientVersion ?? item.payload?.version ?? null,
      reason: details.reason || 'STALE_WRITE',
      detectedAt: new Date().toISOString()
    }
  }));
}

export async function listSyncConflicts() {
  const items = await getAll(STORES.SYNC_QUEUE);
  return items
    .filter(item => item.status === SYNC_STATUS.CONFLICT)
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
}

export async function markFailed(id, error) {
  return updateQueueItem(id, item => ({
    ...item,
    status: SYNC_STATUS.FAILED,
    updatedAt: new Date().toISOString(),
    lastError: String(error?.message || error || 'Error desconocido')
  }));
}

export async function pruneSyncedOperations({ keepLatest = 250 } = {}) {
  const items = await getAll(STORES.SYNC_QUEUE);
  const synced = items
    .filter(item => item.status === SYNC_STATUS.SYNCED)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const toDelete = synced.slice(keepLatest);
  if (toDelete.length === 0) return 0;

  await runTransaction(STORES.SYNC_QUEUE, 'readwrite', store => {
    toDelete.forEach(item => store.delete(item.id));
  });

  return toDelete.length;
}

async function updateQueueItem(id, updater) {
  return runTransaction(STORES.SYNC_QUEUE, 'readwrite', store => {
    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const current = getRequest.result;
        if (!current) {
          reject(new Error('Operación de sincronización no encontrada'));
          return;
        }

        const updated = updater(current);
        const putRequest = store.put(updated);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => resolve(updated);
      };
    });
  });
}
