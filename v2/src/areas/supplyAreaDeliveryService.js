import { apiRequest } from '../api/apiClient.js';
import {
  STORES,
  get,
  getAll,
  getAllByIndex,
  put,
  remove
} from '../storage/database.js';

const EPSILON = 0.000001;
const draftSyncChains = new Map();

export async function createAreaDeliveryIntent({
  deliveryToken,
  parentCartId,
  rows,
  userId = null
}) {
  const id = clean(deliveryToken);
  if (!id) throw new Error('Token de distribución requerido');

  const normalizedRows = normalizeRows(rows);
  const now = new Date().toISOString();
  const existing = await get(STORES.SUPPLY_AREA_DELIVERIES, id);

  if (existing) {
    if (canonicalRows(existing.rows) !== canonicalRows(normalizedRows)) {
      throw new Error('Ese token ya pertenece a otra distribución por áreas');
    }
    return existing;
  }

  const record = {
    id,
    deliveryToken: id,
    deliveryId: null,
    parentCartId: clean(parentCartId),
    rows: normalizedRows,
    status: 'PENDING',
    syncStatus: 'LOCAL_ONLY',
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    syncError: null
  };

  await put(STORES.SUPPLY_AREA_DELIVERIES, record);
  return record;
}

export async function completeAreaDelivery({
  deliveryToken,
  deliveryId,
  closedAt = null
}) {
  const id = clean(deliveryToken);
  const current = await get(STORES.SUPPLY_AREA_DELIVERIES, id);
  if (!current) throw new Error('No se encontró la distribución preparada');

  const updated = {
    ...current,
    deliveryId: clean(deliveryId),
    status: 'CLOSED',
    syncStatus: 'PENDING',
    closedAt: closedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncError: null
  };

  await put(STORES.SUPPLY_AREA_DELIVERIES, updated);
  await trySyncAreaDelivery(updated);
  return get(STORES.SUPPLY_AREA_DELIVERIES, id);
}

export async function failAreaDeliveryIntent(deliveryToken, error) {
  const id = clean(deliveryToken);
  const current = await get(STORES.SUPPLY_AREA_DELIVERIES, id);
  if (!current || current.status === 'CLOSED') return current;

  const updated = {
    ...current,
    status: 'FAILED',
    updatedAt: new Date().toISOString(),
    syncError: clean(error?.message || error || 'Entrega no completada')
  };
  await put(STORES.SUPPLY_AREA_DELIVERIES, updated);
  return updated;
}

export async function listAreaDeliveries({
  from = null,
  refresh = false
} = {}) {
  if (refresh && isOnline()) {
    try {
      await refreshAreaDeliveries({ from });
    } catch (error) {
      console.warn('No se pudo refrescar consumo por áreas; se usa caché local.', error);
    }
  }

  return (await getAll(STORES.SUPPLY_AREA_DELIVERIES))
    .filter(record => record.status === 'CLOSED')
    .filter(record => !from || new Date(record.closedAt || 0) >= new Date(from))
    .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));
}

export async function refreshAreaDeliveries({ from = null } = {}) {
  const query = from
    ? `?from=${encodeURIComponent(new Date(from).toISOString())}`
    : '';
  const data = await apiRequest(`/api/v1/areas/deliveries${query}`);
  const records = Array.isArray(data.deliveries) ? data.deliveries : [];

  for (const serverRecord of records) {
    const record = normalizeServerRecord(serverRecord);
    const local = await get(STORES.SUPPLY_AREA_DELIVERIES, record.id);
    if (!local || local.status !== 'PENDING') {
      await put(STORES.SUPPLY_AREA_DELIVERIES, record);
    }
  }

  return records;
}

export async function syncPendingAreaDeliveries() {
  if (!isOnline()) return { synced: 0, pending: 0 };

  const records = (await getAll(STORES.SUPPLY_AREA_DELIVERIES))
    .filter(record => record.status === 'CLOSED')
    .filter(record => record.syncStatus !== 'SYNCED');

  let synced = 0;
  for (const record of records) {
    const ok = await trySyncAreaDelivery(record);
    if (ok) synced += 1;
  }

  return { synced, pending: records.length - synced };
}

