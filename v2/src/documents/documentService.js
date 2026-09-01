import { createLocalId } from '../core/ids.js';
import {
  initialEntityVersion,
  nextEntityVersion
} from '../core/versioning.js';
import { MOVEMENT_TYPES } from '../core/movementTypes.js';
import { normalizeText, assertNonNegativeNumber } from '../core/catalog.js';
import {
  STORES,
  get,
  getAll,
  getAllByIndex,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { calculateStock } from '../inventory/stockEngine.js';
import { allocateLotsFefo } from '../inventory/lotEngine.js';
import {
  buildMovement,
  buildMovementSyncItem,
  getCurrentStock
} from '../inventory/movementService.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS,
  assertDocumentType,
  assertDocumentIsDraft
} from './documentTypes.js';

export async function createDocument(data = {}) {
  const type = assertDocumentType(data.type);

  // Un conteo físico es una sesión recuperable, no un botón que deba
  // crear borradores ilimitados. Esta protección vive en el servicio
  // (además de la UI) para que cualquier llamada local respete la regla.
  if (type === DOCUMENT_TYPES.COUNT && data.ownerId) {
    const drafts = await listDraftDocuments({
      ownerId: data.ownerId,
      type: DOCUMENT_TYPES.COUNT
    });

    const requestedLocationId = data.locationId || null;
    const existing = drafts.find(document =>
      (document.locationId || null) === requestedLocationId
    );

    if (existing) return existing;
  }

  const now = new Date().toISOString();

  const document = {
    id: data.id || createLocalId(prefixForDocument(type)),
    type,
    status: DOCUMENT_STATUS.DRAFT,
    ownerId: data.ownerId || null,
    locationId: data.locationId || null,
    destinationId: data.destinationId || null,
    supplierId: data.supplierId || null,
    reference: normalizeText(data.reference),
    notes: normalizeText(data.notes),
    metadata: data.metadata || {},
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now,
    closedAt: null
  };

  await writeWithSync(
    STORES.DOCUMENTS,
    'document',
    document,
    'CREATE'
  );

  return document;
}

export async function saveDocumentLine(data = {}) {
  const document = await get(STORES.DOCUMENTS, data.documentId);
  assertDocumentIsDraft(document);

  const product = await get(STORES.PRODUCTS, data.productId);
  if (!product) throw new Error('Producto no encontrado');

  const now = new Date().toISOString();
  const existingId = data.id || defaultLineId(document, product.id, data);
  const existing = await get(STORES.DOCUMENT_LINES, existingId);

  const base = {
    ...(existing || {}),
    id: existingId,
    documentId: document.id,
    productId: product.id,
    productName: product.name,
    documentType: document.type,
    version: existing
      ? nextEntityVersion(existing)
      : initialEntityVersion(),
    updatedAt: now,
    createdAt: existing?.createdAt || now
  };

  let line;

  if (document.type === DOCUMENT_TYPES.COUNT) {
    const countedStock = assertNonNegativeNumber(
      data.countedStock,
      'Existencia contada'
    );

    const expectedStock = data.expectedStock !== undefined
      ? assertNonNegativeNumber(data.expectedStock, 'Existencia esperada')
      : await getCurrentStock(product.id, { locationId: document.locationId });

    line = {
      ...base,
      expectedStock,
      countedStock,
      difference: countedStock - expectedStock,
      countedAt: data.countedAt || now
    };
  } else if (
    document.type === DOCUMENT_TYPES.ENTRY ||
    document.type === DOCUMENT_TYPES.SUPPLY
  ) {
    const quantity = Number(data.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('La cantidad debe ser mayor que cero');
    }

    line = {
      ...base,
      quantity,
      unitCost: optionalNonNegativeNumber(data.unitCost),
      lotNumber: normalizeText(data.lotNumber),
      expiresAt: normalizeOptionalDate(data.expiresAt),
      supplierId: data.supplierId || document.supplierId || product.supplierId || null,
      notes: normalizeText(data.notes)
    };
  } else {
    throw new Error('Este tipo de documento no admite líneas operativas');
  }

  await writeWithSync(
    STORES.DOCUMENT_LINES,
    'documentLine',
    line,
    existing ? 'UPDATE' : 'CREATE'
  );

  return line;
}

export async function listDocumentLines(documentId) {
  const lines = await getAllByIndex(
    STORES.DOCUMENT_LINES,
    'documentId',
    documentId
  );

  return lines.sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );
}

