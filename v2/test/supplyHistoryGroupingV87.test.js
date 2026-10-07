import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSupplyHistoryGroups } from '../src/documents/supplyHistoryGrouping.js';

const liveCart = (id, operationalDate, technicalAt, extra = {}) => ({
  id,
  type: 'SUPPLY',
  status: 'CLOSED',
  ownerId: 'warehouse-1',
  createdAt: technicalAt,
  updatedAt: technicalAt,
  closedAt: technicalAt,
  metadata: {
    kind: 'LIVE_SUPPLY_CART',
    operationalDate,
    responsibleName: 'Almacén',
    ...extra
  }
});

const delivery = (id, parentCartId, operationalDate, technicalAt) => ({
  id,
  type: 'SUPPLY',
  status: 'CLOSED',
  ownerId: `live-delivery:${parentCartId}`,
  createdAt: technicalAt,
  updatedAt: technicalAt,
  closedAt: technicalAt,
  metadata: {
    kind: 'LIVE_SUPPLY_DELIVERY',
    parentCartId,
    operationalDate,
    deliveryToken: `token-${id}`
  }
});

test('V8.7 agrupa cada carrito padre una sola vez y anida sus entregas por hora técnica', () => {
  const parent = liveCart(
    'cart-12',
    '2026-09-12',
    '2026-09-14T09:00:00.000Z'
  );
  const late = delivery(
    'delivery-late',
    parent.id,
    '2026-09-12',
    '2026-09-14T15:30:00.000Z'
  );
  const early = delivery(
    'delivery-early',
    parent.id,
    '2026-09-12',
    '2026-09-14T10:15:00.000Z'
  );

  const groups = buildSupplyHistoryGroups({
    documents: [late, parent, early, parent],
    movements: []
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].document.id, parent.id);
  assert.equal(groups[0].kind, 'LIVE_CART');
  assert.equal(groups[0].operationalDate, '2026-09-12');
  assert.deepEqual(
    groups[0].deliveries.map(item => item.document.id),
    ['delivery-early', 'delivery-late']
  );
  assert.equal(groups[0].summary.deliveryCount, 2);
});

test('V8.7 el total entregado del padre se deriva de movimientos hijos y no del contador mutable', () => {
  const parent = liveCart(
    'cart-summary',
    '2026-09-12',
    '2026-09-14T08:00:00.000Z',
    {
      liveSupplyDeliveryCount: 99,
      liveSupplyDeliveredTotal: 999
    }
  );
  const first = delivery(
    'delivery-1',
    parent.id,
    '2026-09-12',
    '2026-09-14T10:00:00.000Z'
  );
  const second = delivery(
    'delivery-2',
    parent.id,
    '2026-09-12',
    '2026-09-14T11:00:00.000Z'
  );

  const groups = buildSupplyHistoryGroups({
    documents: [parent, first, second],
    movements: [
      { id: 'm1', type: 'SUPPLY', documentId: first.id, productId: 'p1', quantity: 2 },
      { id: 'm2', type: 'SUPPLY', documentId: first.id, productId: 'p2', quantity: 3 },
      { id: 'm3', type: 'SUPPLY', documentId: second.id, productId: 'p1', quantity: 1 }
    ]
  });

  assert.equal(groups[0].summary.deliveryCount, 2);
  assert.equal(groups[0].summary.deliveredTotal, 6);
});

test('V8.7 ordena grupos por fecha operativa y luego timestamp técnico', () => {
  const newestTechnical = liveCart(
    'cart-a',
    '2026-09-12',
    '2026-09-14T18:00:00.000Z'
  );
  const olderTechnical = liveCart(
    'cart-b',
    '2026-09-12',
    '2026-09-14T08:00:00.000Z'
  );
  const nextOperationalDay = liveCart(
    'cart-c',
    '2026-09-13',
    '2026-09-13T09:00:00.000Z'
  );

  const groups = buildSupplyHistoryGroups({
    documents: [olderTechnical, newestTechnical, nextOperationalDay],
    movements: []
  });

  assert.deepEqual(
    groups.map(group => group.document.id),
    ['cart-c', 'cart-a', 'cart-b']
  );
});

test('V8.7 no pierde hijos huérfanos ni Surtidos legacy', () => {
  const orphan = delivery(
    'orphan-delivery',
    'missing-cart',
    '2026-09-11',
    '2026-09-14T12:00:00.000Z'
  );
  const legacy = {
    id: 'legacy-supply',
    type: 'SUPPLY',
    status: 'CLOSED',
    ownerId: 'warehouse-1',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
    closedAt: '2026-09-10T10:00:00.000Z',
    metadata: {}
  };

  const groups = buildSupplyHistoryGroups({
    documents: [orphan, legacy],
    movements: []
  });

  const byId = new Map(groups.map(group => [group.document.id, group]));
  assert.equal(byId.get(orphan.id)?.kind, 'ORPHAN_DELIVERY');
  assert.equal(byId.get(orphan.id)?.deliveries.length, 0);
  assert.equal(byId.get(legacy.id)?.kind, 'LEGACY_SUPPLY');
  assert.equal(byId.get(legacy.id)?.operationalDate, '2026-09-10');
});
