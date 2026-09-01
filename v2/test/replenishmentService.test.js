import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createProduct
} = await import('../src/catalog/catalogService.js');

const {
  createReplenishment,
  changeReplenishmentStatus,
  registerReplenishmentReceipt,
  calculatePendingInboundByProduct,
  REPLENISHMENT_STATUS
} = await import('../src/replenishment/replenishmentService.js');

test('pedido en tránsito cuenta como pendiente sin alterar stock', async () => {
  const product = await createProduct({
    name: 'PEDIDO TRANSITO TEST',
    sku: 'REP-TRANSIT',
    minStock: 20,
    maxStock: 40,
    replenishmentMethod: 'ORDER'
  });

  const item = await createReplenishment({
    productId: product.id,
    requestedQuantity: 12,
    ownerId: 'compras-test'
  });

  const ordered = await changeReplenishmentStatus(
    item.id,
    REPLENISHMENT_STATUS.ORDERED,
    { userId: 'compras-test' }
  );

  assert.equal(ordered.pendingQuantity, 12);

  const pending = calculatePendingInboundByProduct([ordered]);
  assert.equal(pending.get(product.id), 12);
});

test('una recepción parcial reduce tránsito pero no lo duplica', async () => {
  const product = await createProduct({
    name: 'RECEPCION PARCIAL TEST',
    sku: 'REP-PARTIAL',
    minStock: 10,
    maxStock: 30,
    replenishmentMethod: 'PURCHASE'
  });

  const item = await createReplenishment({
    productId: product.id,
    method: 'PURCHASE',
    requestedQuantity: 20,
    ownerId: 'compras-parcial'
  });

  await changeReplenishmentStatus(
    item.id,
    REPLENISHMENT_STATUS.ORDERED
  );

  const partial = await registerReplenishmentReceipt(item.id, {
    quantity: 8,
    entryDocumentId: 'ent-partial-001',
    userId: 'almacenista'
  });

  assert.equal(partial.status, REPLENISHMENT_STATUS.PARTIALLY_RECEIVED);
  assert.equal(partial.receivedQuantity, 8);
  assert.equal(partial.pendingQuantity, 12);
  assert.equal(partial.receiptDocuments.length, 1);

  const pending = calculatePendingInboundByProduct([partial]);
  assert.equal(pending.get(product.id), 12);
});

test('recepción total saca el pedido del tránsito', async () => {
  const product = await createProduct({
    name: 'RECEPCION TOTAL TEST',
    sku: 'REP-FULL',
    minStock: 10,
    maxStock: 30,
    replenishmentMethod: 'ORDER'
  });

  const item = await createReplenishment({
    productId: product.id,
    requestedQuantity: 6
  });

  await changeReplenishmentStatus(
    item.id,
    REPLENISHMENT_STATUS.ORDERED
  );

  const received = await registerReplenishmentReceipt(item.id, {
    quantity: 6,
    entryDocumentId: 'ent-full-001'
  });

  assert.equal(received.status, REPLENISHMENT_STATUS.RECEIVED);
  assert.equal(received.pendingQuantity, 0);

  const pending = calculatePendingInboundByProduct([received]);
  assert.equal(pending.has(product.id), false);
});

test('no permite recibir más de lo pendiente', async () => {
  const product = await createProduct({
    name: 'SOBRERECEPCION TEST',
    sku: 'REP-OVER',
    minStock: 0,
    maxStock: 20,
    replenishmentMethod: 'PURCHASE'
  });

  const item = await createReplenishment({
    productId: product.id,
    method: 'PURCHASE',
    requestedQuantity: 5
  });

  await changeReplenishmentStatus(
    item.id,
    REPLENISHMENT_STATUS.ORDERED
  );

  await assert.rejects(
    registerReplenishmentReceipt(item.id, {
      quantity: 6,
      entryDocumentId: 'ent-over-001'
    }),
    /solo quedan 5 pendientes/i
  );
});

test('un producto BOTH exige elegir compra o pedido', async () => {
  const product = await createProduct({
    name: 'METODO BOTH TEST',
    sku: 'REP-BOTH',
    minStock: 0,
    maxStock: 20,
    replenishmentMethod: 'BOTH'
  });

  await assert.rejects(
    createReplenishment({
      productId: product.id,
      requestedQuantity: 5
    }),
    /indica si será Compra o Pedido/i
  );
});