export async function listDraftDocuments({ ownerId = null, type = null } = {}) {
  const documents = await getAll(STORES.DOCUMENTS);

  return documents
    .filter(document => document.status === DOCUMENT_STATUS.DRAFT)
    .filter(document => !ownerId || document.ownerId === ownerId)
    .filter(document => !type || document.type === type)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function cancelDocument(documentId, { userId = null } = {}) {
  const current = await get(STORES.DOCUMENTS, documentId);
  assertDocumentIsDraft(current);

  const now = new Date().toISOString();
  const cancelled = {
    ...current,
    status: DOCUMENT_STATUS.CANCELLED,
    version: nextEntityVersion(current),
    updatedAt: now,
    metadata: {
      ...(current.metadata || {}),
      cancelledAt: now,
      cancelledBy: userId
    }
  };

  await writeWithSync(
    STORES.DOCUMENTS,
    'document',
    cancelled,
    'UPDATE'
  );

  return cancelled;
}

export async function closeDocument(documentId, { userId = null } = {}) {
  const current = await get(STORES.DOCUMENTS, documentId);
  assertDocumentIsDraft(current);

  if (current.type === DOCUMENT_TYPES.COUNT) {
    return closeCountDocument(documentId, userId);
  }

  if (
    current.type === DOCUMENT_TYPES.ENTRY ||
    current.type === DOCUMENT_TYPES.SUPPLY
  ) {
    return closeInventoryDocument(documentId, userId);
  }

  throw new Error('Este documento no tiene flujo de cierre');
}

async function closeInventoryDocument(documentId, userId) {
  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.MOVEMENTS,
      STORES.LOTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, movementStore, lotStore, queueStore) => {
      const document = await requestToPromise(documentStore.get(documentId));
      assertDocumentIsDraft(document);

      const lines = await requestToPromise(
        lineStore.index('documentId').getAll(documentId)
      );

      if (lines.length === 0) {
        throw new Error('No se puede cerrar un documento vacío');
      }

      const now = new Date().toISOString();
      const movements = [];
      const lots = [];

      for (const line of lines) {
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;

        if (document.type === DOCUMENT_TYPES.SUPPLY) {
          const existingMovements = await requestToPromise(
            movementStore.index('productId').getAll(line.productId)
          );

          const available = calculateStock(
            existingMovements,
            line.productId,
            { locationId: document.locationId }
          );

          if (quantity > available) {
            throw new Error(
              `${line.productName}: el surtido solicita ${quantity}, pero solo hay ${available} disponibles`
            );
          }
        }

        if (document.type === DOCUMENT_TYPES.SUPPLY) {
          const productLots = await requestToPromise(
            lotStore.index('productId').getAll(line.productId)
          );

          const allocation = allocateLotsFefo(productLots, quantity, {
            locationId: document.locationId
          });

          for (const item of allocation.allocations) {
            const currentLot = productLots.find(lot => lot.id === item.lotId);
            if (!currentLot) continue;

            const updatedLot = {
              ...currentLot,
              remainingQuantity: item.afterRemaining,
              version: nextEntityVersion(currentLot),
              updatedAt: now
            };

            await requestToPromise(lotStore.put(updatedLot));
            await requestToPromise(
              queueStore.add(
                createSyncItem('lot', updatedLot.id, 'UPDATE', updatedLot)
              )
            );

            const movement = buildMovement({
              productId: line.productId,
              type: MOVEMENT_TYPES.SUPPLY,
              quantity: item.quantity,
              documentId: document.id,
              lotId: item.lotId,
              locationId: document.locationId,
              userId,
              effectiveAt: now,
              metadata: {
                destinationId: document.destinationId || null,
                lineId: line.id,
                lotNumber: item.lotNumber || null,
                expiresAt: item.expiresAt || null,
                allocation: 'FEFO'
              }
            });

            await requestToPromise(movementStore.add(movement));
            await requestToPromise(
              queueStore.add(buildMovementSyncItem(movement))
            );
            movements.push(movement);
          }

          if (allocation.untrackedQuantity > 0) {
            const movement = buildMovement({
              productId: line.productId,
              type: MOVEMENT_TYPES.SUPPLY,
              quantity: allocation.untrackedQuantity,
              documentId: document.id,
              lotId: null,
              locationId: document.locationId,
              userId,
              effectiveAt: now,
              metadata: {
                destinationId: document.destinationId || null,
                lineId: line.id,
                allocation: 'UNTRACKED'
              }
            });

            await requestToPromise(movementStore.add(movement));
            await requestToPromise(
              queueStore.add(buildMovementSyncItem(movement))
            );
            movements.push(movement);
          }

          continue;
        }

        let lot = null;
        if (line.lotNumber || line.expiresAt) {
          lot = {
            id: createLocalId('lot'),
            productId: line.productId,
            lotNumber: line.lotNumber || '',
            receivedAt: now,
            expiresAt: line.expiresAt || null,
            originalQuantity: quantity,
            remainingQuantity: quantity,
            unitCost: line.unitCost ?? null,
            supplierId: line.supplierId || document.supplierId || null,
            locationId: document.locationId || null,
            documentId: document.id,
            version: initialEntityVersion(),
            createdAt: now,
            updatedAt: now
          };

          await requestToPromise(lotStore.add(lot));
          await requestToPromise(
            queueStore.add(createSyncItem('lot', lot.id, 'CREATE', lot))
          );
          lots.push(lot);
        }

        const movement = buildMovement({
          productId: line.productId,
          type: MOVEMENT_TYPES.ENTRY,
          quantity,
          documentId: document.id,
          lotId: lot?.id || null,
          locationId: document.locationId,
          userId,
          effectiveAt: now,
          metadata: {
            supplierId: line.supplierId || document.supplierId || null,
            unitCost: line.unitCost ?? null,
            lineId: line.id
          }
        });

        await requestToPromise(movementStore.add(movement));
        await requestToPromise(queueStore.add(buildMovementSyncItem(movement)));
        movements.push(movement);
      }

      if (movements.length === 0) {
        throw new Error('El documento no contiene cantidades válidas');
      }

      const closed = {
        ...document,
        status: DOCUMENT_STATUS.CLOSED,
        version: nextEntityVersion(document),
        closedAt: now,
        updatedAt: now,
        closedBy: userId
      };

      await requestToPromise(documentStore.put(closed));
      await requestToPromise(
        queueStore.add(createSyncItem('document', closed.id, 'UPDATE', closed))
      );

      return { document: closed, movements, lots };
    }
  );
}

