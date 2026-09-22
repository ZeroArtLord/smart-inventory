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
  saveOfflineAccessSnapshot,
  readOfflineAccessSnapshot
} from './offlineAccess.js';
import {
  ensureWorkspaceCache,
  switchWorkspaceCacheAndConfig
} from '../sync/workspaceCache.js';

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
  uid = null,
  requireWorkspaceId = null
} = {}) {
  const config = await getSyncConfig();

  if (!navigator.onLine) {
    return getCachedFirebaseAccess({
      uid,
      workspaceId:
        requireWorkspaceId ||
        config.workspaceId
    });
  }

  const execute = async ({
    forceRefresh = false
  } = {}) => {
    try {
      const token = await getAuthToken({
        required: true,
        forceRefresh
      });

      const response = await fetch(
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

      const data = await readJson(response);

      return {
        response,
        data
      };
    } catch (error) {
      return {
        offlineFallback: true,
        networkError: error
      };
    }
  };

  let result = await execute();

  if (result.offlineFallback) {
    return getCachedFirebaseAccess({
      uid,
      workspaceId:
        requireWorkspaceId ||
        config.workspaceId
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

  if (result.offlineFallback) {
    return getCachedFirebaseAccess({
      uid,
      workspaceId:
        requireWorkspaceId ||
        config.workspaceId
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

  const requiredWorkspace =
    String(requireWorkspaceId || '').trim();

  const currentWorkspace = workspaces.find(
    workspace =>
      workspace.id ===
      (
        requiredWorkspace ||
        config.workspaceId
      )
  );

  if (
    requiredWorkspace &&
    !currentWorkspace
  ) {
    const error = new Error(
      'Tu cuenta ya no tiene acceso al almacén local.'
    );
    error.code =
      'WORKSPACE_ACCESS_DENIED';
    error.status = 403;
    throw error;
  }

  const selectedWorkspace =
    currentWorkspace ||
    (
      !requiredWorkspace &&
      workspaces.length === 1
        ? workspaces[0]
        : null
    );

  if (selectedWorkspace) {
    await selectFirebaseWorkspace(
      selectedWorkspace.id
    );
  }

  const access = {
    user: data.user || null,
    workspaces,
    selectedWorkspace,
    offline: false,
    cachedAt: new Date().toISOString()
  };

  await saveOfflineAccessSnapshot(access);

  return access;
}

export async function getCachedFirebaseAccess({
  uid = null,
  workspaceId = null
} = {}) {
  const access =
    await readOfflineAccessSnapshot({
      uid,
      workspaceId
    });

  await ensureWorkspaceCache(
    access.selectedWorkspace.id
  );

  return access;
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
