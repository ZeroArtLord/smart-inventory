import { createLocalId } from '../core/ids.js';
import {
  initialEntityVersion,
  nextEntityVersion
} from '../core/versioning.js';
import { stockDeltaForMovement } from '../core/movementTypes.js';
import {
  STORES,
  get,
  getAll,
  getAllByIndex,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import {
  closeDocument,
  cancelDocument
} from './documentService.js';
import {
  DOCUMENT_STATUS,
  DOCUMENT_TYPES
} from './documentTypes.js';

export const LIVE_SUPPLY_CART_KIND = 'LIVE_SUPPLY_CART';
export const LIVE_SUPPLY_DELIVERY_KIND = 'LIVE_SUPPLY_DELIVERY';

const deliveryLocks = new Map();
const EPSILON = 0.000001;

export function createLiveSupplyDeliveryToken() {
  return createLocalId('delivery');
}

/**
 * Convierte un borrador SUPPLY normal en carrito V5-E sin tocar stock.
 */
export async function enableLiveSupplyCart(
  documentId,
  { userId = null } = {}
) {
  const id = clean(documentId);
  if (!id) throw new Error('Surtido no identificado');

  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const current = await requestToPromise(documentStore.get(id));
      assertDraftSupply(current);

      if (current.metadata?.kind === LIVE_SUPPLY_CART_KIND) {
        return current;
      }

      const now = new Date().toISOString();
      const updated = {
        ...current,
        version: nextEntityVersion(current),
        updatedAt: now,
        metadata: {
          ...(current.metadata || {}),
          kind: LIVE_SUPPLY_CART_KIND,
          liveSupplyEnabledAt: now,
          liveSupplyEnabledBy: userId
        }
      };

      await requestToPromise(documentStore.put(updated));
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', updated.id, 'UPDATE', updated)
        )
      );

      return updated;
    }
  );
}

/**
 * El progreso entregado se deriva de MOVIMIENTOS, no de un contador mutable.
 * Si una entrega fue compensada con REVERSAL, deja de contar automáticamente.
 */
export async function getLiveSupplyCartSummary(documentId) {
  const id = clean(documentId);
  if (!id) throw new Error('Surtido no identificado');

  const [parent, lines, documents, movements] = await Promise.all([
    get(STORES.DOCUMENTS, id),
    getAllByIndex(STORES.DOCUMENT_LINES, 'documentId', id),
    getAll(STORES.DOCUMENTS),
    getAll(STORES.MOVEMENTS)
  ]);

  assertLiveSupply(parent, { allowClosed: true, allowCancelled: true });

  const deliveryDocuments = documents
    .filter(document =>
      document?.type === DOCUMENT_TYPES.SUPPLY &&
      document.metadata?.kind === LIVE_SUPPLY_DELIVERY_KIND &&
      document.metadata?.parentCartId === id
    )
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
  const deliveryIds = new Set(deliveryDocuments.map(document => document.id));
  const deliveredByProduct = new Map();
  const deliveryMovementCounts = new Map();

  for (const movement of movements) {
    if (!deliveryIds.has(movement.documentId)) continue;
    if (movement.voided === true) continue;

    const deliveredDelta = -stockDeltaForMovement(movement);
    deliveredByProduct.set(
      movement.productId,
      round((deliveredByProduct.get(movement.productId) || 0) + deliveredDelta)
    );
    deliveryMovementCounts.set(
      movement.documentId,
      (deliveryMovementCounts.get(movement.documentId) || 0) + 1
    );
  }

  const rows = lines
    .map(line => {
      const planned = positiveOrZero(line.quantity);
      const delivered = Math.max(
        0,
        round(deliveredByProduct.get(line.productId) || 0)
      );
      const remaining = Math.max(0, round(planned - delivered));
      const overDelivered = Math.max(0, round(delivered - planned));
      const cancelled = line.liveCancelRemaining === true;

      return {
        line,
        productId: line.productId,
        productName: line.productName || line.productId,
        planned,
        delivered,
        remaining,
        overDelivered,
        cancelled,
        actionableRemaining: cancelled ? 0 : remaining
      };
    })
    .sort((a, b) =>
      String(a.productName).localeCompare(String(b.productName), 'es')
    );

  const deliveries = deliveryDocuments.map(document => {
    const netByProduct = new Map();

    for (const movement of movements) {
      if (movement.documentId !== document.id || movement.voided === true) {
        continue;
      }
      netByProduct.set(
        movement.productId,
        round(
          (netByProduct.get(movement.productId) || 0) -
          stockDeltaForMovement(movement)
        )
      );
    }

    return {
      document,
      movementCount: deliveryMovementCounts.get(document.id) || 0,
      netDelivered: [...netByProduct.entries()]
        .map(([productId, quantity]) => ({
          productId,
          quantity: Math.max(0, round(quantity))
        }))
        .filter(item => item.quantity > EPSILON)
    };
  });

  const plannedTotal = round(
    rows.reduce((sum, row) => sum + row.planned, 0)
  );
  const deliveredTotal = round(
    rows.reduce((sum, row) => sum + row.delivered, 0)
  );
  const remainingTotal = round(
    rows.reduce((sum, row) => sum + row.actionableRemaining, 0)
  );
  const cancelledRemainingTotal = round(
    rows.reduce(
      (sum, row) => sum + (row.cancelled ? row.remaining : 0),
      0
    )
  );

  return {
    document: parent,
    rows,
    deliveries,
    plannedTotal,
    deliveredTotal,
    remainingTotal,
    cancelledRemainingTotal,
    overDeliveredCount: rows.filter(row => row.overDelivered > EPSILON).length,
    complete: remainingTotal <= EPSILON,
    closedDeliveryCount: deliveryDocuments.filter(
      document => document.status === DOCUMENT_STATUS.CLOSED
    ).length,
    failedDeliveryCount: deliveryDocuments.filter(
      document => document.status === DOCUMENT_STATUS.CANCELLED
    ).length
  };
}

