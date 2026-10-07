import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  createDocument,
  saveDocumentLine,
  createCorrectionDraft
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const {
  createMovement,
  getCurrentStock
} = await import('../src/inventory/movementService.js');
const { MOVEMENT_TYPES } = await import('../src/core/movementTypes.js');
const {
  STORES,
  getAll,
  get
} = await import('../src/storage/database.js');
const {
  enableLiveSupplyCart,
  getLiveSupplyCartSummary,
  dispatchLiveSupply,
  cancelLiveSupplyRemaining,
  finalizeLiveSupplyCart,
  cancelLiveSupplyCart,
  LIVE_SUPPLY_CART_KIND,
  LIVE_SUPPLY_DELIVERY_KIND
} = await import('../src/documents/liveSupplyService.js');

let product;

async function seedProduct() {
  if (product) return product;

  product = await createProduct({
    name: 'V5E PRODUCTO EXACT ONCE',
    sku: 'V5E-EXACT-ONCE',
    minStock: 0,
    maxStock: 0
  });

  await createMovement({
    productId: product.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 20,
    userId: 'seed-v5e'
  });

  return product;
}

async function createLiveCart(quantity, ownerId) {
  await seedProduct();
  const cart = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId,
    reference: `V5E ${ownerId}`
  });

  await saveDocumentLine({
    documentId: cart.id,
    productId: product.id,
    quantity
  });

  return enableLiveSupplyCart(cart.id, { userId: ownerId });
}

test('el mismo token de entrega descuenta stock exactamente una vez', async () => {
  const cart = await createLiveCart(10, 'warehouse-v5e-1');
  assert.equal(cart.metadata.kind, LIVE_SUPPLY_CART_KIND);

  const first = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'handoff-001',
    quantities: [
      { productId: product.id, quantity: 4 }
    ],
    userId: 'warehouse-v5e-1'
  });

  assert.equal(first.document.status, 'CLOSED');
  assert.equal(
    first.document.metadata.kind,
    LIVE_SUPPLY_DELIVERY_KIND
  );
  assert.equal(first.idempotent, false);
  assert.equal(await getCurrentStock(product.id), 16);

  const retry = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'handoff-001',
    quantities: [
      { productId: product.id, quantity: 4 }
    ],
    userId: 'warehouse-v5e-1'
  });

  assert.equal(retry.idempotent, true);
  assert.equal(retry.deliveryId, first.deliveryId);
  assert.equal(await getCurrentStock(product.id), 16);

  const movements = await getAll(STORES.MOVEMENTS);
  const deliveryMovements = movements.filter(
    movement => movement.documentId === first.deliveryId &&
      movement.type === MOVEMENT_TYPES.SUPPLY
  );
  assert.equal(deliveryMovements.length, 1);
  assert.equal(deliveryMovements[0].quantity, 4);

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.deliveredTotal, 4);
  assert.equal(summary.remainingTotal, 6);
});

test('editar el objetivo del carrito no reescribe entregas ya cerradas', async () => {
  const carts = (await getAll(STORES.DOCUMENTS))
    .filter(document => document.metadata?.kind === LIVE_SUPPLY_CART_KIND)
    .filter(document => document.status === 'DRAFT');
  const cart = carts[0];
  assert.ok(cart);

  await saveDocumentLine({
    documentId: cart.id,
    productId: product.id,
    quantity: 12
  });

  const afterEdit = await getLiveSupplyCartSummary(cart.id);
  assert.equal(afterEdit.deliveredTotal, 4);
  assert.equal(afterEdit.remainingTotal, 8);
  assert.equal(await getCurrentStock(product.id), 16);

  await dispatchLiveSupply(cart.id, {
    deliveryToken: 'handoff-002',
    quantities: [
      { productId: product.id, quantity: 3 }
    ],
    userId: 'warehouse-v5e-1'
  });

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.plannedTotal, 12);
  assert.equal(summary.deliveredTotal, 7);
  assert.equal(summary.remainingTotal, 5);
  assert.equal(await getCurrentStock(product.id), 13);
});

test('cancelar pendiente y finalizar el carrito padre no vuelve a descontar stock', async () => {
  const cart = (await getAll(STORES.DOCUMENTS))
    .find(document =>
      document.metadata?.kind === LIVE_SUPPLY_CART_KIND &&
      document.status === 'DRAFT'
    );
  assert.ok(cart);

  await cancelLiveSupplyRemaining(
    cart.id,
    product.id,
    {
      userId: 'warehouse-v5e-1',
      reason: 'Destino ya no requiere el resto'
    }
  );

  const cancelledSummary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(cancelledSummary.remainingTotal, 0);
  assert.equal(cancelledSummary.cancelledRemainingTotal, 5);

  const movementCountBefore = (await getAll(STORES.MOVEMENTS)).length;
  const final = await finalizeLiveSupplyCart(cart.id, {
    userId: 'warehouse-v5e-1'
  });
  const movementCountAfter = (await getAll(STORES.MOVEMENTS)).length;

  assert.equal(final.document.status, 'CLOSED');
  assert.equal(final.document.metadata.closeMode, LIVE_SUPPLY_CART_KIND);
  assert.equal(final.movements.length, 0);
  assert.equal(movementCountAfter, movementCountBefore);
  assert.equal(await getCurrentStock(product.id), 13);
});

test('cancelar carrito conserva entregas físicas ya realizadas', async () => {
  const cart = await createLiveCart(2, 'warehouse-v5e-2');
  const delivery = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'handoff-cancel-001',
    quantities: [
      { productId: product.id, quantity: 1 }
    ],
    userId: 'warehouse-v5e-2'
  });

  assert.equal(await getCurrentStock(product.id), 12);

  const cancelled = await cancelLiveSupplyCart(cart.id, {
    userId: 'warehouse-v5e-2',
    reason: 'Turno terminado'
  });

  assert.equal(cancelled.document.status, 'CANCELLED');
  assert.equal(await getCurrentStock(product.id), 12);
  assert.ok(await get(STORES.DOCUMENTS, delivery.deliveryId));
});

test('corregir una entrega usa REVERSAL y el resumen vuelve a abrir el pendiente', async () => {
  const cart = await createLiveCart(2, 'warehouse-v5e-3');
  const delivery = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'handoff-reversal-001',
    quantities: [
      { productId: product.id, quantity: 2 }
    ],
    userId: 'warehouse-v5e-3'
  });

  assert.equal(await getCurrentStock(product.id), 10);

  const correction = await createCorrectionDraft(
    delivery.deliveryId,
    {
      userId: 'god-v5e',
      reason: 'Entrega física anulada y mercancía devuelta'
    }
  );

  assert.equal(correction.reversals.length, 1);
  assert.equal(correction.reversals[0].type, MOVEMENT_TYPES.REVERSAL);
  assert.equal(await getCurrentStock(product.id), 12);

  const summary = await getLiveSupplyCartSummary(cart.id);
  assert.equal(summary.deliveredTotal, 0);
  assert.equal(summary.remainingTotal, 2);
});
