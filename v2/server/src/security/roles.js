import { PERMISSIONS } from './permissions.js';

export const ROLE_CODES = Object.freeze({
  GOD: 'GOD',
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  WAREHOUSE: 'WAREHOUSE',
  VIEWER: 'VIEWER'
});

export const ROLE_TEMPLATES = Object.freeze({
  [ROLE_CODES.GOD]: Object.freeze(['*']),
  [ROLE_CODES.ADMIN]: Object.freeze(['*']),
  [ROLE_CODES.SUPERVISOR]: Object.freeze([
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.CATALOG_WRITE,
    PERMISSIONS.COUNT_WRITE,
    PERMISSIONS.ENTRY_WRITE,
    PERMISSIONS.SUPPLY_WRITE,
    PERMISSIONS.ADJUSTMENT_WRITE,
    PERMISSIONS.PURCHASE_WRITE,
    PERMISSIONS.COST_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.AUDIT_VIEW
  ]),
  [ROLE_CODES.WAREHOUSE]: Object.freeze([
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.COUNT_WRITE,
    PERMISSIONS.ENTRY_WRITE,
    PERMISSIONS.SUPPLY_WRITE,
    PERMISSIONS.REPORT_VIEW
  ]),
  [ROLE_CODES.VIEWER]: Object.freeze([
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.REPORT_VIEW
  ])
});

export function permissionsForRole(roleCode) {
  const template = ROLE_TEMPLATES[roleCode];
  if (!template) {
    throw new Error('Rol inválido');
  }
  return [...template];
}

export function validateRoleCode(roleCode) {
  if (!ROLE_TEMPLATES[roleCode]) {
    throw new Error('Rol inválido');
  }
  return roleCode;
}

export function validatePermissionList(permissions) {
  if (!Array.isArray(permissions)) {
    throw new Error('Lista de permisos inválida');
  }

  if (permissions.includes('*')) {
    if (permissions.length !== 1) {
      throw new Error('El permiso wildcard debe usarse solo');
    }
    return ['*'];
  }

  const allowed = new Set(Object.values(PERMISSIONS));
  const unique = [...new Set(permissions)];

  for (const permission of unique) {
    if (!allowed.has(permission)) {
      throw new Error(`Permiso desconocido: ${permission}`);
    }
  }

  return unique.sort();
}

export function resolveMemberPermissions({
  roleCode,
  permissions = null
}) {
  validateRoleCode(roleCode);

  if (permissions === null || permissions === undefined) {
    return permissionsForRole(roleCode);
  }

  return validatePermissionList(permissions);
}

export function isGodRole(roleCode) {
  return roleCode === ROLE_CODES.GOD;
}
