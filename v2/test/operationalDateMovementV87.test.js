import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  createDocument,
  saveDocumentLine,
  closeDocument
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const {
  createMovement,
  getCurrentStock
} = await import('../src/inventory/movementService.js');
const { MOVEMENT_TYPES } = await import('../src/core/movementTypes.js');
const { STORES, getAll } = await import('../src/storage/database.js');
const {
  enableLiveSupplyCart,
  setLiveSupplyOperationalDate,
  dispatchLiveSupply
} = await import('../src/documents/liveSupplyService.js');

async function seedProduct(name) {
  const product = await createProduct({
    name,
    sku: `${name}-${Date.now()}-${Math.random()}`,
    minStock: 0,
    maxStock: 0
  });
  await createMovement({
    productId: product.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 20,
    userId: 'seed-v87-movement'
  });
  return product;
}

test('V8.7 una entrega histórica usa operationalDate en effectiveAt sin falsear createdAt/closedAt', async () => {
  const product = await seedProduct('V87 HISTORICO');
  const cart = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'warehouse-v87-movement'
  });
  await saveDocumentLine({
    documentId: cart.id,
    productId: product.id,
    quantity: 3
  });
  await enableLiveSupplyCart(cart.id, {
    userId: 'warehouse-v87-movement',
    now: new Date(2026, 8, 14, 8, 0)
  });
  await setLiveSupplyOperationalDate(cart.id, '2026-09-12', {
    userId: 'warehouse-v87-movement',
    now: new Date(2026, 8, 14, 8, 5)
  });

  const delivery = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'v87-effective-date-1',
    quantities: [{ productId: product.id, quantity: 3 }],
    userId: 'warehouse-v87-movement'
  });

  const movements = (await getAll(STORES.MOVEMENTS)).filter(
    movement => movement.documentId === delivery.deliveryId &&
      movement.type === MOVEMENT_TYPES.SUPPLY
  );
  assert.equal(movements.length, 1);
  assert.equal(movements[0].effectiveAt, '2026-09-12T12:00:00.000Z');
  assert.notEqual(movements[0].createdAt, movements[0].effectiveAt);
  assert.notEqual(delivery.document.closedAt, movements[0].effectiveAt);
  assert.equal(await getCurrentStock(product.id), 17);
});

test('V8.7 un SUPPLY legacy sin operationalDate conserva effectiveAt técnico actual', async () => {
  const product = await seedProduct('V87 LEGACY');
  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'warehouse-v87-legacy'
  });
  await saveDocumentLine({
    documentId: supply.id,
    productId: product.id,
    quantity: 2
  });

  const before = Date.now();
  const closed = await closeDocument(supply.id, {
    userId: 'warehouse-v87-legacy'
  });
  const after = Date.now();
  const movement = closed.movements.find(
    item => item.type === MOVEMENT_TYPES.SUPPLY
  );

  const effectiveMs = new Date(movement.effectiveAt).getTime();
  assert.ok(effectiveMs >= before - 1000 && effectiveMs <= after + 1000);
  assert.equal(movement.effectiveAt, movement.createdAt);
});