async function closeCountDocument(documentId, userId) {
  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.MOVEMENTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, movementStore, queueStore) => {
      const document = await requestToPromise(documentStore.get(documentId));
      assertDocumentIsDraft(document);

      const lines = await requestToPromise(
        lineStore.index('documentId').getAll(documentId)
      );

      if (lines.length === 0) {
        throw new Error('No se puede cerrar un conteo vacío');
      }

      const now = new Date().toISOString();
      const movements = [];

      for (const line of lines) {
        const expected = Number(line.expectedStock);
        const counted = Number(line.countedStock);

        if (!Number.isFinite(expected) || !Number.isFinite(counted)) {
          throw new Error(`${line.productName}: conteo inválido`);
        }

        const delta = counted - expected;
        if (delta === 0) continue;

        const movement = buildMovement({
          productId: line.productId,
          type: MOVEMENT_TYPES.ADJUSTMENT,
          quantity: 0,
          delta,
          documentId: document.id,
          locationId: document.locationId,
          userId,
          effectiveAt: line.countedAt || now,
          metadata: {
            expectedStock: expected,
            countedStock: counted,
            lineId: line.id,
            reason: 'Conteo físico'
          }
        });

        await requestToPromise(movementStore.add(movement));
        await requestToPromise(queueStore.add(buildMovementSyncItem(movement)));
        movements.push(movement);
      }

      const closed = {
        ...document,
        status: DOCUMENT_STATUS.CLOSED,
        version: nextEntityVersion(document),
        closedAt: now,
        updatedAt: now,
        closedBy: userId,
        metadata: {
          ...(document.metadata || {}),
          countedLines: lines.length,
          adjustmentLines: movements.length
        }
      };

      await requestToPromise(documentStore.put(closed));
      await requestToPromise(
        queueStore.add(createSyncItem('document', closed.id, 'UPDATE', closed))
      );

      return { document: closed, movements };
    }
  );
}

async function writeWithSync(storeName, entityType, entity, operation) {
  const syncItem = createSyncItem(entityType, entity.id, operation, entity);

  await runTransaction(
    [storeName, STORES.SYNC_QUEUE],
    'readwrite',
    async (entityStore, queueStore) => {
      await requestToPromise(entityStore.put(entity));
      await requestToPromise(queueStore.add(syncItem));
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

function defaultLineId(document, productId, data) {
  if (document.type === DOCUMENT_TYPES.ENTRY && data.forceNewLine) {
    return createLocalId('line');
  }

  if (document.type === DOCUMENT_TYPES.ENTRY && data.lotNumber) {
    const lotKey = normalizeText(data.lotNumber).toLowerCase();
    return `line_${document.id}_${productId}_lot_${encodeURIComponent(lotKey)}`;
  }

  return `line_${document.id}_${productId}`;
}

function optionalNonNegativeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  return assertNonNegativeNumber(value, 'Costo');
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Fecha inválida');
  }
  return date.toISOString();
}

function prefixForDocument(type) {
  switch (type) {
    case DOCUMENT_TYPES.COUNT:
      return 'cnt';
    case DOCUMENT_TYPES.ENTRY:
      return 'ent';
    case DOCUMENT_TYPES.SUPPLY:
      return 'sur';
    default:
      return 'doc';
  }
}
