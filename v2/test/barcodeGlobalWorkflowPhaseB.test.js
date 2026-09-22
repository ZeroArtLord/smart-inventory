import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('Barcode Intelligence usa un controlador compartido para asociación global', async () => {
  const [controller, app, count] = await Promise.all([
    read('../src/ui/barcodeIntelligenceController.js'),
    read('../src/ui/app.js'),
    read('../src/ui/countWorkflowUi.js')
  ]);

  assert.match(controller, /resolveOrAssociateBarcode/);
  assert.match(controller, /openBarcodeAssociationDialog/);
  assert.match(controller, /addProductBarcode/);
  assert.match(app, /resolveOrAssociateBarcode/);
  assert.match(count, /resolveOrAssociateBarcode/);
});

test('Conteo permite escanear código para saltar al producto incluso en otra categoría', async () => {
  const count = await read('../src/ui/countWorkflowUi.js');

  assert.match(count, /v5CountSearch/);
  assert.match(count, /resolveProductByBarcode|resolveOrAssociateBarcode/);
  assert.match(count, /activeCategoryId/);
  assert.match(count, /v5CountForcedProductId/);
});

test('Catálogo y documentos aceptan barcode desconocido por Enter y abren asociación', async () => {
  const app = await read('../src/ui/app.js');

  assert.match(app, /catalogLocalSearch/);
  assert.match(app, /productSearch/);
  assert.match(app, /isLikelyBarcodeInput/);
  assert.match(app, /resolveOrAssociateBarcode/);
});


test('lector USB no puede convertir accidentalmente un barcode en cantidad de Conteo/Surtido', async () => {
  const [scanner, app, count] = await Promise.all([
    read('../src/scanner/barcodeScanner.js'),
    read('../src/ui/app.js'),
    read('../src/ui/countWorkflowUi.js')
  ]);

  assert.match(scanner, /isStrongBarcodeInput/);
  assert.match(app, /operationQuantity[\s\S]*isStrongBarcodeInput/);
  assert.match(count, /v5CountValue[\s\S]*isStrongBarcodeInput/);
});
