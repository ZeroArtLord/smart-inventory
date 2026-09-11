import { createLocalId } from '../core/ids.js';
import {
  initialEntityVersion,
  nextEntityVersion
} from '../core/versioning.js';
import { normalizeText } from '../core/catalog.js';
import {
  STORES,
  get,
  getAll,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { REPLENISHMENT_STATUS } from './replenishmentService.js';

export const PROCUREMENT_KIND = Object.freeze({
  PRODUCT: 'PRODUCT',
  EXTRA: 'EXTRA'
});

export const PROCUREMENT_SOURCE = Object.freeze({
  MANUAL: 'MANUAL',
  VIGIA_SUGGESTION: 'VIGIA_SUGGESTION',
  EXTRA: 'EXTRA'
});

const EXTRA_PREFIX = '__VIGIA_EXTRA__:';
const ALLOWED_METHODS = new Set(['PURCHASE', 'ORDER']);
const ALLOWED_EXTRA_UNITS = new Set([
  'UND', 'KG', 'LT', 'CAJA', 'BULTO', 'SACO', 'PAQ', 'M', 'OTRO'
]);

/**
 * Registra una decisión humana de compra/pedido sobre cualquier producto activo.
 * La política habitual del producto sirve como referencia, no como bloqueo.
 * No crea movimientos ni altera stock: solo crea una reposición trazable.
 */
export async function createManualProductProcurement(data = {}) {
  const productId = cleanText(data.productId);
  if (!productId) throw new Error('Selecciona un producto');

  const product = await get(STORES.PRODUCTS, productId);
  if (!product) throw new Error('Producto no encontrado');
  if (product.active === false) throw new Error('El producto está inactivo');

  const method = normalizeSelectedMethod(data.method);
  const requestedQuantity = positiveNumber(
    data.requestedQuantity ?? data.quantity,
    'Cantidad'
  );
  const now = new Date().toISOString();
  const id = data.id || createLocalId('rep');

  const sourceSuggestion = {
    kind: PROCUREMENT_KIND.PRODUCT,
    source: PROCUREMENT_SOURCE.MANUAL,
    manualDecision: true,
    configuredMethod: product.replenishmentMethod || null,
    vigiaSuggestedQuantity: nonNegativeOrNull(data.vigiaSuggestedQuantity),
    stockAtDecision: nonNegativeOrNull(data.stockAtDecision),
    pendingInboundAtDecision: nonNegativeOrNull(data.pendingInboundAtDecision),
    decisionReason: cleanText(data.reason) || null,
    decidedAt: now
  };

  const item = {
    id,
    productId: product.id,
    productName: product.name,
    supplierId: data.supplierId || product.supplierId || null,
    method,
    status: REPLENISHMENT_STATUS.DRAFT,
    requestedQuantity,
    receivedQuantity: 0,
    pendingQuantity: requestedQuantity,
    expectedAt: normalizeOptionalDate(data.expectedAt),
    reference: cleanText(data.reference) || null,
    notes: cleanText(data.notes || data.reason) || null,
    ownerId: data.ownerId || null,
    sourceSuggestion,
    receiptDocuments: [],
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeReplenishmentWithSync(item, 'CREATE');
  return item;
}

/**
 * Agrega una compra extraordinaria fuera del catálogo. Se sincroniza usando la
 * entidad replenishment existente, pero con un productId sintético que jamás
 * corresponde a un producto real. Por diseño no puede generar movimientos.
 */
export async function createProcurementExtra(data = {}) {
  const description = cleanText(data.description || data.name);
  if (!description) throw new Error('Describe el extra que debes comprar');

  const requestedQuantity = positiveNumber(
    data.requestedQuantity ?? data.quantity,
    'Cantidad'
  );
  const unit = normalizeExtraUnit(data.unit);
  const now = new Date().toISOString();
  const id = data.id || createLocalId('rep-extra');

  const item = {
    id,
    productId: `${EXTRA_PREFIX}${id}`,
    productName: description,
    supplierId: null,
    method: 'PURCHASE',
    status: REPLENISHMENT_STATUS.DRAFT,
    requestedQuantity,
    receivedQuantity: 0,
    pendingQuantity: requestedQuantity,
    expectedAt: null,
    reference: cleanText(data.reference) || null,
    notes: cleanText(data.notes) || null,
    ownerId: data.ownerId || null,
    sourceSuggestion: {
      kind: PROCUREMENT_KIND.EXTRA,
      source: PROCUREMENT_SOURCE.EXTRA,
      manualDecision: true,
      unit,
      outsideCatalog: true,
      decidedAt: now
    },
    receiptDocuments: [],
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeReplenishmentWithSync(item, 'CREATE');
  return item;
}

export async function completeProcurementExtra(id, { userId = null } = {}) {
  const current = await get(STORES.REPLENISHMENTS, id);
  assertExtra(current);

  if (
    current.status === REPLENISHMENT_STATUS.RECEIVED ||
    current.status === REPLENISHMENT_STATUS.CANCELLED
  ) {
    return current;
  }

  const now = new Date().toISOString();
  const updated = {
    ...current,
    status: REPLENISHMENT_STATUS.RECEIVED,
    receivedQuantity: Number(current.requestedQuantity || 0),
    pendingQuantity: 0,
    orderedAt: current.orderedAt || now,
    receivedAt: current.receivedAt || now,
    updatedBy: userId || null,
    version: nextEntityVersion(current),
    updatedAt: now
  };

  await writeReplenishmentWithSync(updated, 'UPDATE');
  return updated;
}

export async function cancelProcurementExtra(id, { userId = null } = {}) {
  const current = await get(STORES.REPLENISHMENTS, id);
  assertExtra(current);

  if (
    current.status === REPLENISHMENT_STATUS.RECEIVED ||
    current.status === REPLENISHMENT_STATUS.CANCELLED
  ) {
    return current;
  }

  const now = new Date().toISOString();
  const updated = {
    ...current,
    status: REPLENISHMENT_STATUS.CANCELLED,
    pendingQuantity: 0,
    cancelledAt: now,
    updatedBy: userId || null,
    version: nextEntityVersion(current),
    updatedAt: now
  };

  await writeReplenishmentWithSync(updated, 'UPDATE');
  return updated;
}

export async function listProcurementExtras({ activeOnly = false } = {}) {
  const items = await getAll(STORES.REPLENISHMENTS);
  return items
    .filter(isProcurementExtra)
    .filter(item => !activeOnly || ![
      REPLENISHMENT_STATUS.RECEIVED,
      REPLENISHMENT_STATUS.CANCELLED
    ].includes(item.status))
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
}

export function isProcurementExtra(item) {
  return Boolean(
    item && (
      item.sourceSuggestion?.kind === PROCUREMENT_KIND.EXTRA ||
      String(item.productId || '').startsWith(EXTRA_PREFIX)
    )
  );
}

export function procurementExtraUnit(item) {
  return cleanText(item?.sourceSuggestion?.unit) || 'UND';
}

async function writeReplenishmentWithSync(entity, operation) {
  await runTransaction(
    [STORES.REPLENISHMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (entityStore, queueStore) => {
      await requestToPromise(entityStore.put(entity));
      await requestToPromise(
        queueStore.add(createSyncItem(entity, operation))
      );
    }
  );
}

function createSyncItem(entity, operation) {
  const now = new Date().toISOString();
  return {
    id: createLocalId('sync'),
    entityType: 'replenishment',
    entityId: entity.id,
    operation,
    payload: entity,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null
  };
}

function assertExtra(item) {
  if (!item) throw new Error('Extra no encontrado');
  if (!isProcurementExtra(item)) {
    throw new Error('La operación solo aplica a compras extra');
  }
}

function normalizeSelectedMethod(value) {
  const method = cleanText(value).toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error('Elige COMPRA o PEDIDO');
  }
  return method;
}

function normalizeExtraUnit(value) {
  const unit = cleanText(value).toUpperCase() || 'UND';
  return ALLOWED_EXTRA_UNITS.has(unit) ? unit : 'OTRO';
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} debe ser mayor que cero`);
  }
  return number;
}

function nonNegativeOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Fecha esperada inválida');
  }
  return date.toISOString();
}

function cleanText(value) {
  return normalizeText(value) || '';
}
