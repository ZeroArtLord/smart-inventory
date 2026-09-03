import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  parseCatalogMatrix,
  parseQuantityCell,
  applyCatalogImport,
  buildSaintInitialLoadTemplateMatrix
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


test('interpreta empaques SAINT y convierte mínimos/máximos a unidad base', () => {
  const preview = parseCatalogMatrix([
    [
      'USAR',
      'CÓDIGO SAINT',
      'PRODUCTO',
      'EXISTENCIA SAINT',
      'UNIDAD BASE',
      'PRESENTACIÓN',
      'UNIDADES POR PRESENTACIÓN',
      'PRESENTACIÓN SECUNDARIA',
      'UND PRESENTACIÓN SECUNDARIA',
      'MÍNIMO',
      'MÁXIMO',
      'CATEGORÍA',
      'REPOSICIÓN'
    ],
    [
      'SI',
      'REF001',
      'REFRESCO COLA 350 ML',
      '485 UND',
      'UND',
      'CAJA',
      24,
      'BULTO',
      96,
      '5 CAJAS',
      '10 BULTOS',
      'BEBIDAS',
      'COMPRA'
    ],
    [
      'NO',
      'OLD001',
      'PRODUCTO HISTÓRICO',
      99,
      'UND',
      'CAJA',
      24,
      '',
      '',
      1,
      2,
      'VIEJOS',
      'COMPRA'
    ]
  ]);

  assert.equal(preview.errors.length, 0);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.skippedRows, 1);

  const row = preview.rows[0];

  assert.equal(row.sku, 'REF001');
  assert.equal(row.inventoryUnitId, 'unit_und');
  assert.equal(row.unitCode, 'UND');
  assert.equal(row.minStock, 120);
  assert.equal(row.maxStock, 960);
  assert.equal(row.saintInitialStock, 485);
  assert.equal(row.presentations.length, 2);

  assert.deepEqual(
    row.presentations.map(item => ({
      code: item.code,
      conversion: item.conversion,
      primary: item.primary
    })),
    [
      {
        code: 'CAJA',
        conversion: 24,
        primary: true
      },
      {
        code: 'BULTO',
        conversion: 96,
        primary: false
      }
    ]
  );
});

test('importar catálogo conserva presentaciones y compatibilidad de unidad de compra', async () => {
  const preview = parseCatalogMatrix([
    [
      'Producto',
      'SKU',
      'Unidad base',
      'Presentación',
      'Unidades por presentación',
      'Mínimo',
      'Máximo'
    ],
    [
      'PRODUCTO CON CAJA',
      'PKG-001',
      'UND',
      'CAJA',
      24,
      '2 CAJAS',
      '8 CAJAS'
    ]
  ]);

  assert.equal(preview.errors.length, 0);

  const result = await applyCatalogImport(preview);
  assert.equal(result.created, 1);

  const products = await listProducts();
  const saved = products.find(
    product => product.sku === 'PKG-001'
  );

  assert.ok(saved);
  assert.equal(saved.minStock, 48);
  assert.equal(saved.maxStock, 192);
  assert.equal(saved.purchaseUnitId, 'unit_box');
  assert.equal(saved.purchaseConversion, 24);
  assert.equal(saved.presentations.length, 1);
  assert.equal(saved.presentations[0].code, 'CAJA');
});


test('la plantilla SAINT contiene las columnas de depuración, empaques y existencia inicial', () => {
  const matrix = buildSaintInitialLoadTemplateMatrix();

  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 2);

  const headers = matrix[0];

  for (const expected of [
    'USAR',
    'CÓDIGO SAINT',
    'PRODUCTO',
    'EXISTENCIA SAINT',
    'UNIDAD BASE',
    'PRESENTACIÓN',
    'UNIDADES POR PRESENTACIÓN',
    'PRESENTACIÓN SECUNDARIA',
    'UND PRESENTACIÓN SECUNDARIA',
    'MÍNIMO',
    'MÁXIMO',
    'CATEGORÍA',
    'REPOSICIÓN'
  ]) {
    assert.ok(
      headers.includes(expected),
      `Falta columna ${expected}`
    );
  }
});


test('distingue ausencia de columna de existencia de un cero explícito', () => {
  const withoutStock = parseCatalogMatrix([
    ['Producto', 'SKU', 'Mínimo', 'Máximo'],
    ['PRODUCTO A', 'A001', 1, 5]
  ]);

  assert.equal(
    withoutStock.hasInitialStockColumn,
    false
  );
  assert.equal(
    withoutStock.rows[0].saintInitialStock,
    null
  );

  const withZero = parseCatalogMatrix([
    ['Producto', 'SKU', 'Existencia SAINT', 'Mínimo', 'Máximo'],
    ['PRODUCTO A', 'A001', 0, 1, 5]
  ]);

  assert.equal(
    withZero.hasInitialStockColumn,
    true
  );
  assert.equal(
    withZero.rows[0].saintInitialStock,
    0
  );
});

test('una existencia SAINT vacía no se convierte silenciosamente en cero', () => {
  const preview = parseCatalogMatrix([
    ['Producto', 'SKU', 'Existencia SAINT', 'Mínimo', 'Máximo'],
    ['PRODUCTO A', 'A001', '', 1, 5]
  ]);

  assert.equal(
    preview.hasInitialStockColumn,
    true
  );
  assert.equal(
    preview.rows[0].saintInitialStock,
    null
  );
});


test('rechaza unidad base desconocida en vez de asumir UND', () => {
  const preview = parseCatalogMatrix([
    ['Producto', 'SKU', 'Unidad base', 'Mínimo', 'Máximo'],
    ['PRODUCTO EN GRAMOS', 'GR001', 'GR', 100, 500]
  ]);

  assert.equal(preview.rows.length, 0);
  assert.equal(preview.errors.length, 1);
  assert.match(
    preview.errors[0],
    /unidad base "GR" no soportada/i
  );
});
