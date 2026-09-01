import { getAuthToken } from './authProvider.js';
import {
  getFirebaseClientProjectId
} from './firebaseClient.js';
import {
  getSyncConfig,
  saveSyncConfig,
  buildApiUrl
} from '../sync/syncSettings.js';
import {
  STORES,
  get,
  put
} from '../storage/database.js';
import {
  ensureWorkspaceCache,
  switchWorkspaceCacheAndConfig
} from '../sync/workspaceCache.js';

const CACHED_ACCESS_KEY = 'auth.firebase.cachedAccess';

export async function discoverServerAuthMode() {
  const current = await getSyncConfig();

  if (!navigator.onLine) {
    return current;
  }

  try {
    const response = await fetch(
      buildApiUrl(
        current.apiBaseUrl,
        '/api/v1/public/config'
      )
    );
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return current;
    }

    if (!['dev', 'firebase'].includes(data.authMode)) {
      return current;
    }

    if (
      data.authMode === 'firebase' &&
      data.firebaseProjectId &&
      data.firebaseProjectId !==
        getFirebaseClientProjectId()
    ) {
      const error = new Error(
        'La app y el servidor apuntan a proyectos Firebase distintos.'
      );
      error.code =
        'FIREBASE_PROJECT_MISMATCH';
      throw error;
    }

    if (
      data.authMode === 'firebase' &&
      globalThis.isSecureContext === false
    ) {
      const error = new Error(
        'Firebase Authentication requiere un contexto seguro (HTTPS o localhost).'
      );
      error.code =
        'AUTH_SECURE_CONTEXT_REQUIRED';
      throw error;
    }

    if (data.authMode === current.authMode) {
      return current;
    }

    return saveSyncConfig({
      authMode: data.authMode,
      ...(data.authMode === 'firebase'
        ? { serverUserId: null }
        : {})
    });
  } catch (error) {
    if (
      [
        'FIREBASE_PROJECT_MISMATCH',
        'AUTH_SECURE_CONTEXT_REQUIRED'
      ].includes(error?.code)
    ) {
      throw error;
    }

    return current;
  }
}

export async function bootstrapFirebaseAccess({
  uid = null
} = {}) {
  const config = await getSyncConfig();

  if (!navigator.onLine) {
    return getCachedFirebaseAccess({
      uid,
      workspaceId: config.workspaceId
    });
  }

  const execute = async ({
    forceRefresh = false
  } = {}) => {
    const token = await getAuthToken({
      required: true,
      forceRefresh
    });

    let response;

    try {
      response = await fetch(
        buildApiUrl(
          config.apiBaseUrl,
          '/api/v1/auth/bootstrap'
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: '{}'
        }
      );
    } catch (error) {
      if (!navigator.onLine) {
        return {
          offlineFallback: true
        };
      }
      throw error;
    }

    const data = await readJson(response);

    return {
      response,
      data
    };
  };

  let result = await execute();

  if (result.offlineFallback) {
    return getCachedFirebaseAccess({
      uid,
      workspaceId: config.workspaceId
    });
  }

  if (
    result.response.status === 401 &&
    result.data?.code ===
      'AUTH_TOKEN_INVALID'
  ) {
    result = await execute({
      forceRefresh: true
    });
  }

  const {
    response,
    data
  } = result;

  if (!response.ok || !data?.ok) {
    const error = new Error(
      data?.message || 'No se pudo preparar el acceso al almacén'
    );
    error.code = data?.code || 'AUTH_BOOTSTRAP_FAILED';
    error.status = response.status;
    throw error;
  }

  const workspaces = Array.isArray(data.workspaces)
    ? data.workspaces
    : [];

  const currentWorkspace = workspaces.find(
    workspace => workspace.id === config.workspaceId
  );

  const selectedWorkspace = currentWorkspace ||
    (workspaces.length === 1 ? workspaces[0] : null);

  if (selectedWorkspace) {
    await selectFirebaseWorkspace(selectedWorkspace.id);
  }

  const access = {
    user: data.user || null,
    workspaces,
    selectedWorkspace,
    offline: false,
    cachedAt: new Date().toISOString()
  };

  await cacheFirebaseAccess(access);

  return access;
}

export async function getCachedFirebaseAccess({
  uid = null,
  workspaceId = null
} = {}) {
  const record = await get(
    STORES.SETTINGS,
    CACHED_ACCESS_KEY
  );

  const cached = record?.value || null;

  if (!cached?.user || !Array.isArray(cached.workspaces)) {
    throw offlineAccessError(
      'No hay una autorización offline guardada para este dispositivo.'
    );
  }

  const cachedUid =
    cached.user.externalAuthId ||
    cached.user.uid ||
    null;

  if (uid && cachedUid && uid !== cachedUid) {
    throw offlineAccessError(
      'La sesión offline pertenece a otra cuenta.'
    );
  }

  const selectedWorkspace =
    cached.workspaces.find(
      workspace => workspace.id === workspaceId
    ) ||
    (cached.workspaces.length === 1
      ? cached.workspaces[0]
      : null);

  if (!selectedWorkspace) {
    throw offlineAccessError(
      'Selecciona el almacén una vez con conexión antes de usarlo offline.'
    );
  }

  await ensureWorkspaceCache(
    selectedWorkspace.id
  );

  return {
    user: cached.user,
    workspaces: cached.workspaces,
    selectedWorkspace,
    offline: true,
    cachedAt: cached.cachedAt || null
  };
}

async function cacheFirebaseAccess(access) {
  await put(STORES.SETTINGS, {
    key: CACHED_ACCESS_KEY,
    value: {
      user: access.user,
      workspaces: access.workspaces,
      cachedAt: access.cachedAt
    },
    updatedAt: access.cachedAt
  });
}

function offlineAccessError(message) {
  const error = new Error(message);
  error.code = 'OFFLINE_AUTH_CACHE_MISSING';
  return error;
}

export async function selectFirebaseWorkspace(workspaceId) {
  const normalized = String(workspaceId || '').trim();
  if (!normalized) {
    throw new Error('Selecciona un almacén válido');
  }

  const result = await switchWorkspaceCacheAndConfig(
    normalized,
    {
      authMode: 'firebase',
      serverUserId: null
    }
  );

  return result.config;
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
