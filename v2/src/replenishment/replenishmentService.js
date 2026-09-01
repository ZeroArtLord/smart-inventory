import { createLocalId } from '../core/ids.js';
import {
  initialEntityVersion,
  nextEntityVersion
} from '../core/versioning.js';
import {
  REPLENISHMENT_METHODS,
  normalizeText
} from '../core/catalog.js';
import {
  STORES,
  get,
  getAll,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';

export const REPLENISHMENT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ORDERED: 'ORDERED',
  IN_TRANSIT: 'IN_TRANSIT',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED'
});

const PENDING_STATUSES = new Set([
  REPLENISHMENT_STATUS.ORDERED,
  REPLENISHMENT_STATUS.IN_TRANSIT,
  REPLENISHMENT_STATUS.PARTIALLY_RECEIVED
]);

const TRANSITIONS = Object.freeze({
  [REPLENISHMENT_STATUS.DRAFT]: new Set([
    REPLENISHMENT_STATUS.ORDERED,
    REPLENISHMENT_STATUS.CANCELLED
  ]),
  [REPLENISHMENT_STATUS.ORDERED]: new Set([
    REPLENISHMENT_STATUS.IN_TRANSIT,
    REPLENISHMENT_STATUS.PARTIALLY_RECEIVED,
    REPLENISHMENT_STATUS.RECEIVED,
    REPLENISHMENT_STATUS.CANCELLED
  ]),
  [REPLENISHMENT_STATUS.IN_TRANSIT]: new Set([
    REPLENISHMENT_STATUS.PARTIALLY_RECEIVED,
    REPLENISHMENT_STATUS.RECEIVED,
    REPLENISHMENT_STATUS.CANCELLED
  ]),
  [REPLENISHMENT_STATUS.PARTIALLY_RECEIVED]: new Set([
    REPLENISHMENT_STATUS.PARTIALLY_RECEIVED,
    REPLENISHMENT_STATUS.RECEIVED,
    REPLENISHMENT_STATUS.CANCELLED
  ]),
  [REPLENISHMENT_STATUS.RECEIVED]: new Set(),
  [REPLENISHMENT_STATUS.CANCELLED]: new Set()
});

