import test from 'node:test';
import assert from 'node:assert/strict';

const {
  assertOperationalEventOwnership,
  operationalActorOwnerId
} = await import('../server/src/security/operationalOwnership.js');

function fakeClient(documents = {}) {
  return {
    async query(sql, params) {
      const documentId = params?.[1];
      const document = documents[documentId];
      if (!document) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{ type: document.type, owner_id: document.ownerId }]
      };
    }
  };
}

const firebaseWarehouse = {
  workspaceId: 'ws-1',
  userId: 'internal-a',
  externalAuthId: 'firebase-a',
  roleCode: 'WAREHOUSE',
  authMode: 'firebase'
};

const god = {
  workspaceId: 'ws-1',
  userId: 'internal-god',
  externalAuthId: 'firebase-god',
  roleCode: 'GOD',
  authMode: 'firebase'
};

test('usa externalAuthId como owner operativo en Firebase y userId en dev', () => {
  assert.equal(operationalActorOwnerId(firebaseWarehouse), 'firebase-a');
  assert.equal(operationalActorOwnerId({
    ...firebaseWarehouse,
    authMode: 'dev',
    externalAuthId: null
  }), 'internal-a');
});

test('WAREHOUSE puede crear su propio ENTRY pero no crear uno a nombre de otro usuario', async () => {
  const client = fakeClient();

  await assert.doesNotReject(() => assertOperationalEventOwnership(client, firebaseWarehouse, {
    entityType: 'document',
    operation: 'CREATE',
    payload: { id: 'entry-own', type: 'ENTRY', ownerId: 'firebase-a' }
  }));

  await assert.rejects(() => assertOperationalEventOwnership(client, firebaseWarehouse, {
    entityType: 'document',
    operation: 'CREATE',
    payload: { id: 'entry-foreign', type: 'ENTRY', ownerId: 'firebase-b' }
  }), error => error?.code === 'OPERATIONAL_DOCUMENT_FORBIDDEN');
});

test('WAREHOUSE no puede actualizar líneas ni movimientos de ENTRY/SUPPLY ajenos', async () => {
  const client = fakeClient({
    'entry-b': { type: 'ENTRY', ownerId: 'firebase-b' },
    'supply-b': { type: 'SUPPLY', ownerId: 'firebase-b' }
  });

  await assert.rejects(() => assertOperationalEventOwnership(client, firebaseWarehouse, {
    entityType: 'documentLine',
    operation: 'UPDATE',
    payload: { id: 'line-b', documentId: 'entry-b' }
  }), error => error?.code === 'OPERATIONAL_DOCUMENT_FORBIDDEN');

  await assert.rejects(() => assertOperationalEventOwnership(client, firebaseWarehouse, {
    entityType: 'movement',
    operation: 'CREATE',
    payload: { id: 'mov-b', documentId: 'supply-b', type: 'SUPPLY' }
  }), error => error?.code === 'OPERATIONAL_DOCUMENT_FORBIDDEN');
});

test('GOD puede administrar ENTRY/SUPPLY de cualquier usuario', async () => {
  const client = fakeClient({
    'entry-b': { type: 'ENTRY', ownerId: 'firebase-b' },
    'supply-b': { type: 'SUPPLY', ownerId: 'firebase-b' }
  });

  await assert.doesNotReject(() => assertOperationalEventOwnership(client, god, {
    entityType: 'documentLine',
    operation: 'UPDATE',
    payload: { id: 'line-b', documentId: 'entry-b' }
  }));

  await assert.doesNotReject(() => assertOperationalEventOwnership(client, god, {
    entityType: 'movement',
    operation: 'CREATE',
    payload: { id: 'mov-b', documentId: 'supply-b', type: 'SUPPLY' }
  }));
});

test('ADMIN no hereda el bypass GOD por tener wildcard', async () => {
  const client = fakeClient({
    'entry-b': { type: 'ENTRY', ownerId: 'firebase-b' }
  });

  await assert.rejects(() => assertOperationalEventOwnership(client, {
    ...firebaseWarehouse,
    roleCode: 'ADMIN'
  }, {
    entityType: 'documentLine',
    operation: 'UPDATE',
    payload: { id: 'line-b', documentId: 'entry-b' }
  }), error => error?.code === 'OPERATIONAL_DOCUMENT_FORBIDDEN');
});

test('entidades fuera de ENTRY/SUPPLY conservan su flujo existente', async () => {
  const client = fakeClient({
    'count-b': { type: 'COUNT', ownerId: 'firebase-b' }
  });

  await assert.doesNotReject(() => assertOperationalEventOwnership(client, firebaseWarehouse, {
    entityType: 'documentLine',
    operation: 'UPDATE',
    payload: { id: 'count-line', documentId: 'count-b' }
  }));
});
