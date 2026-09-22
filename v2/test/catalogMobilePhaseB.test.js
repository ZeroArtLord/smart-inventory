import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('B2 catálogo móvil usa tarjetas compactas con búsqueda sticky y acciones táctiles', async () => {
  const [app, css, index, sw] = await Promise.all([
    read('../src/ui/app.js'),
    read('../css/v8-9-phase-b.css'),
    read('../index.html'),
    read('../sw.js')
  ]);

  for (const text of [
    'catalog-mobile-card',
    'catalog-mobile-barcode-count',
    'catalog-mobile-primary-action',
    'catalog-mobile-category'
  ]) {
    assert.ok(app.includes(text), `Falta contrato B2 app: ${text}`);
  }

  for (const text of [
    '@media(max-width:680px)',
    '.catalog-toolbar-v2',
    'position:sticky',
    '.catalog-mobile-card',
    'min-height:44px'
  ]) {
    assert.ok(css.includes(text), `Falta contrato B2 CSS: ${text}`);
  }

  assert.ok(index.includes('v8-9-phase-b.css'));
  assert.ok(sw.includes('v8-9-phase-b.css'));
  assert.ok(sw.includes('barcodeAssociationUi.js'));
  assert.ok(sw.includes('barcodeModel.js'));
});
