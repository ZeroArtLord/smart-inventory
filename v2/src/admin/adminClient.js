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
  active = true
}) {
  const data = await apiRequest(
    `/api/v1/admin/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: {
        roleCode,
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
