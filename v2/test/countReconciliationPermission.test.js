import test from 'node:test';
import assert from 'node:assert/strict';

const {
  assertEventPermission,
  requiresGodCountReconciliation
} = await import('../server/src/security/permissions.js');

const god = {
  roleCode: 'GOD',
  permissions: ['*']
};

const supervisor = {
  roleCode: 'SUPERVISOR',
  permissions: ['count.write', 'adjustment.write']
};

function event(entityType, payload, operation = 'UPDATE') {
  return {
    entityType,
    entityId: payload.id,
    operation,
    payload
  };
}

test('almacenista puede entregar conteo PENDING sin permiso GOD', () => {
  const payload = {
    id: 'cnt-v5d-perm',
    type: 'COUNT',
    status: 'CLOSED',
    metadata: {
      closeMode: 'COUNT_RECONCILIATION',
      reconciliationState: 'PENDING'
    }
  };

  assert.equal(
    requiresGodCountReconciliation(event('document', payload)),
    false
  );
  assert.equal(
    assertEventPermission(
      { roleCode: 'WAREHOUSE', permissions: ['count.write'] },
      event('document', payload)
    ),
    'count.write'
  );
});

test('SUPERVISOR con adjustment.write no puede abrir documento de conciliación GOD', () => {
  const payload = {
    id: 'adj-recon-v5d',
    type: 'ADJUSTMENT',
    status: 'DRAFT',
    metadata: {
      kind: 'COUNT_RECONCILIATION',
      sourceCountDocumentId: 'cnt-v5d-perm'
    }
  };

  assert.equal(requiresGodCountReconciliation(event('document', payload, 'CREATE')), true);
  assert.throws(
    () => assertEventPermission(supervisor, event('document', payload, 'CREATE')),
    /solo el rol DIOS/i
  );
  assert.equal(
    assertEventPermission(god, event('document', payload, 'CREATE')),
    'role:GOD'
  );
});

test('líneas y movimientos de conciliación también están blindados por rol GOD', () => {
  const line = {
    id: 'line-v5d',
    documentId: 'adj-recon-v5d',
    documentType: 'ADJUSTMENT',
    productId: 'p1',
    expectedStock: 10,
    countedStock: 8,
    reconciliationKind: 'COUNT_RECONCILIATION'
  };
  const movement = {
    id: 'mov-v5d',
    productId: 'p1',
    type: 'ADJUSTMENT',
    quantity: 0,
    delta: -2,
    metadata: {
      reconciliationKind: 'COUNT_RECONCILIATION'
    }
  };

  assert.throws(
    () => assertEventPermission(supervisor, event('documentLine', line)),
    /solo el rol DIOS/i
  );
  assert.throws(
    () => assertEventPermission(supervisor, event('movement', movement, 'CREATE')),
    /solo el rol DIOS/i
  );

  assert.equal(
    assertEventPermission(god, event('documentLine', line)),
    'role:GOD'
  );
  assert.equal(
    assertEventPermission(god, event('movement', movement, 'CREATE')),
    'role:GOD'
  );
});

test('cambio REVIEWING/RESOLVED del conteo origen también exige GOD', () => {
  for (const state of ['REVIEWING', 'RESOLVED']) {
    const payload = {
      id: `cnt-${state}`,
      type: 'COUNT',
      status: 'CLOSED',
      metadata: {
        closeMode: 'COUNT_RECONCILIATION',
        reconciliationState: state
      }
    };

    assert.throws(
      () => assertEventPermission(supervisor, event('document', payload)),
      /solo el rol DIOS/i
    );
    assert.equal(
      assertEventPermission(god, event('document', payload)),
      'role:GOD'
    );
  }
});
