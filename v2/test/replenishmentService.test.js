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
  reconcileReplenishmentReceipts,
  REPLENISHMENT_STATUS
} = await import('../src/replenishment/replenishmentService.js');

const {
  createDocument,
  saveDocumentLine,
  closeDocument
} = await import('../src/documents/documentService.js');

const {
  DOCUMENT_TYPES
} = await import('../src/documents/documentTypes.js');

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


test('registrar dos veces la misma Entrada no duplica la recepción', async () => {
  const product = await createProduct({
    name: 'RECEPCION IDEMPOTENTE TEST',
    sku: 'REP-IDEMP',
    minStock: 0,
    maxStock: 20,
    replenishmentMethod: 'ORDER'
  });

  const item = await createReplenishment({
    productId: product.id,
    requestedQuantity: 10
  });

  await changeReplenishmentStatus(
    item.id,
    REPLENISHMENT_STATUS.ORDERED
  );

  const first = await registerReplenishmentReceipt(item.id, {
    quantity: 4,
    entryDocumentId: 'ent-idempotent-001'
  });

  const second = await registerReplenishmentReceipt(item.id, {
    quantity: 4,
    entryDocumentId: 'ent-idempotent-001'
  });

  assert.equal(first.receivedQuantity, 4);
  assert.equal(second.receivedQuantity, 4);
  assert.equal(second.pendingQuantity, 6);
  assert.equal(second.receiptDocuments.length, 1);
});

test('reconciliación recupera una Entrada cerrada vinculada a un pedido', async () => {
  const product = await createProduct({
    name: 'RECONCILIACION PEDIDO TEST',
    sku: 'REP-RECON',
    minStock: 0,
    maxStock: 30,
    replenishmentMethod: 'PURCHASE'
  });

  const item = await createReplenishment({
    productId: product.id,
    method: 'PURCHASE',
    requestedQuantity: 9
  });

  await changeReplenishmentStatus(
    item.id,
    REPLENISHMENT_STATUS.ORDERED
  );

  const entry = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'almacenista-reconcile',
    metadata: {
      replenishmentId: item.id,
      replenishmentProductId: product.id
    }
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 5
  });

  await closeDocument(entry.id, {
    userId: 'almacenista-reconcile'
  });

  const reconciled = await reconcileReplenishmentReceipts();

  const match = reconciled.find(
    row => row.replenishmentId === item.id
  );

  assert.equal(match.quantity, 5);
  assert.equal(match.status, REPLENISHMENT_STATUS.PARTIALLY_RECEIVED);

  const secondPass = await reconcileReplenishmentReceipts();
  assert.equal(
    secondPass.some(row => row.replenishmentId === item.id),
    false
  );
});
