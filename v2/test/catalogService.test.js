import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createProduct,
  updateProduct
} = await import('../src/catalog/catalogService.js');

const {
  createMovement
} = await import('../src/inventory/movementService.js');

test('permite cambiar unidad base antes de tener movimientos', async () => {
  const product = await createProduct({
    name: 'BASE UNIT PRE-HISTORY',
    sku: 'UNIT-PRE',
    inventoryUnitId: 'unit_und',
    minStock: 0,
    maxStock: 10
  });

  const updated = await updateProduct(
    product.id,
    {
      inventoryUnitId: 'unit_kg'
    }
  );

  assert.equal(
    updated.inventoryUnitId,
    'unit_kg'
  );
});

test('bloquea cambiar unidad base después de existir movimientos', async () => {
  const product = await createProduct({
    name: 'BASE UNIT LOCKED',
    sku: 'UNIT-LOCK',
    inventoryUnitId: 'unit_und',
    minStock: 0,
    maxStock: 10
  });

  await createMovement({
    productId: product.id,
    type: 'ADJUSTMENT',
    quantity: 5,
    delta: 5,
    userId: 'test-user'
  });

  await assert.rejects(
    () => updateProduct(
      product.id,
      {
        inventoryUnitId: 'unit_kg'
      }
    ),
    error =>
      error?.code === 'BASE_UNIT_LOCKED' &&
      /unidad base/i.test(error.message)
  );
});


test('genera SKU Smart interno cuando existe Código SAINT y SKU está vacío', async () => {
  const product = await createProduct({
    name: 'PRODUCTO SAINT AUTO SKU',
    saintCode: 'sa 001/ve',
    sku: '',
    inventoryUnitId: 'unit_und',
    minStock: 0,
    maxStock: 10
  });

  assert.equal(
    product.saintCode,
    'SA 001/VE'
  );
  assert.equal(
    product.sku,
    'SM-SA-001-VE'
  );
});

test('SKU Smart personalizado no es reemplazado por Código SAINT', async () => {
  const product = await createProduct({
    name: 'PRODUCTO SKU CUSTOM',
    saintCode: 'SA-002',
    sku: 'INTERNO-77',
    inventoryUnitId: 'unit_und',
    minStock: 0,
    maxStock: 10
  });

  assert.equal(
    product.saintCode,
    'SA-002'
  );
  assert.equal(
    product.sku,
    'INTERNO-77'
  );
});
