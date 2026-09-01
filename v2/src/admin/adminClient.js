import { apiRequest } from '../api/apiClient.js';

export async function getCurrentSession() {
  const data = await apiRequest('/api/v1/session');
  return data.session;
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

  return data.member;
}

export function can(session, permission) {
  const permissions = Array.isArray(session?.permissions)
    ? session.permissions
    : [];

  return permissions.includes('*') || permissions.includes(permission);
}


export const ROLE_OPTIONS = Object.freeze([
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