export async function reconcilePendingAreaDeliveries() {
  const [records, documents] = await Promise.all([
    getAll(STORES.SUPPLY_AREA_DELIVERIES),
    getAll(STORES.DOCUMENTS)
  ]);

  const closedByToken = new Map(
    documents
      .filter(document => document?.status === 'CLOSED')
      .filter(document => document?.metadata?.deliveryToken)
      .map(document => [document.metadata.deliveryToken, document])
  );

  for (const record of records.filter(item => item.status === 'PENDING')) {
    const delivery = closedByToken.get(record.deliveryToken);
    if (!delivery) continue;
    await completeAreaDelivery({
      deliveryToken: record.deliveryToken,
      deliveryId: delivery.id,
      closedAt: delivery.closedAt || delivery.updatedAt
    });
  }
}

export async function getLastAreaPattern(productId) {
  const id = clean(productId);
  if (!id) return [];

  const records = (await getAll(STORES.SUPPLY_AREA_DELIVERIES))
    .filter(record => record.status === 'CLOSED')
    .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));

  for (const record of records) {
    const row = record.rows?.find(item => item.productId === id);
    if (!row?.allocations?.length || Number(row.quantity || 0) <= EPSILON) continue;
    return row.allocations.map(allocation => ({
      areaId: allocation.areaId,
      ratio: Number(allocation.quantity || 0) / Number(row.quantity)
    }));
  }

  return [];
}

export async function loadAreaAllocationDrafts(
  parentCartId,
  { refresh = true } = {}
) {
  const cartId = clean(parentCartId);
  if (!cartId) return [];

  if (refresh && isOnline()) {
    await syncPendingAreaDrafts(cartId).catch(() => null);

    try {
      const data = await apiRequest(
        `/api/v1/areas/drafts?parentCartId=${encodeURIComponent(cartId)}`
      );
      const serverDrafts = Array.isArray(data.drafts) ? data.drafts : [];
      const localDrafts = await getAllByIndex(
        STORES.SUPPLY_AREA_DRAFTS,
        'parentCartId',
        cartId
      );
      const localById = new Map(localDrafts.map(item => [item.id, item]));
      const serverIds = new Set();

      for (const source of serverDrafts) {
        const remote = normalizeServerDraft(source);
        serverIds.add(remote.id);
        const local = localById.get(remote.id);
        const localPending = local && local.syncStatus !== 'SYNCED';
        const localIsNewer = localPending &&
          String(local.updatedAt || '') > String(remote.updatedAt || '');

        if (!localIsNewer) {
          await put(STORES.SUPPLY_AREA_DRAFTS, remote);
        }
      }

      for (const local of localDrafts) {
        if (
          local.syncStatus === 'SYNCED' &&
          !serverIds.has(local.id)
        ) {
          await remove(STORES.SUPPLY_AREA_DRAFTS, local.id);
        }
      }
    } catch (error) {
      console.warn('No se pudieron refrescar borradores de áreas; se usa copia local.', error);
    }
  }

  return (await getAllByIndex(
    STORES.SUPPLY_AREA_DRAFTS,
    'parentCartId',
    cartId
  ))
    .filter(record => record.deleted !== true)
    .sort((a, b) => String(a.productId).localeCompare(String(b.productId)));
}

export async function saveAreaAllocationDraft(
  draft,
  { sync = true } = {}
) {
  const normalized = normalizeDraft(draft);
  const now = new Date().toISOString();
  const record = {
    ...normalized,
    id: draftKey(normalized.parentCartId, normalized.productId),
    syncStatus: 'PENDING',
    updatedAt: now,
    syncedAt: null,
    syncError: null,
    deleted: false
  };

  await put(STORES.SUPPLY_AREA_DRAFTS, record);

  if (!sync || !isOnline()) return record;
  return syncOneAreaDraft(record);
}

export async function syncPendingAreaDrafts(parentCartId = null) {
  if (!isOnline()) return { synced: 0, pending: 0 };

  const cartId = clean(parentCartId);
  const records = (await getAll(STORES.SUPPLY_AREA_DRAFTS))
    .filter(record => !cartId || record.parentCartId === cartId)
    .filter(record => record.syncStatus !== 'SYNCED');

  let synced = 0;
  const deleteGroups = new Map();

  for (const record of records) {
    if (record.syncStatus === 'PENDING_DELETE' || record.deleted === true) {
      if (!deleteGroups.has(record.parentCartId)) {
        deleteGroups.set(record.parentCartId, []);
      }
      deleteGroups.get(record.parentCartId).push(record.productId);
      continue;
    }

    const result = await syncOneAreaDraft(record);
    if (result?.syncStatus === 'SYNCED') synced += 1;
  }

  for (const [targetCartId, productIds] of deleteGroups) {
    try {
      await deleteRemoteDrafts(targetCartId, productIds);
      for (const productId of productIds) {
        await remove(
          STORES.SUPPLY_AREA_DRAFTS,
          draftKey(targetCartId, productId)
        );
        synced += 1;
      }
    } catch {
      // Se conservan las lápidas para reintentar cuando vuelva la conectividad.
    }
  }

  return {
    synced,
    pending: Math.max(0, records.length - synced)
  };
}

