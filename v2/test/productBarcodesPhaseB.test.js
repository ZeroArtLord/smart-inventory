import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const barcodeModel = await import('../src/catalog/barcodeModel.js');
const scanner = await import('../src/scanner/barcodeScanner.js');
const catalog = await import('../src/catalog/catalogService.js');

const {
  normalizeProductBarcodes,
  addProductBarcode
} = barcodeModel;

const {
  resolveProductByBarcode,
  findProductByBarcode
} = scanner;

const {
  createProduct,
  updateProduct,
  searchProducts
} = catalog;

test('B1 normaliza múltiples códigos físicos con conversión a unidad base', () => {
  const mappings = normalizeProductBarcodes([
    { code: '7590000000011', label: 'Marca A 1L', conversion: 1 },
    { code: '7590000000012', label: 'Marca B 900ml', conversion: 0.9 }
  ]);

  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].code, '7590000000011');
  assert.equal(mappings[0].conversion, 1);
  assert.equal(mappings[1].label, 'Marca B 900ml');
  assert.equal(mappings[1].conversion, 0.9);
});

test('B1 conserva el código legacy como asociación compatible', () => {
  const mappings = normalizeProductBarcodes([], {
    legacyBarcode: ' 07590000000012 '
  });

  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].code, '07590000000012');
  assert.equal(mappings[0].conversion, 1);
});

test('B1 rechaza códigos duplicados dentro del mismo producto', () => {
  assert.throws(
    () => normalizeProductBarcodes([
      { code: 'ABC-1', conversion: 1 },
      { code: 'abc-1', conversion: 1 }
    ]),
    /duplicado|código/i
  );
});

test('B1 resuelve producto y conversión por cualquiera de sus códigos', () => {
  const product = {
    id: 'oil',
    name: 'ACEITE SOYA LT',
    barcode: '',
    barcodes: [
      { code: '111', label: 'Marca A 1L', conversion: 1, active: true },
      { code: '222', label: 'Marca B 900ml', conversion: 0.9, active: true }
    ]
  };

  const match = resolveProductByBarcode([product], '222');

  assert.equal(match?.product?.id, 'oil');
  assert.equal(match?.barcode?.label, 'Marca B 900ml');
  assert.equal(match?.barcode?.conversion, 0.9);
  assert.equal(findProductByBarcode([product], '111')?.id, 'oil');
});

test('B1 agrega un nuevo código sin crear otro producto lógico', () => {
  const product = {
    id: 'oil',
    name: 'ACEITE SOYA LT',
    barcodes: [
      { code: '111', label: 'Marca A', conversion: 1 }
    ]
  };

  const next = addProductBarcode(product, {
    code: '222',
    label: 'Marca B 900ml',
    conversion: 0.9
  });

  assert.equal(next.length, 2);
  assert.equal(next[1].code, '222');
  assert.equal(next[1].conversion, 0.9);
});

test('B1 catálogo bloquea que un código físico pertenezca a dos productos locales', async () => {
  await createProduct({
    name: 'ACEITE SOYA LT B1 A',
    sku: 'B1-OIL-A',
    inventoryUnitId: 'unit_lt',
    barcodes: [
      { code: '759-B1-UNICO', label: 'Marca A', conversion: 1 }
    ]
  });

  await assert.rejects(
    () => createProduct({
      name: 'ACEITE SOYA LT B1 B',
      sku: 'B1-OIL-B',
      inventoryUnitId: 'unit_lt',
      barcodes: [
        { code: '759-b1-unico', label: 'Marca B', conversion: 1 }
      ]
    }),
    error => error?.code === 'BARCODE_DUPLICATE'
  );
});

test('B1 búsqueda de catálogo encuentra producto por cualquiera de sus códigos o etiquetas', async () => {
  const product = await createProduct({
    name: 'ACEITE SOYA LT B1 SEARCH',
    sku: 'B1-OIL-SEARCH',
    inventoryUnitId: 'unit_lt',
    barcodes: [
      { code: 'B1-SEARCH-900', label: 'Botella 900ml Especial', conversion: 0.9 }
    ]
  });

  const byCode = await searchProducts('B1-SEARCH-900');
  const byLabel = await searchProducts('900ml Especial');

  assert.ok(byCode.some(item => item.id === product.id));
  assert.ok(byLabel.some(item => item.id === product.id));
});

test('B1 update permite asociar un código desconocido al producto existente', async () => {
  const product = await createProduct({
    name: 'ACEITE SOYA LT B1 UPDATE',
    sku: 'B1-OIL-UPDATE',
    inventoryUnitId: 'unit_lt'
  });

  const barcodes = addProductBarcode(product, {
    code: 'B1-NEW-CODE',
    label: 'Nueva marca 1L',
    conversion: 1
  });

  const updated = await updateProduct(product.id, { barcodes });

  assert.equal(updated.id, product.id);
  assert.equal(updated.barcodes.length, 1);
  assert.equal(updated.barcodes[0].code, 'B1-NEW-CODE');
});
