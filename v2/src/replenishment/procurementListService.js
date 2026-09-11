import { createLocalId } from '../core/ids.js';
import { normalizeText } from '../core/catalog.js';
import { initialEntityVersion, nextEntityVersion } from '../core/versioning.js';
import {
  STORES,
  get,
  getAll,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { REPLENISHMENT_STATUS } from './replenishmentService.js';
import {
  PROCUREMENT_KIND,
  PROCUREMENT_SOURCE,
  isProcurementExtra,
  procurementExtraUnit
} from './warehouseProcurementService.js';

export const PROCUREMENT_LIST_KIND = Object.freeze({
  PURCHASE: 'PURCHASE',
  ORDER: 'ORDER'
});

const EXTRA_PREFIX = '__VIGIA_EXTRA__:';
const ALLOWED_METHODS = new Set(Object.values(PROCUREMENT_LIST_KIND));
const TERMINAL_STATUSES = new Set([
  REPLENISHMENT_STATUS.RECEIVED,
  REPLENISHMENT_STATUS.CANCELLED
]);

export async function createProcurementLists({
  lines = [],
  extras = [],
  ownerId = null,
  ownerLabel = null,
  groupId = null
} = {}) {
  const normalizedLines = Array.isArray(lines) ? lines : [];
  const normalizedExtras = Array.isArray(extras) ? extras : [];

  if (!normalizedLines.length && !normalizedExtras.length) {
    throw new Error('Selecciona al menos un producto o extra');
  }

  const [products, categories] = await Promise.all([
    getAll(STORES.PRODUCTS),
    getAll(STORES.CATEGORIES)
  ]);
  const productById = new Map(products.map(product => [product.id, product]));
  const categoryById = new Map(categories.map(category => [category.id, category]));

  const now = new Date().toISOString();
  const procurementGroupId = cleanText(groupId) || createLocalId('proc-group');
  const purchaseListId = hasMethod(normalizedLines, normalizedExtras, 'PURCHASE')
    ? createLocalId('buy-list')
    : null;
  const orderListId = hasMethod(normalizedLines, normalizedExtras, 'ORDER')
    ? createLocalId('order-list')
    : null;

  const entities = [];

  for (const raw of normalizedLines) {
    const productId = cleanText(raw.productId);
    const product = productById.get(productId);
    if (!product) throw new Error('Producto no encontrado en la lista');
    if (product.active === false) {
      throw new Error(`El producto está inactivo: ${product.name}`);
    }

    const method = normalizeMethod(raw.method);
    const requestedQuantity = positiveNumber(
      raw.requestedQuantity ?? raw.quantity,
      `Cantidad de ${product.name}`
    );
    const categoryName = cleanText(raw.categoryName) ||
      cleanText(categoryById.get(product.categoryId)?.name) ||
      'SIN CATEGORÍA';
    const source = raw.source === PROCUREMENT_SOURCE.MANUAL
      ? PROCUREMENT_SOURCE.MANUAL
      : PROCUREMENT_SOURCE.VIGIA_SUGGESTION;
    const listId = method === 'PURCHASE' ? purchaseListId : orderListId;

    entities.push({
      id: raw.id || createLocalId('rep'),
      productId: product.id,
      productName: product.name,
      supplierId: raw.supplierId || product.supplierId || null,
      method,
      status: REPLENISHMENT_STATUS.DRAFT,
      requestedQuantity,
      receivedQuantity: 0,
      pendingQuantity: requestedQuantity,
      expectedAt: normalizeOptionalDate(raw.expectedAt),
      reference: cleanText(raw.reference) || null,
      notes: cleanText(raw.notes || raw.reason) || null,
      ownerId: ownerId || raw.ownerId || null,
      sourceSuggestion: {
        kind: PROCUREMENT_KIND.PRODUCT,
        source,
        manualDecision: true,
        configuredMethod: product.replenishmentMethod || null,
        vigiaSuggestedQuantity: nonNegativeOrNull(raw.vigiaSuggestedQuantity),
        stockAtDecision: nonNegativeOrNull(raw.stockAtDecision),
        pendingInboundAtDecision: nonNegativeOrNull(raw.pendingInboundAtDecision),
        decisionReason: cleanText(raw.reason || raw.notes) || null,
        decidedAt: now,
        ownerLabelAtDecision: cleanText(ownerLabel) || null,
        procurementGroupId,
        procurementListId: listId,
        listKind: method,
        categoryNameAtDecision: categoryName,
        displayQuantity: positiveOrNull(raw.displayQuantity),
        displayUnit: cleanText(raw.displayUnit) || null,
        displayConversion: positiveOrNull(raw.displayConversion)
      },
      receiptDocuments: [],
      orderedAt: null,
      receivedAt: null,
      cancelledAt: null,
      version: initialEntityVersion(),
      createdAt: now,
      updatedAt: now
    });
  }

  for (const raw of normalizedExtras) {
    const description = cleanText(raw.description || raw.name);
    if (!description) throw new Error('Describe el extra que debes comprar o pedir');
    const method = normalizeMethod(raw.method || 'PURCHASE');
    const requestedQuantity = positiveNumber(
      raw.requestedQuantity ?? raw.quantity,
      `Cantidad de ${description}`
    );
    const listId = method === 'PURCHASE' ? purchaseListId : orderListId;
    const id = raw.id || createLocalId('rep-extra');
    const unit = cleanText(raw.unit || raw.displayUnit).toUpperCase() || 'UND';

    entities.push({
      id,
      productId: `${EXTRA_PREFIX}${id}`,
      productName: description,
      supplierId: raw.supplierId || null,
      method,
      status: REPLENISHMENT_STATUS.DRAFT,
      requestedQuantity,
      receivedQuantity: 0,
      pendingQuantity: requestedQuantity,
      expectedAt: normalizeOptionalDate(raw.expectedAt),
      reference: cleanText(raw.reference) || null,
      notes: cleanText(raw.notes) || null,
      ownerId: ownerId || raw.ownerId || null,
      sourceSuggestion: {
        kind: PROCUREMENT_KIND.EXTRA,
        source: PROCUREMENT_SOURCE.EXTRA,
        manualDecision: true,
        unit,
        outsideCatalog: true,
        decidedAt: now,
        ownerLabelAtDecision: cleanText(ownerLabel) || null,
        procurementGroupId,
        procurementListId: listId,
        listKind: method,
        categoryNameAtDecision: cleanText(raw.categoryName) || 'EXTRAS',
        displayQuantity: positiveOrNull(raw.displayQuantity) || requestedQuantity,
        displayUnit: unit,
        displayConversion: 1
      },
      receiptDocuments: [],
      orderedAt: null,
      receivedAt: null,
      cancelledAt: null,
      version: initialEntityVersion(),
      createdAt: now,
      updatedAt: now
    });
  }

  await runTransaction(
    [STORES.REPLENISHMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (replenishmentStore, queueStore) => {
      for (const entity of entities) {
        await requestToPromise(replenishmentStore.put(entity));
        await requestToPromise(queueStore.add(createSyncItem(entity, 'CREATE')));
      }
    }
  );

  return {
    procurementGroupId,
    purchaseListId,
    orderListId,
    items: entities
  };
}

export async function updateDraftProcurementLine(
  id,
  {
    requestedQuantity,
    method,
    notes = undefined,
    displayQuantity = undefined,
    displayUnit = undefined,
    displayConversion = undefined,
    userId = null
  } = {}
) {
  const current = await get(STORES.REPLENISHMENTS, id);
  if (!current) throw new Error('Renglón de compra/pedido no encontrado');
  if (current.status !== REPLENISHMENT_STATUS.DRAFT) {
    throw new Error('Solo puedes editar una lista mientras esté en BORRADOR');
  }

  const nextMethod = method ? normalizeMethod(method) : current.method;
  const nextRequested = requestedQuantity === undefined
    ? Number(current.requestedQuantity)
    : positiveNumber(requestedQuantity, 'Cantidad');
  const sourceSuggestion = {
    ...(current.sourceSuggestion || {}),
    listKind: nextMethod,
    displayQuantity: displayQuantity === undefined
      ? current.sourceSuggestion?.displayQuantity ?? null
      : positiveOrNull(displayQuantity),
    displayUnit: displayUnit === undefined
      ? current.sourceSuggestion?.displayUnit ?? null
      : cleanText(displayUnit) || null,
    displayConversion: displayConversion === undefined
      ? current.sourceSuggestion?.displayConversion ?? null
      : positiveOrNull(displayConversion)
  };

  const updated = {
    ...current,
    method: nextMethod,
    requestedQuantity: nextRequested,
    pendingQuantity: nextRequested - Number(current.receivedQuantity || 0),
    notes: notes === undefined ? current.notes : cleanText(notes) || null,
    sourceSuggestion,
    updatedBy: userId || null,
    version: nextEntityVersion(current),
    updatedAt: new Date().toISOString()
  };

  if (updated.pendingQuantity < 0) {
    throw new Error('La cantidad nueva no puede ser menor a lo ya recibido');
  }

  await writeOne(updated, 'UPDATE');
  return updated;
}

export async function listProcurementLists({ includeTerminal = true } = {}) {
  const items = await getAll(STORES.REPLENISHMENTS);
  const filtered = items.filter(item =>
    includeTerminal || !TERMINAL_STATUSES.has(item.status)
  );
  const groups = new Map();

  for (const item of filtered) {
    const listId = procurementListIdOf(item) || `legacy:${item.id}`;
    if (!groups.has(listId)) {
      groups.set(listId, {
        id: listId,
        kind: item.method === 'ORDER' ? 'ORDER' : 'PURCHASE',
        groupId: item.sourceSuggestion?.procurementGroupId || null,
        createdAt: item.createdAt || item.updatedAt || null,
        updatedAt: item.updatedAt || item.createdAt || null,
        ownerId: item.ownerId || null,
        ownerLabel: item.sourceSuggestion?.ownerLabelAtDecision || null,
        items: []
      });
    }
    const group = groups.get(listId);
    group.items.push(item);
    if (String(item.updatedAt || '') > String(group.updatedAt || '')) {
      group.updatedAt = item.updatedAt;
    }
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      status: deriveListStatus(group.items),
      activeItems: group.items.filter(item => item.status !== REPLENISHMENT_STATUS.CANCELLED),
      extras: group.items.filter(isProcurementExtra)
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function procurementListIdOf(item) {
  return cleanText(item?.sourceSuggestion?.procurementListId) || null;
}

export function procurementCategoryOf(item) {
  if (isProcurementExtra(item)) {
    return cleanText(item?.sourceSuggestion?.categoryNameAtDecision) || 'EXTRAS';
  }
  return cleanText(item?.sourceSuggestion?.categoryNameAtDecision) || 'SIN CATEGORÍA';
}

export function procurementDisplayQuantity(item) {
  const quantity = positiveOrNull(item?.sourceSuggestion?.displayQuantity);
  const unit = cleanText(item?.sourceSuggestion?.displayUnit) ||
    (isProcurementExtra(item) ? procurementExtraUnit(item) : null);
  if (quantity && unit) return { quantity, unit };
  return {
    quantity: Number(item?.requestedQuantity || 0),
    unit: unit || 'UND'
  };
}

export function deriveListStatus(items = []) {
  const active = items.filter(item => item.status !== REPLENISHMENT_STATUS.CANCELLED);
  if (!active.length) return REPLENISHMENT_STATUS.CANCELLED;
  if (active.every(item => item.status === REPLENISHMENT_STATUS.RECEIVED)) {
    return REPLENISHMENT_STATUS.RECEIVED;
  }
  if (active.some(item => item.status === REPLENISHMENT_STATUS.PARTIALLY_RECEIVED)) {
    return REPLENISHMENT_STATUS.PARTIALLY_RECEIVED;
  }
  if (active.some(item => item.status === REPLENISHMENT_STATUS.IN_TRANSIT)) {
    return REPLENISHMENT_STATUS.IN_TRANSIT;
  }
  if (active.some(item => item.status === REPLENISHMENT_STATUS.ORDERED)) {
    return REPLENISHMENT_STATUS.ORDERED;
  }
  return REPLENISHMENT_STATUS.DRAFT;
}

async function writeOne(entity, operation) {
  await runTransaction(
    [STORES.REPLENISHMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (entityStore, queueStore) => {
      await requestToPromise(entityStore.put(entity));
      await requestToPromise(queueStore.add(createSyncItem(entity, operation)));
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

function hasMethod(lines, extras, method) {
  return [...lines, ...extras].some(item => normalizeMethod(item.method || 'PURCHASE') === method);
}

function normalizeMethod(value) {
  const method = cleanText(value).toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error('Elige COMPRAR o PEDIR');
  }
  return method;
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} debe ser mayor que cero`);
  }
  return number;
}

function positiveOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Fecha esperada inválida');
  return date.toISOString();
}

function cleanText(value) {
  return normalizeText(value) || '';
}
