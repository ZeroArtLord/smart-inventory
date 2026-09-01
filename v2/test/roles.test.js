import test from 'node:test';
import assert from 'node:assert/strict';

const {
  ROLE_CODES,
  permissionsForRole,
  validateRoleCode,
  validatePermissionList,
  resolveMemberPermissions
} = await import('../server/src/security/roles.js');

const {
  PERMISSIONS
} = await import('../server/src/security/permissions.js');

test('administrador obtiene wildcard', () => {
  assert.deepEqual(
    permissionsForRole(ROLE_CODES.ADMIN),
    ['*']
  );
});

test('almacenista obtiene permisos operativos sin administración', () => {
  const permissions = permissionsForRole(ROLE_CODES.WAREHOUSE);

  assert.ok(permissions.includes(PERMISSIONS.COUNT_WRITE));
  assert.ok(permissions.includes(PERMISSIONS.ENTRY_WRITE));
  assert.ok(permissions.includes(PERMISSIONS.SUPPLY_WRITE));
  assert.equal(
    permissions.includes(PERMISSIONS.USERS_MANAGE),
    false
  );
});

test('rechaza rol desconocido', () => {
  assert.throws(
    () => validateRoleCode('SUPER_HACKER'),
    /Rol inválido/i
  );
});

test('rechaza permisos desconocidos', () => {
  assert.throws(
    () => validatePermissionList(['inventory.destroy.everything']),
    /Permiso desconocido/i
  );
});

test('wildcard no puede mezclarse con otros permisos', () => {
  assert.throws(
    () => validatePermissionList(['*', PERMISSIONS.CATALOG_VIEW]),
    /wildcard/i
  );
});

test('rol puede usar permisos personalizados válidos', () => {
  const permissions = resolveMemberPermissions({
    roleCode: ROLE_CODES.SUPERVISOR,
    permissions: [
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.COST_VIEW
    ]
  });

  assert.deepEqual(
    permissions,
    [PERMISSIONS.COST_VIEW, PERMISSIONS.REPORT_VIEW].sort()
  );
});
