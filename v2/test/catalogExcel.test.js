import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  parseCatalogMatrix,
  parseQuantityCell,
  applyCatalogImport
} = await import('../src/catalog/catalogExcel.js');

const {
  createProduct,
  listProducts
} = await import('../src/catalog/catalogService.js');

test('interpreta el formato clásico de Smart Inventory y no convierte existencia en stock', () => {
  const preview = parseCatalogMatrix([
    ['Producto', 'Mínimo', 'Máximo', 'Existencia', 'Categoría'],
    ['CLORO LT', '10LT', '30LT', '15', 'LIMPIEZA'],
    ['SERVILLETAS', '5 BULTOS', '10 BULTOS', '3', 'DESECHABLES']
  ]);

  assert.equal(preview.rows.length, 2);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.ignoredStockRows, 2);

  assert.deepEqual(
    {
      name: preview.rows[0].name,
      minStock: preview.rows[0].minStock,
      maxStock: preview.rows[0].maxStock,
      unitCode: preview.rows[0].unitCode,
      categoryName: preview.rows[0].categoryName,
      ignoredStock: preview.rows[0].ignoredStock
    },
    {
      name: 'CLORO LT',
      minStock: 10,
      maxStock: 30,
      unitCode: 'LT',
      categoryName: 'LIMPIEZA',
      ignoredStock: 15
    }
  );

  assert.match(preview.warnings[0], /No se importará como stock/i);
});

test('detecta código de barras sin confundirlo con SKU', () => {
  const preview = parseCatalogMatrix([
    ['Producto', 'Código de barras', 'SKU', 'Stock mínimo', 'Stock máximo'],
    ['ACEITE 1LT', '7590000000012', 'ACE001', 20, 40]
  ]);

  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].barcode, '7590000000012');
  assert.equal(preview.rows[0].sku, 'ACE001');
  assert.equal(preview.detectedHeaders.barcode, 1);
  assert.equal(preview.detectedHeaders.sku, 2);
});

test('rechaza una fila cuyo mínimo supera al máximo', () => {
  const preview = parseCatalogMatrix([
    ['Producto', 'Mínimo', 'Máximo'],
    ['HARINA', 50, 20]
  ]);

  assert.equal(preview.rows.length, 0);
  assert.equal(preview.errors.length, 1);
  assert.match(preview.errors[0], /supera máximo/i);
});

test('acepta cantidades con coma y unidad', () => {
  assert.deepEqual(
    parseQuantityCell('12,5 KG'),
    { value: 12.5, unit: 'KG', error: null }
  );
});


test('actualizar desde Excel no borra SKU o barcode si esas columnas no existen', async () => {
  await createProduct({
    name: 'PRODUCTO PRESERVADO',
    sku: 'SKU-PRESERVAR',
    barcode: '7591234567890',
    minStock: 1,
    maxStock: 5,
    replenishmentMethod: 'PURCHASE'
  });

  const preview = parseCatalogMatrix([
    ['Producto', 'Mínimo', 'Máximo'],
    ['PRODUCTO PRESERVADO', 2, 8]
  ]);

  const result = await applyCatalogImport(preview);
  assert.equal(result.updated, 1);

  const products = await listProducts();
  const saved = products.find(product => product.name === 'PRODUCTO PRESERVADO');

  assert.equal(saved.sku, 'SKU-PRESERVAR');
  assert.equal(saved.barcode, '7591234567890');
  assert.equal(saved.replenishmentMethod, 'PURCHASE');
  assert.equal(saved.minStock, 2);
  assert.equal(saved.maxStock, 8);
});