export async function deleteAreaAllocationDrafts({
  parentCartId,
  productIds = []
} = {}) {
  const cartId = clean(parentCartId);
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map(clean)
    .filter(Boolean))];

  if (!cartId || !ids.length) {
    return { deleted: 0, pending: 0 };
  }

  const now = new Date().toISOString();
  for (const productId of ids) {
    const id = draftKey(cartId, productId);
    const current = await get(STORES.SUPPLY_AREA_DRAFTS, id);
    await put(STORES.SUPPLY_AREA_DRAFTS, {
      ...(current || {
        id,
        parentCartId: cartId,
        productId,
        productName: productId,
        quantity: 1,
        allocations: []
      }),
      deleted: true,
      syncStatus: 'PENDING_DELETE',
      updatedAt: now,
      syncError: null
    });
  }

  if (!isOnline()) {
    return { deleted: 0, pending: ids.length };
  }

  try {
    await deleteRemoteDrafts(cartId, ids);
    for (const productId of ids) {
      await remove(
        STORES.SUPPLY_AREA_DRAFTS,
        draftKey(cartId, productId)
      );
    }
    return { deleted: ids.length, pending: 0 };
  } catch (error) {
    for (const productId of ids) {
      const id = draftKey(cartId, productId);
      const current = await get(STORES.SUPPLY_AREA_DRAFTS, id);
      if (current) {
        await put(STORES.SUPPLY_AREA_DRAFTS, {
          ...current,
          syncError: clean(error?.message || error)
        });
      }
    }
    return { deleted: 0, pending: ids.length };
  }
}

async function syncOneAreaDraft(record) {
  const key = record.id;
  return enqueueDraftSync(key, async () => {
    const currentBefore = await get(STORES.SUPPLY_AREA_DRAFTS, key);
    if (!currentBefore || currentBefore.deleted === true) {
      return currentBefore;
    }

    const source = currentBefore.updatedAt === record.updatedAt
      ? record
      : currentBefore;

    try {
      const data = await apiRequest(
        `/api/v1/areas/drafts/${encodeURIComponent(source.parentCartId)}/${encodeURIComponent(source.productId)}`,
        {
          method: 'PUT',
          body: {
            productName: source.productName,
            quantity: source.quantity,
            allocations: source.allocations
          }
        }
      );
      const remote = normalizeServerDraft(data.draft || {});
      const latest = await get(STORES.SUPPLY_AREA_DRAFTS, key);

      if (
        latest &&
        latest.deleted !== true &&
        latest.updatedAt === source.updatedAt
      ) {
        const synced = {
          ...remote,
          syncStatus: 'SYNCED',
          syncedAt: new Date().toISOString(),
          syncError: null,
          deleted: false
        };
        await put(STORES.SUPPLY_AREA_DRAFTS, synced);
        return synced;
      }

      return latest;
    } catch (error) {
      const latest = await get(STORES.SUPPLY_AREA_DRAFTS, key);
      if (latest && latest.updatedAt === source.updatedAt) {
        const pending = {
          ...latest,
          syncStatus: 'PENDING',
          syncError: clean(error?.message || error)
        };
        await put(STORES.SUPPLY_AREA_DRAFTS, pending);
        return pending;
      }
      return latest;
    }
  });
}

function enqueueDraftSync(key, operation) {
  const previous = draftSyncChains.get(key) || Promise.resolve();
  const next = previous
    .catch(() => null)
    .then(operation)
    .finally(() => {
      if (draftSyncChains.get(key) === next) {
        draftSyncChains.delete(key);
      }
    });
  draftSyncChains.set(key, next);
  return next;
}

async function deleteRemoteDrafts(parentCartId, productIds) {
  return apiRequest('/api/v1/areas/drafts', {
    method: 'DELETE',
    body: {
      parentCartId,
      productIds
    }
  });
}

