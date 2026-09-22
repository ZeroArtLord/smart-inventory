import test from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizeScannedCode,
  isLikelyBarcodeInput,
  resolveProductByBarcode,
  findProductByBarcode
} = await import('../src/scanner/barcodeScanner.js');

test('normaliza espacios del código escaneado sin convertirlo a número', () => {
  assert.equal(
    normalizeScannedCode('  07590000000012  '),
    '07590000000012'
  );
});

test('encuentra producto por código de barras exacto', () => {
  const products = [
    {
      id: 'prd-a',
      name: 'Aceite',
      barcode: '7590000000012'
    },
    {
      id: 'prd-b',
      name: 'Arroz',
      barcode: '7590000000013'
    }
  ];

  const product = findProductByBarcode(
    products,
    '7590000000013'
  );

  assert.equal(product?.id, 'prd-b');
});

test('no confunde códigos parecidos ni notación científica', () => {
  const products = [
    {
      id: 'prd-a',
      name: 'Aceite',
      barcode: '7590000000012'
    }
  ];

  assert.equal(
    findProductByBarcode(products, '7.59E+12'),
    null
  );

  assert.equal(
    findProductByBarcode(products, '759000000001'),
    null
  );
});


test('reconoce entrada probable de lector USB sin confundir nombres normales', () => {
  assert.equal(isLikelyBarcodeInput('7590000000012'), true);
  assert.equal(isLikelyBarcodeInput('ABC-123456'), true);
  assert.equal(isLikelyBarcodeInput('ACEITE SOYA'), false);
  assert.equal(isLikelyBarcodeInput('REFRESCO'), false);
});

test('resuelve metadatos físicos del código además del producto lógico', () => {
  const product = {
    id: 'oil-multi',
    name: 'Aceite soya LT',
    barcodes: [
      { code: 'USB-900001', label: 'Botella 900ml', conversion: 0.9 }
    ]
  };

  const match = resolveProductByBarcode([product], 'USB-900001');

  assert.equal(match?.product?.id, 'oil-multi');
  assert.equal(match?.barcode?.label, 'Botella 900ml');
  assert.equal(match?.barcode?.conversion, 0.9);
});
