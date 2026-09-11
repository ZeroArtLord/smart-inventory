import { apiRequest } from '../api/apiClient.js';
import { getAuthToken } from '../auth/authProvider.js';
import { getSyncConfig } from '../sync/syncSettings.js';

const SESSION_CACHE_MS = 60000;
let sessionInFlight = null;
let cachedSession = null;
let cachedSessionKey = '';
let cachedSessionAt = 0;

export async function getCurrentSession({ force = false } = {}) {
  const key = await currentSessionKey();
  const now = Date.now();

  if (
    !force &&
    cachedSession &&
    cachedSessionKey === key &&
    now - cachedSessionAt < SESSION_CACHE_MS
  ) {
    return cachedSession;
  }

  if (sessionInFlight?.key === key) {
    return sessionInFlight.promise;
  }

  const promise = apiRequest('/api/v1/session')
    .then(data => {
      if (!data?.session) {
        const error = new Error('El servidor no devolvió una sesión válida');
        error.code = 'SESSION_INVALID';
        throw error;
      }

      cachedSession = data.session;
      cachedSessionKey = key;
      cachedSessionAt = Date.now();
      return cachedSession;
    })
    .catch(error => {
      if (
        error?.status === 429 &&
        cachedSession &&
        cachedSessionKey === key
      ) {
        return cachedSession;
      }

      throw error;
    })
    .finally(() => {
      if (sessionInFlight?.promise === promise) {
        sessionInFlight = null;
      }
    });

  sessionInFlight = { key, promise };
  return promise;
}

export function invalidateCurrentSessionCache() {
  cachedSession = null;
  cachedSessionKey = '';
  cachedSessionAt = 0;
}

export async function listWorkspaceMembers() {
  const data = await apiRequest('/api/v1/admin/members');
  return Array.isArray(data.members) ? data.members : [];
}

export async function createWorkspaceMember({
  email,
  displayName = '',
  roleCode = 'WAREHOUSE'
}) {
  const data = await apiRequest('/api/v1/admin/members', {
    method: 'POST',
    body: {
      email,
      displayName,
      roleCode
    }
  });
  return data.member;
}

export async function updateWorkspaceMember(userId, {
  roleCode,
  permissions = undefined,
  active = true
}) {
  const data = await apiRequest(
    `/api/v1/admin/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: {
        roleCode,
        ...(permissions !== undefined ? { permissions } : {}),
        active
      }
    }
  );

  invalidateCurrentSessionCache();
  return data.member;
}

export function can(session, permission) {
  const permissions = Array.isArray(session?.permissions)
    ? session.permissions
    : [];

  return permissions.includes('*') || permissions.includes(permission);
}

export const ROLE_OPTIONS = Object.freeze([
  { code: 'GOD', label: 'DIOS · Cuenta maestra' },
  { code: 'ADMIN', label: 'Administrador' },
  { code: 'SUPERVISOR', label: 'Supervisor' },
  { code: 'WAREHOUSE', label: 'Almacenista' },
  { code: 'VIEWER', label: 'Consulta' }
]);

export const PERMISSION_OPTIONS = Object.freeze([
  { code: 'catalog.view', label: 'Ver catálogo' },
  { code: 'catalog.write', label: 'Editar catálogo' },
  { code: 'count.write', label: 'Crear/cerrar conteos' },
  { code: 'entry.write', label: 'Registrar entradas' },
  { code: 'supply.write', label: 'Crear/cerrar surtidos' },
  { code: 'adjustment.write', label: 'Ajustes y reversiones' },
  { code: 'purchases.write', label: 'Compras y pedidos' },
  { code: 'costs.view', label: 'Ver costos' },
  { code: 'reports.view', label: 'Ver reportes' },
  { code: 'reports.export', label: 'Exportar reportes' },
  { code: 'users.manage', label: 'Administrar usuarios' },
  { code: 'audit.view', label: 'Ver auditoría' },
  { code: 'saint.send', label: 'Enviar a SAINT' }
]);

async function currentSessionKey() {
  const config = await getSyncConfig();
  const workspaceId = String(config.workspaceId || '');

  if (config.authMode === 'firebase') {
    const token = await getAuthToken({
      required: true,
      forceRefresh: false
    });

    return `firebase:${workspaceId}:${token}`;
  }

  return `dev:${workspaceId}:${String(config.serverUserId || '')}`;
}
