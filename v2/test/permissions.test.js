import test from 'node:test';
import assert from 'node:assert/strict';

const {
  PERMISSIONS,
  permissionForEvent,
  assertEventPermission
} = await import('../server/src/security/permissions.js');

test('admin wildcard puede aplicar cualquier evento', () => {
  assert.doesNotThrow(() => assertEventPermission(
    { permissions: ['*'] },
    {
      entityType: 'movement',
      operation: 'CREATE',
      payload: { type: 'SUPPLY' }
    }
  ));
});

test('catálogo exige catalog.write', () => {
  const event = {
    entityType: 'product',
    operation: 'UPDATE',
    payload: {}
  };

  assert.equal(
    permissionForEvent(event),
    PERMISSIONS.CATALOG_WRITE
  );

  assert.throws(
    () => assertEventPermission(
      { permissions: [PERMISSIONS.SUPPLY_WRITE] },
      event
    ),
    /catalog\.write/i
  );
});

test('surtido exige supply.write', () => {
  const event = {
    entityType: 'document',
    operation: 'CREATE',
    payload: { type: 'SUPPLY' }
  };

  assert.equal(
    permissionForEvent(event),
    PERMISSIONS.SUPPLY_WRITE
  );

  assert.doesNotThrow(() => assertEventPermission(
    { permissions: [PERMISSIONS.SUPPLY_WRITE] },
    event
  ));
});

test('inventory.write funciona como permiso operativo amplio', () => {
  const event = {
    entityType: 'movement',
    operation: 'CREATE',
    payload: { type: 'ENTRY' }
  };

  assert.doesNotThrow(() => assertEventPermission(
    { permissions: [PERMISSIONS.INVENTORY_WRITE] },
    event
  ));
});

test('línea usa documentType para permiso granular', () => {
  const event = {
    entityType: 'documentLine',
    operation: 'CREATE',
    payload: { documentType: 'COUNT' }
  };

  assert.equal(
    permissionForEvent(event),
    PERMISSIONS.COUNT_WRITE
  );
});
