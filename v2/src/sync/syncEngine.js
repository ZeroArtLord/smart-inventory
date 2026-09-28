import {
  listPendingOperations,
  markSyncing,
  markSynced,
  markFailed,
  markPending,
  markConflict,
  recoverInterruptedOperations,
  pruneSyncedOperations
} from './localQueue.js';
import {
  getSyncConfig,
  saveSyncConfig,
  getSyncCursor,
  saveSyncCursor,
  buildApiUrl
} from './syncSettings.js';
import { applyRemoteEvents } from './remoteApply.js';
import { getAuthToken } from '../auth/authProvider.js';
import {
  ensureWorkspaceCache,
  switchWorkspaceCacheAndConfig
} from './workspaceCache.js';

const listeners = new Set();
const ENTITY_CONFLICT_CODES = new Set([
  'SYNC_CONFLICT',
  'BARCODE_DUPLICATE'
]);

const MAX_CONFLICT_PEELS_PER_SYNC = 250;
let syncing = false;
let syncIdleWaiters = [];

function isEntityConflictCode(code) {
  return ENTITY_CONFLICT_CODES.has(String(code || ''));
}

export function onSyncStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function syncNow({
  localUserId,
  displayName = 'Usuario local',
  force = false
} = {}) {
  if (syncing && !force) {
    await waitForSyncIdle();

    return syncNow({
      localUserId,
      displayName,
      force: false
    });
  }

  if (!navigator.onLine) {
    emit({ state: 'offline' });
    return { ok: false, skipped: 'offline' };
  }

  syncing = true;
  emit({ state: 'syncing' });

  try {
    await recoverInterruptedOperations({ olderThanMs: 30000 });

    let config = await getSyncConfig();
    if (!config.enabled) {
      emit({ state: 'disabled' });
      return { ok: false, skipped: 'disabled' };
    }

    config = await ensureServerIdentity(config, {
      localUserId,
      displayName
    });

    await ensureWorkspaceCache(
      config.workspaceId,
      {
        adoptUnbound: config.authMode === 'dev'
      }
    );

    const pushed = await pushPending(config);
    const pulled = await pullRemote(config);

    await pruneSyncedOperations();

    emit({
      state:
        pushed.conflicts > 0
          ? 'conflict'
          : 'synced',
      pushed: pushed.count,
      conflicts: pushed.conflicts,
      pulled: pulled.count,
      cursor: pulled.cursor
    });

    return {
      ok: true,
      conflict: pushed.conflicts > 0,
      pushed: pushed.count,
      conflicts: pushed.conflicts,
      pulled: pulled.count,
      cursor: pulled.cursor
    };
  } catch (error) {
    emit({
      state: isEntityConflictCode(error?.code)
        ? 'conflict'
        : 'error',
      message: error?.message || String(error),
      details: error?.details || null
    });

    return {
      ok: false,
      error
    };
  } finally {
    syncing = false;

    const waiters = syncIdleWaiters;
    syncIdleWaiters = [];

    for (const resolve of waiters) {
      try {
        resolve();
      } catch (_) {}
    }
  }
}

function waitForSyncIdle() {
  if (!syncing) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    syncIdleWaiters.push(resolve);
  });
}

async function ensureServerIdentity(config, { localUserId, displayName }) {
  if (config.authMode === 'firebase') {
    if (!config.workspaceId) {
      throw new Error(
        'Falta workspaceId para sincronización autenticada de producción'
      );
    }

    // Fuerza una validación temprana para no empezar un ciclo de sync sin token.
    await getAuthToken({ required: true });
    return config;
  }

  if (config.workspaceId && config.serverUserId) return config;

  const response = await fetch(
    buildApiUrl(config.apiBaseUrl, '/api/v1/dev/bootstrap'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceKey: config.workspaceKey,
        externalUserId: localUserId,
        displayName
      })
    }
  );

  const data = await readJson(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'No se pudo preparar la identidad del servidor');
  }

  const switched = await switchWorkspaceCacheAndConfig(
    data.workspace.id,
    {
      serverUserId: data.user.id,
      authMode: 'dev'
    },
    {
      adoptUnbound: true
    }
  );

  return switched.config;
}