async function trySyncAreaDelivery(record) {
  if (!isOnline() || record.status !== 'CLOSED') return false;

  try {
    await apiRequest('/api/v1/areas/deliveries', {
      method: 'POST',
      body: {
        deliveryToken: record.deliveryToken,
        deliveryId: record.deliveryId,
        parentCartId: record.parentCartId,
        rows: record.rows,
        closedAt: record.closedAt
      }
    });

    await put(STORES.SUPPLY_AREA_DELIVERIES, {
      ...record,
      syncStatus: 'SYNCED',
      syncError: null,
      syncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    await put(STORES.SUPPLY_AREA_DELIVERIES, {
      ...record,
      syncStatus: 'PENDING',
      syncError: clean(error?.message || error),
      updatedAt: new Date().toISOString()
    });
    return false;
  }
}

function normalizeDraft(draft = {}) {
  const parentCartId = clean(draft.parentCartId);
  const productId = clean(draft.productId);
  const productName = clean(draft.productName || productId);
  const quantity = positive(draft.quantity, 'Cantidad de surtido inválida');
  const allocations = Array.isArray(draft.allocations)
    ? draft.allocations.map(item => ({
        areaId: clean(item?.areaId),
        areaName: clean(item?.areaName),
        quantity: positive(item?.quantity, 'Cantidad de área inválida')
      }))
    : [];

  if (!parentCartId) throw new Error('Surtido requerido para guardar distribución');
  if (!productId) throw new Error('Producto requerido para guardar distribución');
  if (!productName) throw new Error('Nombre de producto requerido');

  const unique = new Set(allocations.map(item => item.areaId));
  if (unique.size !== allocations.length || unique.has('')) {
    throw new Error('La distribución contiene áreas inválidas o repetidas');
  }

  return {
    parentCartId,
    productId,
    productName,
    quantity,
    allocations
  };
}

function normalizeServerDraft(record = {}) {
  const normalized = normalizeDraft(record);
  return {
    ...normalized,
    id: draftKey(normalized.parentCartId, normalized.productId),
    syncStatus: 'SYNCED',
    updatedBy: record.updatedBy || null,
    createdAt: record.createdAt || record.updatedAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
    syncedAt: new Date().toISOString(),
    syncError: null,
    deleted: false
  };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('La entrega no tiene distribuciones por área');
  }

  return rows.map(row => {
    const quantity = positive(row.quantity, 'Cantidad de entrega inválida');
    const allocations = Array.isArray(row.allocations)
      ? row.allocations.map(allocation => ({
          areaId: clean(allocation.areaId),
          areaName: clean(allocation.areaName),
          quantity: positive(allocation.quantity, 'Cantidad de área inválida')
        }))
      : [];

    if (!allocations.length) {
      throw new Error(`Distribuye ${clean(row.productName || row.productId)} por áreas`);
    }

    const unique = new Set(allocations.map(item => item.areaId));
    if (unique.size !== allocations.length || unique.has('')) {
      throw new Error('La distribución contiene áreas inválidas o repetidas');
    }

    const total = allocations.reduce((sum, item) => sum + item.quantity, 0);
    if (Math.abs(total - quantity) > EPSILON) {
      throw new Error(
        `La distribución de ${clean(row.productName || row.productId)} debe sumar ${quantity}`
      );
    }

    return {
      productId: clean(row.productId),
      productName: clean(row.productName || row.productId),
      quantity,
      allocations
    };
  });
}

function normalizeServerRecord(record = {}) {
  return {
    id: clean(record.deliveryToken),
    deliveryToken: clean(record.deliveryToken),
    deliveryId: clean(record.deliveryId),
    parentCartId: clean(record.parentCartId),
    rows: normalizeRows(record.rows || []),
    status: 'CLOSED',
    syncStatus: 'SYNCED',
    createdBy: record.createdBy || null,
    createdAt: record.createdAt || record.closedAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.closedAt || new Date().toISOString(),
    closedAt: record.closedAt,
    syncedAt: new Date().toISOString(),
    syncError: null
  };
}

function canonicalRows(rows) {
  return JSON.stringify(
    normalizeRows(rows)
      .map(row => ({
        productId: row.productId,
        quantity: row.quantity,
        allocations: row.allocations
          .map(item => ({ areaId: item.areaId, quantity: item.quantity }))
          .sort((a, b) => a.areaId.localeCompare(b.areaId))
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId))
  );
}

function draftKey(parentCartId, productId) {
  return `${clean(parentCartId)}::${clean(productId)}`;
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function positive(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
}

function clean(value) {
  return String(value ?? '').trim();
}