/**
 * Registra UNA entrega física como un SUPPLY hijo inmutable.
 * El token identifica el acto físico. Repetir el mismo token devuelve la
 * entrega existente y nunca crea un segundo movimiento.
 */
export async function dispatchLiveSupply(
  documentId,
  {
    deliveryToken,
    quantities = null,
    userId = null,
    notes = ''
  } = {}
) {
  const parentId = clean(documentId);
  const token = normalizeToken(deliveryToken);
  if (!parentId) throw new Error('Surtido no identificado');
  if (!token) throw new Error('Token de entrega requerido');

  const deliveryId = liveDeliveryDocumentId(parentId, token);

  if (deliveryLocks.has(deliveryId)) {
    return deliveryLocks.get(deliveryId);
  }

  const promise = dispatchLiveSupplyInternal(parentId, {
    deliveryId,
    token,
    quantities,
    userId,
    notes
  }).finally(() => {
    deliveryLocks.delete(deliveryId);
  });

  deliveryLocks.set(deliveryId, promise);
  return promise;
}

async function dispatchLiveSupplyInternal(
  parentId,
  {
    deliveryId,
    token,
    quantities,
    userId,
    notes
  }
) {
  const parent = await get(STORES.DOCUMENTS, parentId);
  assertLiveSupply(parent);

  const existing = await get(STORES.DOCUMENTS, deliveryId);
  if (existing) {
    assertDeliveryBelongsToCart(existing, parentId, token);

    if (existing.status === DOCUMENT_STATUS.CLOSED) {
      return existingDeliveryResult(existing, true);
    }

    if (existing.status !== DOCUMENT_STATUS.DRAFT) {
      throw new Error(
        'Ese token de entrega ya fue usado por una operación cancelada'
      );
    }
  }

  const summary = await getLiveSupplyCartSummary(parentId);
  const requestRows = normalizeDispatchRows(quantities, summary.rows);

  if (!requestRows.length) {
    throw new Error('No hay cantidades pendientes seleccionadas para entregar');
  }

  if (!existing) {
    await createDeliveryDraftAtomic(parent, {
      deliveryId,
      token,
      rows: requestRows,
      userId,
      notes
    });
  } else {
    const existingLines = await getAllByIndex(
      STORES.DOCUMENT_LINES,
      'documentId',
      deliveryId
    );
    assertRetryMatches(existingLines, requestRows);
  }

  try {
    const closed = await closeDocument(deliveryId, { userId });
    return {
      ...closed,
      deliveryId,
      deliveryToken: token,
      idempotent: false
    };
  } catch (error) {
    const draft = await get(STORES.DOCUMENTS, deliveryId);
    if (draft?.status === DOCUMENT_STATUS.DRAFT) {
      await cancelDocument(deliveryId, { userId }).catch(() => null);
    }
    throw error;
  }
}