async function pushPending(config) {
  const pending = await listPendingOperations();
  if (pending.length === 0) {
    return {
      count: 0,
      conflicts: 0
    };
  }

  let count = 0;
  let conflicts = 0;
  let conflictPeels = 0;

  for (
    let offset = 0;
    offset < pending.length;
    offset += 100
  ) {
    let remainingBatch =
      pending.slice(offset, offset + 100);

    while (remainingBatch.length > 0) {
      for (const item of remainingBatch) {
        await markSyncing(item.id);
      }

      let response;
      let data;

      try {
        ({
          response,
          data
        } = await authenticatedSyncFetch(
          config,
          buildApiUrl(
            config.apiBaseUrl,
            '/api/v1/sync/push'
          ),
          {
            method: 'POST',
            body: JSON.stringify({
              events: remainingBatch
            })
          }
        ));
      } catch (error) {
        for (const item of remainingBatch) {
          await markFailed(item.id, error);
        }
        throw error;
      }

      if (response.ok && data.ok) {
        const acknowledged = new Set(
          (data.applied || [])
            .map(item => item.id)
        );

        for (const item of remainingBatch) {
          if (acknowledged.has(item.id)) {
            await markSynced(item.id);
            count += 1;
          } else {
            await markFailed(
              item.id,
              'Servidor no confirmó el evento'
            );
          }
        }

        remainingBatch = [];
        continue;
      }

      const error = new Error(
        data.message ||
        'Error enviando cambios al servidor'
      );
      error.code =
        data.code || 'SYNC_PUSH_FAILED';
      error.details =
        data.details || null;

      if (
        response.status === 409 &&
        isEntityConflictCode(data.code)
      ) {
        const conflictId =
          data.details?.eventId || null;

        if (!conflictId) {
          for (const item of remainingBatch) {
            await markPending(
              item.id,
              'Conflicto sin eventId; requiere revisión.'
            );
          }

          throw error;
        }

        conflictPeels += 1;

        if (
          conflictPeels >
          MAX_CONFLICT_PEELS_PER_SYNC
        ) {
          for (const item of remainingBatch) {
            await markPending(
              item.id,
              'Límite de conflictos alcanzado; se continuará en el próximo ciclo.'
            );
          }

          return {
            count,
            conflicts
          };
        }

        remainingBatch =
          await continueAfterConflict({
            batch: remainingBatch,
            conflictId,
            details: data.details || {},
            code: data.code,
            message: error.message
          });

        conflicts += 1;
        continue;
      }

      for (const item of remainingBatch) {
        await markFailed(item.id, error);
      }

      throw error;
    }
  }

  return {
    count,
    conflicts
  };
}

async function continueAfterConflict({
  batch,
  conflictId,
  details,
  code,
  message
}) {
  const conflictItem =
    batch.find(
      item => item.id === conflictId
    );

  if (!conflictItem) {
    for (const item of batch) {
      await markPending(
        item.id,
        'Conflicto reportado fuera del lote actual.'
      );
    }

    const error = new Error(
      'El servidor reportó un conflicto que no pertenece al lote actual'
    );
    error.code = 'SYNC_CONFLICT_INVALID_EVENT';
    throw error;
  }

  await markConflict(
    conflictItem.id,
    {
      ...details,
      reason: code,
      message
    }
  );

  const remainingBatch =
    batch.filter(
      item => item.id !== conflictId
    );

  for (const item of remainingBatch) {
    await markPending(
      item.id,
      'Lote reintentado sin el evento en conflicto.'
    );
  }

  return remainingBatch;
}

async function pullRemote(config) {
  let cursor = await getSyncCursor();
  let count = 0;

  while (true) {
    const url = new URL(
      buildApiUrl(config.apiBaseUrl, '/api/v1/sync/pull'),
      window.location.origin
    );
    url.searchParams.set('cursor', String(cursor));
    url.searchParams.set('limit', '250');

    const {
      response,
      data
    } = await authenticatedSyncFetch(
      config,
      url,
      {
        method: 'GET'
      },
      {
        includeJson: false
      }
    );

    if (!response.ok || !data.ok) {
      const error = new Error(
        data.message ||
        'Error descargando cambios del servidor'
      );
      error.code =
        data.code || 'SYNC_PULL_FAILED';
      error.status = response.status;
      error.details = data.details || null;
      throw error;
    }

    const events = Array.isArray(data.events) ? data.events : [];
    if (events.length === 0) break;

    await applyRemoteEvents(events);

    cursor = Number(data.cursor || cursor);
    await saveSyncCursor(cursor);
    count += events.length;

    if (events.length < 250) break;
  }

  return { count, cursor };
}

async function authHeaders(
  config,
  includeJson = true,
  {
    forceRefresh = false
  } = {}
) {
  const headers = {
    'x-workspace-id': config.workspaceId
  };

  if (config.authMode === 'firebase') {
    const token = await getAuthToken({
      required: true,
      forceRefresh
    });
    headers.authorization = `Bearer ${token}`;
  } else {
    headers['x-user-id'] = config.serverUserId;
  }

  if (includeJson) {
    headers['content-type'] = 'application/json';
  }

  return headers;
}

async function authenticatedSyncFetch(
  config,
  url,
  options = {},
  {
    includeJson = true
  } = {}
) {
  const execute = async ({
    forceRefresh = false
  } = {}) => {
    const response = await fetch(
      url,
      {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(await authHeaders(
            config,
            includeJson,
            { forceRefresh }
          ))
        }
      }
    );

    const data = await readJson(response);

    return {
      response,
      data
    };
  };

  let result = await execute();

  if (
    config.authMode === 'firebase' &&
    result.response.status === 401 &&
    result.data?.code ===
      'AUTH_TOKEN_INVALID'
  ) {
    result = await execute({
      forceRefresh: true
    });
  }

  return result;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return {
      ok: false,
      message: `Respuesta inválida del servidor (${response.status})`
    };
  }
}

function emit(status) {
  for (const listener of listeners) {
    try {
      listener(status);
    } catch (_) {}
  }
}
