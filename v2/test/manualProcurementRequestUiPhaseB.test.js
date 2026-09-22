import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('Conteo muestra casilla Comprar por producto sin pedir datos extra', async () => {
  const ui = await read('../src/ui/countWorkflowUi.js');

  assert.match(ui, /data-v5-count-buy-flag/);
  assert.match(ui, /🛒 Comprar/);
  assert.match(ui, /manualProcurementRequested/);
  assert.match(ui, /setManualProcurementRequested/);
});

test('Comprar/Pedir incluye productos marcados en Conteo aunque VIGÍA sugiera cero', async () => {
  const [ui, render] = await Promise.all([
    read('../src/ui/procurementWorkspaceV6Ui.js'),
    read('../src/ui/procurementWorkspaceV6Render.js')
  ]);

  assert.match(ui, /manualProcurementRequested/);
  assert.match(ui, /COUNT_FLAG/);
  assert.match(render, /Marcado en conteo/);
  assert.match(ui, /clearManualProcurementRequests/);
});

test('servidor persiste la marca manual de compra del producto', async () => {
  const [migration, apply] = await Promise.all([
    read('../server/migrations/019_manual_procurement_request.sql'),
    read('../server/src/sync/applyEvent.js')
  ]);

  assert.match(migration, /manual_procurement_requested/i);
  assert.match(apply, /manual_procurement_requested/);
  assert.match(apply, /manualProcurementRequested/);
});
