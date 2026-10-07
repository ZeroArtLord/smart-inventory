import test from 'node:test';
import assert from 'node:assert/strict';

const {
  assertOperationalEventOwnership,
  assertOperationalDocumentOwnership
} = await import('../server/src/security/operationalOwnership.js');

const firebaseWarehouse = {
  workspaceId: 'ws-1',
  userId: 'internal-a',
  externalAuthId: 'firebase-a',
  roleCode: 'WAREHOUSE',
  authMode: 'firebase'
};

function fakeClient(documents = {}) {
  return {
    async query(sql, params) {
      const documentId = params?.[1];
      const document = documents[documentId];
      if (!document) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          type: document.type,
          owner_id: document.ownerId,
          metadata: document.metadata || {}
        }]
      };
    }
  };
}

function liveDocuments({ parentOwnerId = 'firebase-a' } = {}) {
  return {
    'supply-a': {
      type: 'SUPPLY',
      ownerId: parentOwnerId,
      metadata: { kind: 'LIVE_SUPPLY_CART' }
    },
    'delivery-a': {
      type: 'SUPPLY',
      ownerId: 'live-delivery:supply-a',
      metadata: {
        kind: 'LIVE_SUPPLY_DELIVERY',
        parentCartId: 'supply-a'
      }
    }
  };
}

test('WAREHOUSE puede sincronizar UPDATE del LIVE_SUPPLY_DELIVERY de su propio carrito', async () => {
  const client = fakeClient(liveDocuments());

  await assert.doesNotReject(() => assertOperationalEventOwnership(
    client,
    firebaseWarehouse,
    {
      entityType: 'document',
      operation: 'UPDATE',
      entityId: 'delivery-a',
      payload: { id: 'delivery-a', status: 'CLOSED' }
    }
  ));
});

test('WAREHOUSE puede sincronizar líneas y movimientos del LIVE_SUPPLY_DELIVERY de su propio carrito', async () => {
  const client = fakeClient(liveDocuments());

  await assert.doesNotReject(() => assertOperationalEventOwnership(
    client,
    firebaseWarehouse,
    {
      entityType: 'documentLine',
      operation: 'CREATE',
      payload: { id: 'line-a', documentId: 'delivery-a' }
    }
  ));

  await assert.doesNotReject(() => assertOperationalEventOwnership(
    client,
    firebaseWarehouse,
    {
      entityType: 'movement',
      operation: 'CREATE',
      payload: { id: 'mov-a', documentId: 'delivery-a', type: 'SUPPLY' }
    }
  ));
});

test('WAREHOUSE puede acceder directamente al LIVE_SUPPLY_DELIVERY de su propio carrito', async () => {
  const client = fakeClient(liveDocuments());

  await assert.doesNotReject(() => assertOperationalDocumentOwnership(
    client,
    firebaseWarehouse,
    'delivery-a',
    { expectedType: 'SUPPLY' }
  ));
});

test('LIVE_SUPPLY_DELIVERY sigue prohibido cuando su carrito padre pertenece a otro usuario', async () => {
  const client = fakeClient(liveDocuments({ parentOwnerId: 'firebase-b' }));

  await assert.rejects(() => assertOperationalEventOwnership(
    client,
    firebaseWarehouse,
    {
      entityType: 'movement',
      operation: 'CREATE',
      payload: { id: 'mov-b', documentId: 'delivery-a', type: 'SUPPLY' }
    }
  ), error => error?.code === 'OPERATIONAL_DOCUMENT_FORBIDDEN');

  await assert.rejects(() => assertOperationalDocumentOwnership(
    client,
    firebaseWarehouse,
    'delivery-a',
    { expectedType: 'SUPPLY' }
  ), error => error?.code === 'OPERATIONAL_DOCUMENT_FORBIDDEN');
});
