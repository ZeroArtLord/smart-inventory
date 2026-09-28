import {
  STORES,
  get,
  put,
  remove
} from '../storage/database.js';

const SNAPSHOT_VERSION = 1;
const SETTINGS_PREFIX = 'procurement.workspaceDraft.v1';
const LOCAL_PREFIX = 'vigia.procurement.workspaceDraft.v1';

export function procurementWorkspaceDraftKey({
  workspaceId,
  userId
} = {}) {
  const workspace = cleanKeyPart(workspaceId);
  const user = cleanKeyPart(userId);

  if (!workspace || !user) return null;
  return `${SETTINGS_PREFIX}:${workspace}:${user}`;
}

export function buildProcurementWorkspaceDraft({
  workspaceId,
  userId,
  drafts = [],
  pendingExtras = [],
  updatedAt = new Date().toISOString()
} = {}) {
  const key = procurementWorkspaceDraftKey({
    workspaceId,
    userId
  });

  if (!key) {
    throw new Error(
      'No se puede guardar el borrador sin almacén y usuario'
    );
  }

  const sourceDrafts =
    drafts instanceof Map
      ? [...drafts.values()]
      : Array.isArray(drafts)
        ? drafts
        : [];

  return {
    version: SNAPSHOT_VERSION,
    key,
    workspaceId: String(workspaceId),
    userId: String(userId),
    drafts: sourceDrafts
      .filter(isMeaningfulDraft)
      .map(sanitizeDraft),
    pendingExtras: Array.isArray(pendingExtras)
      ? pendingExtras.map(sanitizeExtra)
      : [],
    updatedAt
  };
}

export async function saveProcurementWorkspaceDraft(input = {}) {
  const snapshot = buildProcurementWorkspaceDraft(input);
  writeLocalSnapshot(snapshot.key, snapshot);

  await put(STORES.SETTINGS, {
    key: snapshot.key,
    value: snapshot,
    updatedAt: snapshot.updatedAt
  });

  return snapshot;
}

export async function loadProcurementWorkspaceDraft({
  workspaceId,
  userId
} = {}) {
  const key = procurementWorkspaceDraftKey({
    workspaceId,
    userId
  });

  if (!key) return null;

  const local = readLocalSnapshot(key);
  let indexed = null;

  try {
    const record = await get(STORES.SETTINGS, key);
    indexed = normalizeSnapshot(record?.value, key);
  } catch (_) {
    indexed = null;
  }

  const winner = newestSnapshot(
    normalizeSnapshot(local, key),
    indexed
  );

  if (!winner || winner.cleared === true) {
    return null;
  }

  return winner;
}

export async function clearProcurementWorkspaceDraft({
  workspaceId,
  userId
} = {}) {
  const key = procurementWorkspaceDraftKey({
    workspaceId,
    userId
  });

  if (!key) return false;

  const tombstone = {
    version: SNAPSHOT_VERSION,
    key,
    workspaceId: String(workspaceId),
    userId: String(userId),
    drafts: [],
    pendingExtras: [],
    cleared: true,
    updatedAt: new Date().toISOString()
  };

  // El tombstone síncrono evita que un registro IndexedDB antiguo
  // reaparezca si el navegador se cierra justo después de confirmar.
  writeLocalSnapshot(key, tombstone);

  try {
    await remove(STORES.SETTINGS, key);
  } catch (_) {
    // El tombstone local sigue siendo la fuente más nueva.
  }

  return true;
}

function isMeaningfulDraft(draft) {
  if (!draft || !draft.productId) return false;

  return (
    draft.selected === true ||
    draft.manual === true ||
    draft.dirty === true ||
    Boolean(String(draft.note || '').trim())
  );
}

function sanitizeDraft(draft) {
  return {
    productId: String(draft.productId),
    selected: draft.selected === true,
    manual: draft.manual === true,
    source: String(
      draft.source ||
      (draft.manual ? 'MANUAL' : 'VIGIA_SUGGESTION')
    ),
    displayQuantity: finiteNonNegative(
      draft.displayQuantity,
      0
    ),
    displayUnit: String(draft.displayUnit || 'UND'),
    displayConversion: finitePositive(
      draft.displayConversion,
      1
    ),
    method:
      draft.method === 'ORDER'
        ? 'ORDER'
        : 'PURCHASE',
    note: String(draft.note || '').slice(0, 180),
    dirty: true
  };
}

function sanitizeExtra(extra) {
  return {
    id: String(extra?.id || ''),
    description: String(extra?.description || '').slice(0, 180),
    displayQuantity: finiteNonNegative(
      extra?.displayQuantity,
      0
    ),
    requestedQuantity: finiteNonNegative(
      extra?.requestedQuantity,
      0
    ),
    unit: String(extra?.unit || 'UND'),
    method:
      extra?.method === 'ORDER'
        ? 'ORDER'
        : 'PURCHASE',
    notes: String(extra?.notes || '').slice(0, 180),
    categoryName: String(
      extra?.categoryName || 'EXTRAS'
    )
  };
}

function normalizeSnapshot(value, expectedKey) {
  if (!value || typeof value !== 'object') return null;
  if (value.key !== expectedKey) return null;
  if (Number(value.version) !== SNAPSHOT_VERSION) return null;

  return {
    ...value,
    drafts: Array.isArray(value.drafts)
      ? value.drafts
      : [],
    pendingExtras: Array.isArray(value.pendingExtras)
      ? value.pendingExtras
      : []
  };
}

function newestSnapshot(a, b) {
  if (!a) return b;
  if (!b) return a;

  const aTime = Date.parse(a.updatedAt || '') || 0;
  const bTime = Date.parse(b.updatedAt || '') || 0;

  return aTime >= bTime ? a : b;
}

function localStorageKey(key) {
  return `${LOCAL_PREFIX}:${key}`;
}

function writeLocalSnapshot(key, snapshot) {
  try {
    globalThis.localStorage?.setItem(
      localStorageKey(key),
      JSON.stringify(snapshot)
    );
  } catch (_) {}
}

function readLocalSnapshot(key) {
  try {
    const raw = globalThis.localStorage?.getItem(
      localStorageKey(key)
    );
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function cleanKeyPart(value) {
  return String(value ?? '').trim();
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number
    : fallback;
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : fallback;
}
