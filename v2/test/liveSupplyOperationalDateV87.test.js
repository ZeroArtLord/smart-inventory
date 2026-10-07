import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  createDocument,
  saveDocumentLine
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const {
  createMovement,
  getCurrentStock
} = await import('../src/inventory/movementService.js');
const { MOVEMENT_TYPES } = await import('../src/core/movementTypes.js');
const { STORES, get, put } = await import('../src/storage/database.js');
const {
  enableLiveSupplyCart,
  setLiveSupplyOperationalDate,
  dispatchLiveSupply,
  LIVE_SUPPLY_DELIVERY_KIND
} = await import('../src/documents/liveSupplyService.js');

let product;

async function seed() {
  if (!product) {
    product = await createProduct({
      name: 'V87 FECHA OPERATIVA',
      sku: 'V87-OP-DATE',
      minStock: 0,
      maxStock: 0
    });
    await createMovement({
      productId: product.id,
      type: MOVEMENT_TYPES.ENTRY,
      quantity: 20,
      userId: 'seed-v87'
    });
  }

  const cart = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'warehouse-v87',
    reference: 'V8.7 operational date'
  });
  await saveDocumentLine({
    documentId: cart.id,
    productId: product.id,
    quantity: 5
  });
  return cart;
}

test('V8.7 un carrito nuevo fija hoy por defecto y permite cambiar a pasado', async () => {
  const cart = await seed();
  const enabled = await enableLiveSupplyCart(cart.id, {
    userId: 'warehouse-v87',
    now: new Date(2026, 8, 14, 9, 30)
  });

  assert.equal(enabled.metadata.operationalDate, '2026-09-14');

  const changed = await setLiveSupplyOperationalDate(
    cart.id,
    '2026-09-12',
    {
      userId: 'warehouse-v87',
      now: new Date(2026, 8, 14, 10, 0)
    }
  );

  assert.equal(changed.metadata.operationalDate, '2026-09-12');
  assert.equal(await getCurrentStock(product.id), 20);
});

test('V8.7 reabre un carrito V5-E legacy sin fecha y fija hoy sin tocar líneas ni stock', async () => {
  const cart = await seed();
  const enabled = await enableLiveSupplyCart(cart.id, {
    userId: 'warehouse-v87',
    now: new Date(2026, 8, 13, 9, 30)
  });
  const legacy = {
    ...enabled,
    metadata: { ...enabled.metadata }
  };
  delete legacy.metadata.operationalDate;
  await put(STORES.DOCUMENTS, legacy);

  const reopened = await enableLiveSupplyCart(cart.id, {
    userId: 'warehouse-v87',
    now: new Date(2026, 8, 14, 9, 30)
  });

  assert.equal(reopened.metadata.operationalDate, '2026-09-14');
  assert.equal(reopened.metadata.liveSupplyEnabledAt, enabled.metadata.liveSupplyEnabledAt);
  assert.equal(await getCurrentStock(product.id), 20);
});

test('V8.7 el servicio rechaza fecha futura antes de cualquier entrega', async () => {
  const cart = await seed();
  await enableLiveSupplyCart(cart.id, {
    userId: 'warehouse-v87',
    now: new Date(2026, 8, 14, 9, 30)
  });

  await assert.rejects(
    () => setLiveSupplyOperationalDate(
      cart.id,
      '2026-09-15',
      {
        userId: 'warehouse-v87',
        now: new Date(2026, 8, 14, 10, 0)
      }
    ),
    /futur/i
  );
});

test('V8.7 hijo hereda fecha y la fecha queda bloqueada tras primera entrega', async () => {
  const cart = await seed();
  await enableLiveSupplyCart(cart.id, {
    userId: 'warehouse-v87',
    now: new Date(2026, 8, 14, 9, 30)
  });
  await setLiveSupplyOperationalDate(
    cart.id,
    '2026-09-12',
    {
      userId: 'warehouse-v87',
      now: new Date(2026, 8, 14, 10, 0)
    }
  );

  const delivery = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'v87-op-date-delivery-1',
    quantities: [{ productId: product.id, quantity: 2 }],
    userId: 'warehouse-v87'
  });

  assert.equal(delivery.document.status, 'CLOSED');
  assert.equal(delivery.document.metadata.kind, LIVE_SUPPLY_DELIVERY_KIND);
  assert.equal(delivery.document.metadata.operationalDate, '2026-09-12');

  await assert.rejects(
    () => setLiveSupplyOperationalDate(
      cart.id,
      '2026-09-13',
      {
        userId: 'warehouse-v87',
        now: new Date(2026, 8, 14, 12, 0)
      }
    ),
    /bloque|entrega|cambiar/i
  );

  const stored = await get(STORES.DOCUMENTS, cart.id);
  assert.equal(stored.metadata.operationalDate, '2026-09-12');

  const retry = await dispatchLiveSupply(cart.id, {
    deliveryToken: 'v87-op-date-delivery-1',
    quantities: [{ productId: product.id, quantity: 2 }],
    userId: 'warehouse-v87'
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.deliveryId, delivery.deliveryId);
});
