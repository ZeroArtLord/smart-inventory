import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  createDocument,
  saveDocumentLine,
  listDocumentLines
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const {
  createMovement,
  getCurrentStock
} = await import('../src/inventory/movementService.js');
const { MOVEMENT_TYPES } = await import('../src/core/movementTypes.js');
const { STORES, get, getAll } = await import('../src/storage/database.js');
const liveSupply = await import('../src/documents/liveSupplyService.js');

const {
  enableLiveSupplyCart,
  getLiveSupplyCartSummary,
  dispatchLiveSupply,
  updateLiveSupplyPlannedQuantity,
  removeLiveSupplyLine,
  LIVE_SUPPLY_DELIVERY_KIND
} = liveSupply;

let sequence = 0;

async function createFixture(quantity = 10) {
  sequence += 1;

  const product = await createProduct({
    name: `A1 EDITABLE PRODUCT ${sequence}`,
    sku: `A1-EDIT-${sequence}`,
    minStock: 0,
    maxStock: 0
  });

  await createMovement({
    productId: product.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 50,
    userId: 'seed-a1'
  });

  const cart = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: `warehouse-a1-${sequence}`
  });

  await saveDocumentLine({
    documentId: cart.id,
    productId: product.id,
    quantity
  });

  await enableLiveSupplyCart(cart.id, {
    userId: cart.ownerId
  });

  return { product, cart };
}

test('A1 expone operaciones explícitas para editar y retirar líneas del carrito vivo', () => {
  assert.equal(typeof updateLiveSupplyPlannedQuantity, 'function');
  assert.equal(typeof removeLiveSupplyLine, 'function');
});

test('A1 permite reemplazar la cantidad planificada antes de cualquier entrega', async () => {
  const { product, cart } = await createFixture(10);

  await updateLiveSupplyPlannedQuantity(
    cart.id,
    product.id,
    6,
    { userId: cart.ownerId }
  );

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].planned, 6);
  assert.equal(summary.rows[0].delivered, 0);
  assert.equal(summary.rows[0].remaining, 6);
});

test('A1 permite retirar completamente un producto no entregado y lo oculta del borrador activo', async () => {
  const { product, cart } = await createFixture(7);

  await removeLiveSupplyLine(
    cart.id,
    product.id,
    { userId: cart.ownerId }
  );

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.rows.length, 0);

  const visibleLines = await listDocumentLines(cart.id);
  assert.equal(visibleLines.length, 0);

  const allLines = await getAll(STORES.DOCUMENT_LINES);
  const tombstone = allLines.find(line =>
    line.documentId === cart.id &&
    line.productId === product.id
  );

  assert.ok(tombstone);
  assert.equal(tombstone.draftRemoved, true);
  assert.ok(tombstone.draftRemovedAt);
});

test('A1 nunca permite reducir el plan por debajo de lo ya entregado', async () => {
  const { product, cart } = await createFixture(10);

  const delivery = await dispatchLiveSupply(cart.id, {
    deliveryToken: `a1-delivery-${sequence}`,
    quantities: [
      { productId: product.id, quantity: 4 }
    ],
    userId: cart.ownerId
  });

  assert.equal(await getCurrentStock(product.id), 46);

  await assert.rejects(
    updateLiveSupplyPlannedQuantity(
      cart.id,
      product.id,
      3,
      { userId: cart.ownerId }
    ),
    /ya entregado|entregado/i
  );

  await updateLiveSupplyPlannedQuantity(
    cart.id,
    product.id,
    4,
    { userId: cart.ownerId }
  );

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.rows[0].planned, 4);
  assert.equal(summary.rows[0].delivered, 4);
  assert.equal(summary.rows[0].remaining, 0);

  const child = await get(STORES.DOCUMENTS, delivery.deliveryId);
  assert.equal(child.status, 'CLOSED');
  assert.equal(child.metadata.kind, LIVE_SUPPLY_DELIVERY_KIND);
  assert.equal(await getCurrentStock(product.id), 46);
});

test('A1 no permite eliminar una línea que ya tiene entrega física', async () => {
  const { product, cart } = await createFixture(8);

  const delivery = await dispatchLiveSupply(cart.id, {
    deliveryToken: `a1-remove-block-${sequence}`,
    quantities: [
      { productId: product.id, quantity: 2 }
    ],
    userId: cart.ownerId
  });

  await assert.rejects(
    removeLiveSupplyLine(
      cart.id,
      product.id,
      { userId: cart.ownerId }
    ),
    /entrega|entregado/i
  );

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].delivered, 2);

  const child = await get(STORES.DOCUMENTS, delivery.deliveryId);
  assert.equal(child.status, 'CLOSED');
  assert.equal(await getCurrentStock(product.id), 48);
});
