import { createLocalId } from '../core/ids.js';
import { nextEntityVersion } from '../core/versioning.js';
import {
  STORES,
  get,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from './localQueue.js';

const ENTITY_STORES = Object.freeze({
  product: STORES.PRODUCTS,
  category: STORES.CATEGORIES,
  supplier: STORES.SUPPLIERS,
  location: STORES.LOCATIONS,
  document: STORES.DOCUMENTS,
  documentLine: STORES.DOCUMENT_LINES,
  lot: STORES.LOTS,
  replenishment: STORES.REPLENISHMENTS
});

export async function acceptServerConflict(conflictId) {
  const conflict = await get(STORES.SYNC_QUEUE, conflictId);
  assertConflict(conflict);

  const storeName = ENTITY_STORES[conflict.entityType];
  if (!storeName) {
    throw new Error('Este conflicto no admite resolución automática');
  }

  const serverEntity = await get(storeName, conflict.entityId);
  assertCanonicalServerState(conflict, serverEntity);

  await runTransaction(
    STORES.SYNC_QUEUE,
    'readwrite',
    queueStore => requestToPromise(queueStore.delete(conflictId))
  );

  return {
    resolution: 'SERVER',
    entity: serverEntity
  };
}

export async function reapplyLocalConflict(conflictId) {
  const conflict = await get(STORES.SYNC_QUEUE, conflictId);
  assertConflict(conflict);

  const storeName = ENTITY_STORES[conflict.entityType];
  if (!storeName) {
    throw new Error('Este conflicto no admite reaplicación');
  }

  const serverEntity = await get(storeName, conflict.entityId);
  assertCanonicalServerState(conflict, serverEntity);

  const now = new Date().toISOString();
  const rebased = {
    ...serverEntity,
    ...(conflict.payload || {}),
    id: serverEntity.id,
    version: nextEntityVersion(serverEntity),
    updatedAt: now
  };

  const newSyncItem = {
    id: createLocalId('sync'),
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    operation: 'UPDATE',
    payload: rebased,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null,
    rebasedFromConflictId: conflict.id
  };

  await runTransaction(
    [storeName, STORES.SYNC_QUEUE],
    'readwrite',
    async (entityStore, queueStore) => {
      await requestToPromise(entityStore.put(rebased));
      await requestToPromise(queueStore.add(newSyncItem));
      await requestToPromise(queueStore.delete(conflict.id));
    }
  );

  return {
    resolution: 'LOCAL_REAPPLIED',
    entity: rebased,
    syncItem: newSyncItem
  };
}

function assertConflict(item) {
  if (!item) throw new Error('Conflicto no encontrado');
  if (item.status !== SYNC_STATUS.CONFLICT) {
    throw new Error('La operación ya no está en conflicto');
  }
}

function assertCanonicalServerState(conflict, entity) {
  if (!entity) {
    throw new Error(
      'No se ha descargado todavía el estado actual del servidor'
    );
  }

  const serverVersion = Number(conflict.conflict?.serverVersion);
  const localVersion = Number(entity.version);

  if (
    Number.isInteger(serverVersion) &&
    serverVersion > 0 &&
    localVersion !== serverVersion
  ) {
    throw new Error(
      'Sincroniza nuevamente antes de resolver este conflicto'
    );
  }
}
