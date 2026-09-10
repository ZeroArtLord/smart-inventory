import { apiRequest } from '../api/apiClient.js';
import {
  STORES,
  get,
  getAll,
  put
} from '../storage/database.js';

const EPSILON = 0.000001;

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
  if (refresh && navigator.onLine) {
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
  if (!navigator.onLine) return { synced: 0, pending: 0 };

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

async function trySyncAreaDelivery(record) {
  if (!navigator.onLine || record.status !== 'CLOSED') return false;

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

function positive(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
}

function clean(value) {
  return String(value ?? '').trim();
}
