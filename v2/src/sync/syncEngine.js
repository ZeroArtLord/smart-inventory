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

const listeners = new Set();
let syncing = false;

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
    return { ok: false, skipped: 'already-syncing' };
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

    const pushed = await pushPending(config);
    const pulled = await pullRemote(config);

    await pruneSyncedOperations();

    emit({
      state: 'synced',
      pushed: pushed.count,
      pulled: pulled.count,
      cursor: pulled.cursor
    });

    return {
      ok: true,
      pushed: pushed.count,
      pulled: pulled.count,
      cursor: pulled.cursor
    };
  } catch (error) {
    emit({
      state: error?.code === 'SYNC_CONFLICT'
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
  }
}

async function ensureServerIdentity(config, { localUserId, displayName }) {
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

  return saveSyncConfig({
    workspaceId: data.workspace.id,
    serverUserId: data.user.id
  });
}

async function pushPending(config) {
  const pending = await listPendingOperations();
  if (pending.length === 0) return { count: 0 };

  let count = 0;

  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100);

    for (const item of batch) {
      await markSyncing(item.id);
    }

    let response;
    let data;

    try {
      response = await fetch(
        buildApiUrl(config.apiBaseUrl, '/api/v1/sync/push'),
        {
          method: 'POST',
          headers: authHeaders(config),
          body: JSON.stringify({ events: batch })
        }
      );
      data = await readJson(response);
    } catch (error) {
      for (const item of batch) await markFailed(item.id, error);
      throw error;
    }

    if (!response.ok || !data.ok) {
      const error = new Error(
        data.message || 'Error enviando cambios al servidor'
      );
      error.code = data.code || 'SYNC_PUSH_FAILED';
      error.details = data.details || null;

      if (response.status === 409 && data.code === 'SYNC_CONFLICT') {
        const conflictId = data.details?.eventId || null;

        for (const item of batch) {
          if (item.id === conflictId) {
            await markConflict(item.id, {
              ...(data.details || {}),
              message: error.message
            });
          } else {
            await markPending(
              item.id,
              'Lote revertido por conflicto en otro evento.'
            );
          }
        }
      } else {
        for (const item of batch) {
          await markFailed(item.id, error);
        }
      }

      throw error;
    }

    const acknowledged = new Set(
      (data.applied || []).map(item => item.id)
    );

    for (const item of batch) {
      if (acknowledged.has(item.id)) {
        await markSynced(item.id);
        count += 1;
      } else {
        await markFailed(item.id, 'Servidor no confirmó el evento');
      }
    }
  }

  return { count };
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

    const response = await fetch(url, {
      headers: authHeaders(config, false)
    });
    const data = await readJson(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Error descargando cambios del servidor');
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

function authHeaders(config, includeJson = true) {
  const headers = {
    'x-workspace-id': config.workspaceId,
    'x-user-id': config.serverUserId
  };

  if (includeJson) {
    headers['content-type'] = 'application/json';
  }

  return headers;
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
