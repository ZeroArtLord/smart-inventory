import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('B1 código desconocido abre asociación con búsqueda de producto y conversión', async () => {
  const [app, ui, controller] = await Promise.all([
    read('../src/ui/app.js'),
    read('../src/ui/barcodeAssociationUi.js'),
    read('../src/ui/barcodeIntelligenceController.js')
  ]);

  for (const text of [
    'resolveProductByBarcode',
    'openBarcodeAssociationDialog',
    'addProductBarcode',
    'Código no reconocido',
    'conversion'
  ]) {
    assert.ok(
      app.includes(text) ||
      ui.includes(text) ||
      controller.includes(text),
      `Falta contrato B1 UI: ${text}`
    );
  }

  for (const text of [
    'Buscar producto',
    'data-barcode-association-product',
    'data-barcode-association-conversion',
    'Asociar código'
  ]) {
    assert.ok(ui.includes(text), `Falta modal B1: ${text}`);
  }
});

test('B1 servidor persiste barcodes y rechaza asociación duplicada entre productos', async () => {
  const [migration, applyEvent] = await Promise.all([
    read('../server/migrations/018_product_barcodes.sql'),
    read('../server/src/sync/applyEvent.js')
  ]);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS barcodes jsonb/i);
  assert.match(applyEvent, /BARCODE_DUPLICATE/);
  assert.match(applyEvent, /jsonb_array_elements/);
  assert.match(applyEvent, /barcodes=EXCLUDED\.barcodes/);
});
