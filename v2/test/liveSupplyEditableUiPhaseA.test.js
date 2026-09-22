import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const liveUi = await fs.readFile(
  new URL('../src/ui/liveSupplyUi.js', import.meta.url),
  'utf8'
);

const appUi = await fs.readFile(
  new URL('../src/ui/app.js', import.meta.url),
  'utf8'
);

test('A1 panel de surtido vivo ofrece editar plan y eliminar producto antes de entregar', () => {
  for (const text of [
    'updateLiveSupplyPlannedQuantity',
    'removeLiveSupplyLine',
    'data-v5-live-action="edit-plan"',
    'data-v5-live-action="remove-line"',
    'Editar plan',
    'Eliminar'
  ]) {
    assert.ok(liveUi.includes(text), `Falta contrato A1 en liveSupplyUi: ${text}`);
  }
});

test('A1 carrito lateral permite editar y quitar una línea ya agregada', () => {
  for (const text of [
    'editingDocumentLineId',
    'data-action="edit-draft-line"',
    'data-action="remove-draft-line"',
    'Guardar cambio',
    'removeLiveSupplyLine'
  ]) {
    assert.ok(appUi.includes(text), `Falta contrato A1 en app.js: ${text}`);
  }
});


test('A1 oculta eliminar cuando ya existe entrega física y captura rechazos async como validación normal', () => {
  for (const text of [
    'getLiveSupplyCartSummary',
    'deliveredByProduct',
    'lineDelivered',
    'lineDelivered <= 0',
    'handleClick(event).catch',
    'showToast(error.message || String(error))'
  ]) {
    assert.ok(appUi.includes(text), `Falta pulido A1: ${text}`);
  }
});
