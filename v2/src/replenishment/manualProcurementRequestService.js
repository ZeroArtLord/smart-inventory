import { createLocalId } from '../core/ids.js';
import {
  STORES,
  get,
  getAll,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';

export async function setManualProcurementRequested(
  productId,
  requested,
  {
    userId = null,
    source = 'COUNT'
  } = {}
) {
  const current = await get(
    STORES.PRODUCTS,
    productId
  );

  if (!current) {
    throw new Error('Producto no encontrado');
  }

  const enabled = requested === true;
  const now = new Date().toISOString();

  const fields = {
    manualProcurementRequested: enabled,
    manualProcurementRequestedAt:
      enabled ? now : null,
    manualProcurementRequestedBy:
      enabled
        ? (String(userId || '').trim() || null)
        : null,
    manualProcurementRequestedSource:
      enabled
        ? (String(source || 'COUNT').trim() || 'COUNT')
        : null
  };

  const updated = {
    ...current,
    ...fields
  };

  const syncItem = {
    id: createLocalId('sync'),
    entityType: 'manualProcurementRequest',
    entityId: current.id,
    operation: 'UPDATE',
    payload: {
      id: current.id,
      productId: current.id,
      requested: enabled,
      requestedAt:
        fields.manualProcurementRequestedAt,
      requestedBy:
        fields.manualProcurementRequestedBy,
      source:
        fields.manualProcurementRequestedSource
    },
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null
  };

  await runTransaction(
    [STORES.PRODUCTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (productStore, queueStore) => {
      await requestToPromise(
        productStore.put(updated)
      );
      await requestToPromise(
        queueStore.add(syncItem)
      );
    }
  );

  return updated;
}

export async function listManualProcurementRequestedProducts() {
  const products = await getAll(STORES.PRODUCTS);

  return products
    .filter(product =>
      product?.active !== false &&
      product?.manualProcurementRequested === true
    )
    .sort((a, b) =>
      String(a.name || '').localeCompare(
        String(b.name || ''),
        'es'
      )
    );
}

export async function clearManualProcurementRequests(
  productIds = [],
  options = {}
) {
  const ids = [...new Set(
    (Array.isArray(productIds) ? productIds : [productIds])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];

  const updated = [];

  for (const productId of ids) {
    const current = await get(
      STORES.PRODUCTS,
      productId
    );

    if (
      !current ||
      current.manualProcurementRequested !== true
    ) {
      continue;
    }

    updated.push(
      await setManualProcurementRequested(
        productId,
        false,
        options
      )
    );
  }

  return updated;
}
