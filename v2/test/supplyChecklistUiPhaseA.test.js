import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('A2 Hoja de surtido se carga como módulo propio y conserva formato categoría / producto / cantidad / OK', async () => {
  const [ui, index, sw] = await Promise.all([
    read('../src/ui/supplyChecklistUi.js'),
    read('../index.html'),
    read('../sw.js')
  ]);

  for (const text of [
    'data-supply-checklist-open',
    'Hoja de surtido',
    'data-supply-checklist-item',
    'type="checkbox"',
    'PRODUCTO',
    'CANT.',
    'OK',
    'buildSupplyChecklistModel',
    'setSupplyChecklistItemChecked',
    'clearSupplyChecklistState'
  ]) {
    assert.ok(ui.includes(text), `Falta contrato A2: ${text}`);
  }

  assert.ok(index.includes('supplyChecklistUi.js'));
  assert.ok(index.includes('v8-8-phase-a.css'));
  assert.ok(sw.includes('supplyChecklistUi.js'));
  assert.ok(sw.includes('supplyChecklistService.js'));
  assert.ok(sw.includes('v8-8-phase-a.css'));
});

test('A2 la hoja es de preparación y no despacha, cierra ni modifica stock', async () => {
  const ui = await read('../src/ui/supplyChecklistUi.js');

  assert.doesNotMatch(ui, /dispatchLiveSupply\s*\(/);
  assert.doesNotMatch(ui, /closeDocument\s*\(/);
  assert.doesNotMatch(ui, /createMovement\s*\(/);
});
