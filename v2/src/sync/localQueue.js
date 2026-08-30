import { createLocalId } from '../core/ids.js';
import { STORES, put, getAll, runTransaction } from '../storage/database.js';

export const SYNC_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED'
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

export async function markFailed(id, error) {
  return updateQueueItem(id, item => ({
    ...item,
    status: SYNC_STATUS.FAILED,
    updatedAt: new Date().toISOString(),
    lastError: String(error?.message || error || 'Error desconocido')
  }));
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