export async function cancelLiveSupplyRemaining(
  documentId,
  productId,
  {
    userId = null,
    reason = 'Pendiente cancelado por el almacén'
  } = {}
) {
  const parentId = clean(documentId);
  const id = clean(productId);
  if (!parentId || !id) throw new Error('Línea de surtido no identificada');

  const summary = await getLiveSupplyCartSummary(parentId);
  assertLiveSupply(summary.document);
  const row = summary.rows.find(item => item.productId === id);
  if (!row) throw new Error('Producto no encontrado en el carrito');
  if (row.remaining <= EPSILON) {
    throw new Error('Ese producto ya no tiene cantidad pendiente');
  }

  return updateParentLine(parentId, id, line => {
    const now = new Date().toISOString();
    return {
      ...line,
      liveCancelRemaining: true,
      liveCancelReason: clean(reason) || 'Pendiente cancelado por el almacén',
      liveCancelAt: now,
      liveCancelBy: userId,
      version: nextEntityVersion(line),
      updatedAt: now
    };
  });
}

export async function restoreLiveSupplyRemaining(
  documentId,
  productId,
  { userId = null } = {}
) {
  return updateParentLine(documentId, productId, line => {
    const now = new Date().toISOString();
    return {
      ...line,
      liveCancelRemaining: false,
      liveCancelReason: null,
      liveCancelAt: null,
      liveCancelBy: null,
      liveRestoredAt: now,
      liveRestoredBy: userId,
      version: nextEntityVersion(line),
      updatedAt: now
    };
  });
}

/**
 * Finaliza el carrito padre SIN volver a descontar sus líneas.
 * Solo las entregas hijas cerradas modifican stock.
 */
export async function finalizeLiveSupplyCart(
  documentId,
  {
    userId = null,
    cancelRemaining = false
  } = {}
) {
  const summary = await getLiveSupplyCartSummary(documentId);
  const parent = summary.document;
  assertLiveSupply(parent);

  if (summary.remainingTotal > EPSILON && !cancelRemaining) {
    throw new Error(
      `Quedan ${formatQuantity(summary.remainingTotal)} unidad(es) pendientes de entregar o cancelar`
    );
  }

  const unfulfilled = summary.rows
    .filter(row => row.actionableRemaining > EPSILON)
    .map(row => ({
      productId: row.productId,
      productName: row.productName,
      quantity: row.actionableRemaining
    }));

  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const current = await requestToPromise(documentStore.get(parent.id));
      assertLiveSupply(current);

      const now = new Date().toISOString();
      const closed = {
        ...current,
        status: DOCUMENT_STATUS.CLOSED,
        closedAt: now,
        closedBy: userId,
        version: nextEntityVersion(current),
        updatedAt: now,
        metadata: {
          ...(current.metadata || {}),
          closeMode: LIVE_SUPPLY_CART_KIND,
          liveSupplyFinalizedAt: now,
          liveSupplyFinalizedBy: userId,
          liveSupplyDeliveryCount: summary.closedDeliveryCount,
          liveSupplyPlannedTotal: summary.plannedTotal,
          liveSupplyDeliveredTotal: summary.deliveredTotal,
          liveSupplyCancelledRemainingTotal:
            summary.cancelledRemainingTotal +
            (cancelRemaining ? summary.remainingTotal : 0),
          liveSupplyUnfulfilledAtClose: cancelRemaining ? unfulfilled : []
        }
      };

      await requestToPromise(documentStore.put(closed));
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', closed.id, 'UPDATE', closed)
        )
      );

      return {
        document: closed,
        movements: [],
        summary: {
          ...summary,
          unfulfilledAtClose: cancelRemaining ? unfulfilled : []
        }
      };
    }
  );
}

