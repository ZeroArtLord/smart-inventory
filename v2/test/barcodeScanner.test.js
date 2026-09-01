import test from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizeScannedCode,
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
