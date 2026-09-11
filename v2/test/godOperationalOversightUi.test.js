import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const indexHtml = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
const appUiPath = new URL('../src/ui/app.js', import.meta.url);
const uiPath = new URL('../src/ui/godOperationalOversightUi.js', import.meta.url);
const cssPath = new URL('../css/v8-god-oversight.css', import.meta.url);

async function read(path) {
  return fs.readFile(path, 'utf8');
}

test('V8.2 carga el módulo y estilo de supervisión GOD', async () => {
  const ui = await read(uiPath);
  const css = await read(cssPath);

  assert.match(indexHtml, /v8-god-oversight\.css/);
  assert.match(indexHtml, /godOperationalOversightUi\.js/);
  assert.match(ui, /roleCode.*GOD|GOD.*roleCode/s);
  assert.match(ui, /Trabajo del equipo|Supervisi[oó]n GOD/i);
  assert.match(css, /v82-god/i);
});

test('la UI mantiene aislamiento WAREHOUSE y no convierte ADMIN en GOD', async () => {
  const ui = await read(uiPath);

  assert.match(ui, /WAREHOUSE|ownerId|operational/i);
  assert.match(ui, /filterOperationalDocumentsForActor/);
  assert.doesNotMatch(ui, /roleCode\s*===\s*['"]ADMIN['"].*bypass/s);
});

test('V8.3 abre un documento ajeno GOD mediante un puente explícito al editor real', async () => {
  const [ui, appUi] = await Promise.all([
    read(uiPath),
    read(appUiPath)
  ]);

  assert.match(ui, /data-v82-open-document/);
  assert.match(ui, /vigia:open-operational-document/);
  assert.match(appUi, /vigia:open-operational-document/);
  assert.match(appUi, /activeDocumentId/);
  assert.match(appUi, /activeDocumentType/);
});

test('V8.3 muestra nombres humanos y conserva el id técnico solo como detalle', async () => {
  const ui = await read(uiPath);

  assert.match(ui, /operationalDocumentLabel/);
  assert.match(ui, /Surtido|Entrada/);
  assert.match(ui, /ID t[eé]cnico/i);
  assert.match(ui, /Usuario del equipo/);
  assert.doesNotMatch(ui, /<strong>\$\{escapeHtml\(document\.id\)\}<\/strong>/);
});

test('PWA V8.3 usa shell 51 y precachea los assets de supervisión', () => {
  assert.match(sw, /smart-inventory-v2-shell-51/);
  assert.match(sw, /v8-god-oversight\.css/);
  assert.match(sw, /godOperationalOversightUi\.js/);
});