export async function cancelLiveSupplyCart(
  documentId,
  {
    userId = null,
    reason = 'Carrito de surtido cancelado'
  } = {}
) {
  const summary = await getLiveSupplyCartSummary(documentId);
  assertLiveSupply(summary.document);

  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const current = await requestToPromise(
        documentStore.get(summary.document.id)
      );
      assertLiveSupply(current);

      const now = new Date().toISOString();
      const cancelled = {
        ...current,
        status: DOCUMENT_STATUS.CANCELLED,
        version: nextEntityVersion(current),
        updatedAt: now,
        metadata: {
          ...(current.metadata || {}),
          liveSupplyCancelledAt: now,
          liveSupplyCancelledBy: userId,
          liveSupplyCancelReason: clean(reason) || 'Carrito de surtido cancelado',
          liveSupplyDeliveredBeforeCancel: summary.deliveredTotal
        }
      };

      await requestToPromise(documentStore.put(cancelled));
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', cancelled.id, 'UPDATE', cancelled)
        )
      );

      return {
        document: cancelled,
        movements: [],
        summary
      };
    }
  );
}

async function createDeliveryDraftAtomic(
  parent,
  {
    deliveryId,
    token,
    rows,
    userId,
    notes
  }
) {
  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.PRODUCTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, productStore, queueStore) => {
      const existing = await requestToPromise(documentStore.get(deliveryId));
      if (existing) {
        assertDeliveryBelongsToCart(existing, parent.id, token);
        return existing;
      }

      const now = new Date().toISOString();
      const document = {
        id: deliveryId,
        type: DOCUMENT_TYPES.SUPPLY,
        status: DOCUMENT_STATUS.DRAFT,
        // Un owner sintético evita que la UI normal confunda un reintento
        // técnico de entrega con el carrito principal del usuario.
        ownerId: `live-delivery:${parent.id}`,
        locationId: parent.locationId || null,
        destinationId: parent.destinationId || null,
        supplierId: null,
        reference:
          `Entrega viva ${parent.reference || parent.id}`.trim(),
        notes: clean(notes),
        metadata: {
          kind: LIVE_SUPPLY_DELIVERY_KIND,
          parentCartId: parent.id,
          deliveryToken: token,
          physicalHandoff: true,
          createdBy: userId,
          destinationName: parent.metadata?.destinationName || null,
          responsibleName: parent.metadata?.responsibleName || null,
          saintNotes: parent.metadata?.saintNotes || null
        },
        version: initialEntityVersion(),
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        closedBy: null
      };

      await requestToPromise(documentStore.add(document));
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', document.id, 'CREATE', document)
        )
      );

      for (const row of rows) {
        const product = await requestToPromise(productStore.get(row.productId));
        if (!product) {
          throw new Error(`Producto no encontrado: ${row.productId}`);
        }

        const line = {
          id: `line_${deliveryId}_${row.productId}`,
          documentId: deliveryId,
          productId: row.productId,
          productName: product.name,
          documentType: DOCUMENT_TYPES.SUPPLY,
          quantity: row.quantity,
          unitCost: null,
          lotNumber: '',
          expiresAt: null,
          supplierId: null,
          notes: clean(row.notes),
          liveSupplyParentLineId: row.lineId || null,
          liveSupplyDeliveryToken: token,
          version: initialEntityVersion(),
          createdAt: now,
          updatedAt: now
        };

        await requestToPromise(lineStore.add(line));
        await requestToPromise(
          queueStore.add(
            createSyncItem('documentLine', line.id, 'CREATE', line)
          )
        );
      }

      return document;
    }
  );
}

async function existingDeliveryResult(document, idempotent) {
  const [lines, movements] = await Promise.all([
    getAllByIndex(STORES.DOCUMENT_LINES, 'documentId', document.id),
    getAllByIndex(STORES.MOVEMENTS, 'documentId', document.id)
  ]);

  return {
    document,
    lines,
    movements,
    lots: [],
    deliveryId: document.id,
    deliveryToken: document.metadata?.deliveryToken || null,
    idempotent
  };
}

