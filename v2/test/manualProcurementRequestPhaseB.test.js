import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createProduct
} = await import('../src/catalog/catalogService.js');

const {
  setManualProcurementRequested,
  listManualProcurementRequestedProducts
} = await import('../src/replenishment/manualProcurementRequestService.js');

test('B2 urgente: Conteo puede marcar Comprar sin cantidad ni movimiento', async () => {
  const product = await createProduct({
    name: 'ACEITUNAS VERDES FLAG',
    sku: 'FLAG-ACEITUNAS',
    inventoryUnitId: 'unit_kg',
    minStock: 0,
    maxStock: 10
  });

  const marked = await setManualProcurementRequested(
    product.id,
    true
  );

  assert.equal(marked.manualProcurementRequested, true);
  assert.ok(marked.manualProcurementRequestedAt);

  const requested = await listManualProcurementRequestedProducts();
  assert.ok(requested.some(item => item.id === product.id));
});

test('B2 urgente: la marca Comprar se puede quitar sin tocar stock', async () => {
  const product = await createProduct({
    name: 'PRODUCTO FLAG TOGGLE',
    sku: 'FLAG-TOGGLE',
    inventoryUnitId: 'unit_und'
  });

  await setManualProcurementRequested(product.id, true);
  const cleared = await setManualProcurementRequested(
    product.id,
    false
  );

  assert.equal(cleared.manualProcurementRequested, false);
  assert.equal(cleared.manualProcurementRequestedAt, null);
});

test('B2 urgente: listado manual solo devuelve productos activos marcados', async () => {
  const product = await createProduct({
    name: 'PRODUCTO FLAG ACTIVO',
    sku: 'FLAG-ACTIVO',
    inventoryUnitId: 'unit_und'
  });

  await setManualProcurementRequested(product.id, true);

  const rows = await listManualProcurementRequestedProducts();
  assert.ok(rows.some(item => item.id === product.id));
});
