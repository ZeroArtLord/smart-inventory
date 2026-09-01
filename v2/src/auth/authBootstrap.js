import { getAuthToken } from './authProvider.js';
import {
  getSyncConfig,
  saveSyncConfig,
  buildApiUrl
} from '../sync/syncSettings.js';

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

    if (data.authMode === current.authMode) {
      return current;
    }

    return saveSyncConfig({
      authMode: data.authMode,
      ...(data.authMode === 'firebase'
        ? { serverUserId: null }
        : {})
    });
  } catch (_) {
    return current;
  }
}

export async function bootstrapFirebaseAccess() {
  const config = await getSyncConfig();
  const token = await getAuthToken({ required: true });

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

  return {
    user: data.user || null,
    workspaces,
    selectedWorkspace
  };
}

export async function selectFirebaseWorkspace(workspaceId) {
  const normalized = String(workspaceId || '').trim();
  if (!normalized) {
    throw new Error('Selecciona un almacén válido');
  }

  return saveSyncConfig({
    authMode: 'firebase',
    workspaceId: normalized,
    serverUserId: null
  });
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