export async function createReplenishment(data = {}) {
  const product = await get(STORES.PRODUCTS, data.productId);
  if (!product) throw new Error('Producto no encontrado');
  if (product.active === false) throw new Error('El producto está inactivo');

  const method = normalizeMethod(data.method, product.replenishmentMethod);
  assertMethodAllowed(product.replenishmentMethod, method);

  const requestedQuantity = positiveNumber(
    data.requestedQuantity ?? data.quantity,
    'Cantidad solicitada'
  );

  const now = new Date().toISOString();
  const replenishment = {
    id: data.id || createLocalId('rep'),
    productId: product.id,
    productName: product.name,
    supplierId: data.supplierId || product.supplierId || null,
    method,
    status: REPLENISHMENT_STATUS.DRAFT,
    requestedQuantity,
    receivedQuantity: 0,
    pendingQuantity: requestedQuantity,
    expectedAt: normalizeOptionalDate(data.expectedAt),
    reference: normalizeText(data.reference),
    notes: normalizeText(data.notes),
    ownerId: data.ownerId || null,
    sourceSuggestion: data.sourceSuggestion || null,
    receiptDocuments: [],
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeWithSync(replenishment, 'CREATE');
  return replenishment;
}

export async function changeReplenishmentStatus(
  replenishmentId,
  status,
  { userId = null, expectedAt = undefined, reference = undefined } = {}
) {
  const current = await get(STORES.REPLENISHMENTS, replenishmentId);
  if (!current) throw new Error('Compra/pedido no encontrado');

  if (!Object.values(REPLENISHMENT_STATUS).includes(status)) {
    throw new Error('Estado de compra/pedido inválido');
  }

  const allowed = TRANSITIONS[current.status] || new Set();
  if (!allowed.has(status)) {
    throw new Error(
      `Transición no permitida: ${current.status} → ${status}`
    );
  }

  const now = new Date().toISOString();
  const updated = {
    ...current,
    status,
    version: nextEntityVersion(current),
    updatedAt: now,
    updatedBy: userId || null
  };

  if (expectedAt !== undefined) {
    updated.expectedAt = normalizeOptionalDate(expectedAt);
  }

  if (reference !== undefined) {
    updated.reference = normalizeText(reference);
  }

  if (
    status === REPLENISHMENT_STATUS.ORDERED ||
    status === REPLENISHMENT_STATUS.IN_TRANSIT
  ) {
    updated.orderedAt = current.orderedAt || now;
  }

  if (status === REPLENISHMENT_STATUS.RECEIVED) {
    if (Number(current.pendingQuantity || 0) > 0) {
      throw new Error(
        'No se puede marcar recibido mientras quede cantidad pendiente'
      );
    }
    updated.receivedAt = current.receivedAt || now;
  }

  if (status === REPLENISHMENT_STATUS.CANCELLED) {
    updated.cancelledAt = now;
  }

  await writeWithSync(updated, 'UPDATE');
  return updated;
}

export async function registerReplenishmentReceipt(
  replenishmentId,
  {
    quantity,
    entryDocumentId,
    userId = null
  } = {}
) {
  const receivedNow = positiveNumber(quantity, 'Cantidad recibida');
  if (!entryDocumentId) {
    throw new Error('La recepción debe vincularse a una Entrada');
  }

  return runTransaction(
    [STORES.REPLENISHMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (replenishmentStore, queueStore) => {
      const current = await requestToPromise(
        replenishmentStore.get(replenishmentId)
      );

      if (!current) throw new Error('Compra/pedido no encontrado');

      if (!PENDING_STATUSES.has(current.status)) {
        throw new Error(
          'La compra/pedido no está en un estado que admita recepción'
        );
      }

      const existingReceipt = (current.receiptDocuments || []).find(
        receipt => receipt.entryDocumentId === entryDocumentId
      );

      if (existingReceipt) {
        return current;
      }

      const pending = Number(current.pendingQuantity || 0);
      if (receivedNow > pending) {
        throw new Error(
          `Se intentan recibir ${receivedNow}, pero solo quedan ${pending} pendientes`
        );
      }

      const now = new Date().toISOString();
      const receivedQuantity =
        Number(current.receivedQuantity || 0) + receivedNow;
      const pendingQuantity =
        Math.max(0, Number(current.requestedQuantity) - receivedQuantity);
      const status = pendingQuantity === 0
        ? REPLENISHMENT_STATUS.RECEIVED
        : REPLENISHMENT_STATUS.PARTIALLY_RECEIVED;

      const updated = {
        ...current,
        receivedQuantity,
        pendingQuantity,
        status,
        version: nextEntityVersion(current),
        receivedAt: status === REPLENISHMENT_STATUS.RECEIVED
          ? now
          : current.receivedAt || null,
        updatedAt: now,
        updatedBy: userId || null,
        receiptDocuments: [
          ...(current.receiptDocuments || []),
          {
            entryDocumentId,
            quantity: receivedNow,
            receivedAt: now,
            receivedBy: userId || null
          }
        ]
      };

      await requestToPromise(replenishmentStore.put(updated));
      await requestToPromise(
        queueStore.add(
          createSyncItem(
            'replenishment',
            updated.id,
            'UPDATE',
            updated
          )
        )
      );

      return updated;
    }
  );
}

export async function reconcileReplenishmentReceipts() {
  const [documents, movements, replenishments] = await Promise.all([
    getAll(STORES.DOCUMENTS),
    getAll(STORES.MOVEMENTS),
    getAll(STORES.REPLENISHMENTS)
  ]);

  const replenishmentById = new Map(
    replenishments.map(item => [item.id, item])
  );

  const results = [];

  for (const document of documents) {
    if (document.type !== 'ENTRY' || document.status !== 'CLOSED') continue;

    const replenishmentId = document.metadata?.replenishmentId;
    if (!replenishmentId) continue;

    const item = replenishmentById.get(replenishmentId);
    if (!item) continue;

    const alreadyRegistered = (item.receiptDocuments || []).some(
      receipt => receipt.entryDocumentId === document.id
    );
    if (alreadyRegistered) continue;

    const quantity = movements
      .filter(movement => movement.documentId === document.id)
      .filter(movement => movement.type === 'ENTRY')
      .filter(movement => movement.productId === item.productId)
      .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);

    if (!(quantity > 0)) continue;

    const updated = await registerReplenishmentReceipt(
      replenishmentId,
      {
        quantity,
        entryDocumentId: document.id,
        userId: document.closedBy || document.ownerId || null
      }
    );

    replenishmentById.set(replenishmentId, updated);
    results.push({
      replenishmentId,
      entryDocumentId: document.id,
      quantity,
      status: updated.status
    });
  }

  return results;
}

export async function listReplenishments({
  productId = null,
  supplierId = null,
  status = null
} = {}) {
  const items = await getAll(STORES.REPLENISHMENTS);

  return items
    .filter(item => !productId || item.productId === productId)
    .filter(item => !supplierId || item.supplierId === supplierId)
    .filter(item => !status || item.status === status)
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
}

export async function getPendingInboundByProduct() {
  const items = await getAll(STORES.REPLENISHMENTS);
  return calculatePendingInboundByProduct(items);
}

export function calculatePendingInboundByProduct(items = []) {
  const pending = new Map();

  for (const item of items) {
    if (!PENDING_STATUSES.has(item.status)) continue;

    const quantity = Number(item.pendingQuantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    pending.set(
      item.productId,
      (pending.get(item.productId) || 0) + quantity
    );
  }

  return pending;
}

export function isPendingReplenishmentStatus(status) {
  return PENDING_STATUSES.has(status);
}

async function writeWithSync(entity, operation) {
  await runTransaction(
    [STORES.REPLENISHMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (entityStore, queueStore) => {
      await requestToPromise(entityStore.put(entity));
      await requestToPromise(
        queueStore.add(
          createSyncItem(
            'replenishment',
            entity.id,
            operation,
            entity
          )
        )
      );
    }
  );
}

function createSyncItem(entityType, entityId, operation, payload) {
  const now = new Date().toISOString();

  return {
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
}

function normalizeMethod(value, productMethod) {
  if (
    value === REPLENISHMENT_METHODS.PURCHASE ||
    value === REPLENISHMENT_METHODS.ORDER
  ) {
    return value;
  }

  if (productMethod === REPLENISHMENT_METHODS.PURCHASE) {
    return REPLENISHMENT_METHODS.PURCHASE;
  }

  if (productMethod === REPLENISHMENT_METHODS.ORDER) {
    return REPLENISHMENT_METHODS.ORDER;
  }

  if (productMethod === REPLENISHMENT_METHODS.BOTH) {
    throw new Error('Indica si será Compra o Pedido');
  }

  throw new Error('El producto no tiene método de reposición habilitado');
}

function assertMethodAllowed(productMethod, selectedMethod) {
  if (productMethod === REPLENISHMENT_METHODS.NONE) {
    throw new Error('El producto no admite reposición');
  }

  if (
    productMethod !== REPLENISHMENT_METHODS.BOTH &&
    productMethod !== selectedMethod
  ) {
    throw new Error('Método de reposición no permitido para el producto');
  }
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} debe ser mayor que cero`);
  }
  return number;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Fecha esperada inválida');
  }
  return date.toISOString();
}