function normalizeDispatchRows(quantities, summaryRows) {
  const byProduct = new Map(summaryRows.map(row => [row.productId, row]));
  const source = Array.isArray(quantities) && quantities.length
    ? quantities
    : summaryRows
        .filter(row => row.actionableRemaining > EPSILON)
        .map(row => ({
          productId: row.productId,
          quantity: row.actionableRemaining
        }));
  const seen = new Set();
  const rows = [];

  for (const item of source) {
    const productId = clean(item?.productId);
    if (!productId || seen.has(productId)) {
      throw new Error('Selección de entrega duplicada o inválida');
    }
    seen.add(productId);

    const summary = byProduct.get(productId);
    if (!summary) {
      throw new Error('El producto no pertenece al carrito actual');
    }
    if (summary.cancelled) {
      throw new Error(`${summary.productName}: el pendiente está cancelado`);
    }

    const quantity = positive(item.quantity, 'Cantidad a entregar');
    if (quantity > summary.remaining + EPSILON) {
      throw new Error(
        `${summary.productName}: intentas entregar ${formatQuantity(quantity)}, pero quedan ${formatQuantity(summary.remaining)}`
      );
    }

    rows.push({
      lineId: summary.line.id,
      productId,
      quantity: round(quantity),
      notes: clean(item.notes)
    });
  }

  return rows;
}

function assertRetryMatches(existingLines, rows) {
  if (existingLines.length !== rows.length) {
    throw new Error(
      'El token ya tiene otra selección de entrega. Usa un token nuevo.'
    );
  }

  const existing = new Map(
    existingLines.map(line => [line.productId, Number(line.quantity)])
  );

  for (const row of rows) {
    if (
      !existing.has(row.productId) ||
      Math.abs(existing.get(row.productId) - row.quantity) > EPSILON
    ) {
      throw new Error(
        'El token ya tiene otras cantidades de entrega. Usa un token nuevo.'
      );
    }
  }
}

async function updateParentLine(documentId, productId, updater) {
  const parentId = clean(documentId);
  const id = clean(productId);

  return runTransaction(
    [STORES.DOCUMENTS, STORES.DOCUMENT_LINES, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, lineStore, queueStore) => {
      const parent = await requestToPromise(documentStore.get(parentId));
      assertLiveSupply(parent);

      const candidates = await requestToPromise(
        lineStore.index('documentProduct').getAll([parentId, id])
      );
      const line = candidates[0];
      if (!line) throw new Error('Línea del carrito no encontrada');

      const updated = updater(line);
      await requestToPromise(lineStore.put(updated));
      await requestToPromise(
        queueStore.add(
          createSyncItem('documentLine', updated.id, 'UPDATE', updated)
        )
      );
      return updated;
    }
  );
}

function assertDraftSupply(document) {
  if (!document) throw new Error('Surtido no encontrado');
  if (document.type !== DOCUMENT_TYPES.SUPPLY) {
    throw new Error('El documento no es un surtido');
  }
  if (document.status !== DOCUMENT_STATUS.DRAFT) {
    throw new Error('El surtido ya no está en borrador');
  }
}

function assertLiveSupply(
  document,
  { allowClosed = false, allowCancelled = false } = {}
) {
  if (!document) throw new Error('Surtido no encontrado');
  if (document.type !== DOCUMENT_TYPES.SUPPLY) {
    throw new Error('El documento no es un surtido');
  }
  if (document.metadata?.kind !== LIVE_SUPPLY_CART_KIND) {
    throw new Error('El surtido todavía no está en modo vivo V5-E');
  }

  const allowed = [DOCUMENT_STATUS.DRAFT];
  if (allowClosed) allowed.push(DOCUMENT_STATUS.CLOSED);
  if (allowCancelled) allowed.push(DOCUMENT_STATUS.CANCELLED);

  if (!allowed.includes(document.status)) {
    throw new Error('El carrito de surtido ya no admite esta operación');
  }
}

function assertDeliveryBelongsToCart(document, parentId, token) {
  if (
    document.type !== DOCUMENT_TYPES.SUPPLY ||
    document.metadata?.kind !== LIVE_SUPPLY_DELIVERY_KIND ||
    document.metadata?.parentCartId !== parentId ||
    document.metadata?.deliveryToken !== token
  ) {
    throw new Error('Colisión de identidad en token de entrega');
  }
}

function liveDeliveryDocumentId(parentId, token) {
  return `sur_live_${safePart(parentId, 100)}_${safePart(token, 100)}`;
}

function normalizeToken(value) {
  return safePart(clean(value), 100);
}

function safePart(value, maxLength) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} debe ser mayor que cero`);
  }
  return number;
}

function positiveOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? round(number) : 0;
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}

function formatQuantity(value) {
  return round(value).toLocaleString('es');
}

function clean(value) {
  return String(value ?? '').trim();
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
