import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const indexHtml = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
const uiPath = new URL('../src/ui/godOperationalOversightUi.js', import.meta.url);
const guardPath = new URL('../src/ui/operationalDomRenderGuard.js', import.meta.url);
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

test('V8.3 abre un documento ajeno GOD mediante un puente explícito al flujo normal', async () => {
  const ui = await read(uiPath);

  assert.match(ui, /data-v82-open-document/);
  assert.match(ui, /forwardOpenToApp/);
  assert.match(ui, /data-action.*open-document|dataset\.action\s*=\s*['"]open-document['"]/s);
  assert.match(ui, /\.click\(\)/);
});

test('V8.3 muestra nombres humanos y conserva el id técnico solo como detalle', async () => {
  const ui = await read(uiPath);

  assert.match(ui, /operationalDocumentLabel/);
  assert.match(ui, /Surtido|Entrada/);
  assert.match(ui, /ID t[eé]cnico/i);
  assert.match(ui, /Usuario del equipo/);
  assert.doesNotMatch(ui, /<strong>\$\{escapeHtml\(document\.id\)\}<\/strong>/);
});

test('V8.3.1 evita que el MutationObserver reemplace botones cuando el DOM ya está actualizado', async () => {
  const ui = await read(uiPath);
  const guard = await read(guardPath);

  assert.match(ui, /buildOperationalDomRenderKey/);
  assert.match(ui, /shouldRefreshOperationalDom/);
  assert.match(ui, /dataset\.v83RenderKey/);
  assert.match(ui, /if \(!refreshDom\)/);
  assert.match(guard, /shouldRefreshOperationalDom/);
  assert.match(guard, /draftKey/);
  assert.match(guard, /historyKey/);
});

test('PWA V8.3.1 usa shell 52 y precachea los assets de supervisión', () => {
  assert.match(sw, /smart-inventory-v2-shell-52/);
  assert.match(sw, /v8-god-oversight\.css/);
  assert.match(sw, /godOperationalOversightUi\.js/);
  assert.match(sw, /operationalDomRenderGuard\.js/);
});
