import {
  STORES,
  get,
  getAll,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import {
  getSyncConfig
} from './syncSettings.js';
import {
  SYNC_STATUS
} from './localQueue.js';

const BINDING_KEY = 'workspace.cache.binding';
const CONFIG_KEY = 'sync.config';
const CURSOR_KEY = 'sync.cursor';

export const WORKSPACE_OPERATIONAL_STORES = Object.freeze([
  STORES.PRODUCTS,
  STORES.CATEGORIES,
  STORES.SUPPLIERS,
  STORES.LOCATIONS,
  STORES.MOVEMENTS,
  STORES.DOCUMENTS,
  STORES.DOCUMENT_LINES,
  STORES.LOTS,
  STORES.REPLENISHMENTS,
  STORES.SYNC_QUEUE
]);

export async function getWorkspaceCacheBinding() {
  const record = await get(
    STORES.SETTINGS,
    BINDING_KEY
  );

  return record?.value || null;
}

export async function listWorkspaceSwitchBlockers() {
  const queue = await getAll(STORES.SYNC_QUEUE);

  return queue.filter(item =>
    item.status !== SYNC_STATUS.SYNCED
  );
}

export async function ensureWorkspaceCache(
  workspaceId,
  {
    adoptUnbound = false
  } = {}
) {
  const target = normalizeWorkspaceId(workspaceId);
  const binding = await getWorkspaceCacheBinding();
  const config = await getSyncConfig();

  if (binding?.workspaceId === target) {
    return {
      ok: true,
      workspaceId: target,
      action: 'already-bound'
    };
  }

  if (binding?.workspaceId) {
    const error = new Error(
      'El cache local pertenece a otro almacén. Debes cambiar de workspace de forma controlada.'
    );
    error.code = 'WORKSPACE_CACHE_MISMATCH';
    error.details = {
      cachedWorkspaceId: binding.workspaceId,
      requestedWorkspaceId: target
    };
    throw error;
  }

  const hasOperationalData =
    await hasAnyOperationalData();

  if (
    hasOperationalData &&
    !adoptUnbound &&
    config.workspaceId !== target
  ) {
    const error = new Error(
      'Hay datos locales sin un workspace identificado. No se pueden reasignar automáticamente.'
    );
    error.code = 'WORKSPACE_CACHE_UNBOUND_DATA';
    error.details = {
      requestedWorkspaceId: target,
      configuredWorkspaceId:
        config.workspaceId || null
    };
    throw error;
  }

  await writeBindingOnly(target);

  return {
    ok: true,
    workspaceId: target,
    action: hasOperationalData
      ? 'adopted-existing'
      : 'bound-empty'
  };
}

export async function switchWorkspaceCacheAndConfig(
  workspaceId,
  configPatch = {},
  {
    adoptUnbound = false
  } = {}
) {
  const target = normalizeWorkspaceId(workspaceId);
  const currentConfig = await getSyncConfig();
  const binding = await getWorkspaceCacheBinding();

  if (
    binding?.workspaceId === target &&
    currentConfig.workspaceId === target
  ) {
    return updateConfigOnly(
      target,
      currentConfig,
      configPatch
    );
  }

  const blockers = await listWorkspaceSwitchBlockers();

  if (
    binding?.workspaceId &&
    binding.workspaceId !== target &&
    blockers.length > 0
  ) {
    throw switchBlockedError(
      binding.workspaceId,
      target,
      blockers
    );
  }

  const hasOperationalData =
    await hasAnyOperationalData();

  const canAdoptUnbound =
    !binding?.workspaceId &&
    hasOperationalData &&
    (
      adoptUnbound ||
      currentConfig.workspaceId === target
    );

  if (canAdoptUnbound) {
    return adoptExistingCacheAndConfig(
      target,
      currentConfig,
      configPatch
    );
  }

  if (
    !binding?.workspaceId &&
    hasOperationalData &&
    blockers.length > 0
  ) {
    throw switchBlockedError(
      currentConfig.workspaceId || null,
      target,
      blockers
    );
  }

  return replaceCacheAndConfig(
    target,
    currentConfig,
    configPatch
  );
}

async function updateConfigOnly(
  workspaceId,
  currentConfig,
  configPatch
) {
  const now = new Date().toISOString();
  const nextConfig = {
    ...currentConfig,
    ...configPatch,
    workspaceId
  };

  await runTransaction(
    STORES.SETTINGS,
    'readwrite',
    settingsStore =>
      requestToPromise(
        settingsStore.put({
          key: CONFIG_KEY,
          value: nextConfig,
          updatedAt: now
        })
      )
  );

  return {
    config: nextConfig,
    workspaceId,
    action: 'config-updated',
    cleared: false
  };
}

async function adoptExistingCacheAndConfig(
  workspaceId,
  currentConfig,
  configPatch
) {
  const now = new Date().toISOString();
  const nextConfig = {
    ...currentConfig,
    ...configPatch,
    workspaceId
  };

  await runTransaction(
    STORES.SETTINGS,
    'readwrite',
    async settingsStore => {
      await requestToPromise(
        settingsStore.put({
          key: CONFIG_KEY,
          value: nextConfig,
          updatedAt: now
        })
      );

      await requestToPromise(
        settingsStore.put({
          key: BINDING_KEY,
          value: {
            workspaceId,
            boundAt: now,
            adoptedExisting: true
          },
          updatedAt: now
        })
      );
    }
  );

  return {
    config: nextConfig,
    workspaceId,
    action: 'adopted-existing',
    cleared: false
  };
}

async function replaceCacheAndConfig(
  workspaceId,
  currentConfig,
  configPatch
) {
  const now = new Date().toISOString();
  const nextConfig = {
    ...currentConfig,
    ...configPatch,
    workspaceId
  };

  const stores = [
    ...WORKSPACE_OPERATIONAL_STORES,
    STORES.SETTINGS
  ];

  await runTransaction(
    stores,
    'readwrite',
    async (...args) => {
      const operationalStores = args.slice(
        0,
        WORKSPACE_OPERATIONAL_STORES.length
      );
      const settingsStore =
        args[WORKSPACE_OPERATIONAL_STORES.length];

      for (const store of operationalStores) {
        await requestToPromise(store.clear());
      }

      await requestToPromise(
        settingsStore.put({
          key: CURSOR_KEY,
          value: 0,
          updatedAt: now
        })
      );

      await requestToPromise(
        settingsStore.put({
          key: CONFIG_KEY,
          value: nextConfig,
          updatedAt: now
        })
      );

      await requestToPromise(
        settingsStore.put({
          key: BINDING_KEY,
          value: {
            workspaceId,
            boundAt: now,
            adoptedExisting: false
          },
          updatedAt: now
        })
      );
    }
  );

  return {
    config: nextConfig,
    workspaceId,
    action: 'cache-replaced',
    cleared: true
  };
}

async function writeBindingOnly(workspaceId) {
  const now = new Date().toISOString();

  await runTransaction(
    STORES.SETTINGS,
    'readwrite',
    settingsStore =>
      requestToPromise(
        settingsStore.put({
          key: BINDING_KEY,
          value: {
            workspaceId,
            boundAt: now,
            adoptedExisting: true
          },
          updatedAt: now
        })
      )
  );
}

async function hasAnyOperationalData() {
  for (const storeName of WORKSPACE_OPERATIONAL_STORES) {
    const rows = await getAll(storeName);
    if (rows.length > 0) return true;
  }

  return false;
}

function switchBlockedError(
  fromWorkspaceId,
  targetWorkspaceId,
  blockers
) {
  const counts = {};

  for (const item of blockers) {
    const status = item.status || 'UNKNOWN';
    counts[status] = (counts[status] || 0) + 1;
  }

  const error = new Error(
    'No puedes cambiar de almacén mientras existan cambios locales pendientes, fallidos o en conflicto.'
  );

  error.code = 'WORKSPACE_SWITCH_BLOCKED';
  error.details = {
    fromWorkspaceId,
    targetWorkspaceId,
    blockers: blockers.length,
    statuses: counts
  };

  return error;
}

function normalizeWorkspaceId(workspaceId) {
  const value = String(workspaceId || '').trim();

  if (!value) {
    throw new Error('workspaceId requerido');
  }

  return value;
}
