import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canActorAccessOperationalDocument,
  filterOperationalDocumentsForActor
} from '../src/documents/documentAccessPolicy.js';

function parent(id, ownerId) {
  return {
    id,
    type: 'SUPPLY',
    status: 'CLOSED',
    ownerId,
    metadata: { kind: 'LIVE_SUPPLY_CART' }
  };
}

function child(id, parentCartId) {
  return {
    id,
    type: 'SUPPLY',
    status: 'CLOSED',
    ownerId: `live-delivery:${parentCartId}`,
    metadata: {
      kind: 'LIVE_SUPPLY_DELIVERY',
      parentCartId
    }
  };
}

test('V8.7 WAREHOUSE hereda visibilidad de una entrega hija desde su carrito padre', () => {
  const ownParent = parent('cart-own', 'warehouse-a');
  const ownChild = child('delivery-own', ownParent.id);
  const foreignParent = parent('cart-foreign', 'warehouse-b');
  const foreignChild = child('delivery-foreign', foreignParent.id);

  const visible = filterOperationalDocumentsForActor(
    [ownParent, ownChild, foreignParent, foreignChild],
    { ownerId: 'warehouse-a', roleCode: 'WAREHOUSE' }
  );

  assert.deepEqual(
    visible.map(document => document.id),
    ['cart-own', 'delivery-own']
  );
});

test('V8.7 GOD ve padres e hijos del equipo y ADMIN no hereda el bypass GOD', () => {
  const ownParent = parent('cart-own', 'admin-a');
  const ownChild = child('delivery-own', ownParent.id);
  const foreignParent = parent('cart-foreign', 'warehouse-b');
  const foreignChild = child('delivery-foreign', foreignParent.id);
  const documents = [ownParent, ownChild, foreignParent, foreignChild];

  const godVisible = filterOperationalDocumentsForActor(documents, {
    ownerId: 'god-user',
    roleCode: 'GOD'
  });
  assert.deepEqual(godVisible.map(document => document.id), [
    'cart-own',
    'delivery-own',
    'cart-foreign',
    'delivery-foreign'
  ]);

  const adminVisible = filterOperationalDocumentsForActor(documents, {
    ownerId: 'admin-a',
    roleCode: 'ADMIN'
  });
  assert.deepEqual(
    adminVisible.map(document => document.id),
    ['cart-own', 'delivery-own']
  );
});

test('V8.7 una entrega huérfana no obtiene acceso por su ownerId técnico', () => {
  const orphan = child('delivery-orphan', 'missing-cart');

  assert.equal(
    canActorAccessOperationalDocument(orphan, {
      ownerId: orphan.ownerId,
      roleCode: 'WAREHOUSE'
    }),
    false
  );
});
