import { createLocalId } from '../core/ids.js';
import { MOVEMENT_TYPES, stockDeltaForMovement } from '../core/movementTypes.js';
import {
  STORES,
  get,
  getAllByIndex,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { calculateStock } from './stockEngine.js';

export async function createMovement(data = {}) {
  const product = await get(STORES.PRODUCTS, data.productId);
  if (!product) throw new Error('Producto no encontrado');

  const movement = buildMovement(data);
  stockDeltaForMovement(movement);

  const syncItem = buildSyncItem(movement);

  await runTransaction(
    [STORES.MOVEMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (movementStore, queueStore) => {
      await requestToPromise(movementStore.add(movement));
      await requestToPromise(queueStore.add(syncItem));
    }
  );

  return movement;
}

export async function reverseMovement(movementId, metadata = {}) {
  const original = await get(STORES.MOVEMENTS, movementId);
  if (!original) throw new Error('Movimiento original no encontrado');
  if (original.type === MOVEMENT_TYPES.REVERSAL) {
    throw new Error('No se puede reversar un reverso directamente');
  }

  const existingReversals = await getAllByIndex(
    STORES.MOVEMENTS,
    'reversedMovementId',
    movementId
  );

  if (existingReversals.length > 0) {
    throw new Error('Este movimiento ya fue reversado');
  }

  const originalDelta = stockDeltaForMovement(original);

  return createMovement({
    productId: original.productId,
    type: MOVEMENT_TYPES.REVERSAL,
    quantity: Math.abs(originalDelta),
    delta: -originalDelta,
    documentId: metadata.documentId || original.documentId || null,
    lotId: original.lotId || null,
    locationId: original.locationId || null,
    userId: metadata.userId || null,
    reversedMovementId: original.id,
    metadata: {
      reason: metadata.reason || 'Corrección de movimiento',
      originalMovementId: original.id
    }
  });
}

export async function getProductMovements(productId) {
  const movements = await getAllByIndex(STORES.MOVEMENTS, 'productId', productId);
  return movements.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getCurrentStock(productId, options = {}) {
  const movements = await getProductMovements(productId);
  return calculateStock(movements, productId, options);
}

function buildMovement(data) {
  const type = data.type;
  if (!Object.values(MOVEMENT_TYPES).includes(type)) {
    throw new Error('Tipo de movimiento inválido');
  }

  const quantity = Number(data.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Cantidad inválida');
  }

  if (
    type !== MOVEMENT_TYPES.ADJUSTMENT &&
    type !== MOVEMENT_TYPES.REVERSAL &&
    quantity <= 0
  ) {
    throw new Error('La cantidad debe ser mayor que cero');
  }

  const now = new Date().toISOString();

  return {
    id: data.id || createLocalId('mov'),
    productId: data.productId,
    type,
    quantity,
    delta: data.delta !== undefined ? Number(data.delta) : undefined,
    documentId: data.documentId || null,
    lotId: data.lotId || null,
    locationId: data.locationId || null,
    userId: data.userId || null,
    reversedMovementId: data.reversedMovementId || null,
    metadata: data.metadata || {},
    createdAt: data.createdAt || now,
    syncedAt: null
  };
}

function buildSyncItem(movement) {
  const now = new Date().toISOString();
  return {
    id: createLocalId('sync'),
    entityType: 'movement',
    entityId: movement.id,
    operation: 'CREATE',
    payload: movement,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null
  };
}
