import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function read(relativePath) {
  return readFile(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

test('historial de Surtidos cerrados carga impresión 80mm directa e idempotente', async () => {
  const ui = await read('../src/ui/supplyThermalPrintUi.js');
  const index = await read('../index.html');
  const sw = await read('../sw.js');

  for (const text of [
    'data-supply-thermal-print',
    'closed-document-row',
    'document-export-actions',
    'buildSupplyThermalPayload',
    'printThermalSupplyDocument',
    'listDocumentLines',
    'STORES.PRODUCTS',
    'STORES.CATEGORIES',
    "DOCUMENT_TYPES.SUPPLY",
    "DOCUMENT_STATUS.CLOSED",
    '🖨 80mm',
    'Enviando…'
  ]) {
    assert.ok(ui.includes(text), `Falta contrato UI térmico: ${text}`);
  }

  assert.ok(index.includes('supplyThermalPrintUi.js'));
  assert.ok(sw.includes('supplyThermalPrintUi.js'));
  assert.ok(sw.includes('supplyThermalPayload.js'));
});

test('botón térmico obtiene id tanto de filas GOD como del historial legacy', async () => {
  const ui = await read('../src/ui/supplyThermalPrintUi.js');

  assert.ok(ui.includes('v82DocumentId'));
  assert.ok(ui.includes('[data-action="export-document"][data-id]'));
  assert.ok(ui.includes('data-supply-thermal-print'));
});
