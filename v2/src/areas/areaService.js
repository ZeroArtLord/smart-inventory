import { apiRequest } from '../api/apiClient.js';
import {
  STORES,
  getAll,
  put,
  requestToPromise,
  runTransaction
} from '../storage/database.js';

export async function listAreas({ includeInactive = false, refresh = false } = {}) {
  if (refresh && navigator.onLine) {
    try {
      await refreshAreas();
    } catch (error) {
      console.warn('No se pudieron refrescar las áreas; se usa caché local.', error);
    }
  }

  const areas = await getAll(STORES.AREAS);
  return areas
    .filter(area => includeInactive || area.active !== false)
    .sort(compareAreas);
}

export async function refreshAreas() {
  const data = await apiRequest('/api/v1/areas?includeInactive=1');
  const areas = Array.isArray(data.areas) ? data.areas : [];

  await runTransaction(STORES.AREAS, 'readwrite', async store => {
    await requestToPromise(store.clear());
    for (const area of areas) {
      await requestToPromise(store.put(normalizeArea(area)));
    }
  });

  return areas.map(normalizeArea).sort(compareAreas);
}

export async function createArea({ name, sortOrder = 0 } = {}) {
  requireOnlineWrite();

  const data = await apiRequest('/api/v1/areas', {
    method: 'POST',
    body: { name, sortOrder }
  });

  const area = normalizeArea(data.area);
  await put(STORES.AREAS, area);
  return area;
}

export async function updateArea(areaId, patch = {}) {
  requireOnlineWrite();

  const data = await apiRequest(
    `/api/v1/areas/${encodeURIComponent(areaId)}`,
    {
      method: 'PATCH',
      body: patch
    }
  );

  const area = normalizeArea(data.area);
  await put(STORES.AREAS, area);
  return area;
}

function requireOnlineWrite() {
  if (!navigator.onLine) {
    const error = new Error(
      'Conéctate para administrar áreas. Los surtidos pueden seguir usando las áreas ya guardadas en este dispositivo.'
    );
    error.code = 'AREA_ADMIN_OFFLINE';
    throw error;
  }
}

function normalizeArea(area = {}) {
  return {
    id: String(area.id || ''),
    name: String(area.name || '').trim(),
    active: area.active !== false,
    sortOrder: Number.isFinite(Number(area.sortOrder))
      ? Number(area.sortOrder)
      : 0,
    createdAt: area.createdAt || null,
    updatedAt: area.updatedAt || null
  };
}

function compareAreas(a, b) {
  return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'es');
}
