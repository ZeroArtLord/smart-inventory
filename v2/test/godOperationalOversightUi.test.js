import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const indexHtml = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
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

test('los controles inyectados reutilizan el flujo normal de documentos', async () => {
  const ui = await read(uiPath);

  assert.match(ui, /data-action=["']open-document["']/);
  assert.match(ui, /data-action=["']cancel-document["']/);
  assert.match(ui, /data-id=/);
});

test('PWA V8.2 usa shell 50 y precachea los assets de supervisión', () => {
  assert.match(sw, /smart-inventory-v2-shell-50/);
  assert.match(sw, /v8-god-oversight\.css/);
  assert.match(sw, /godOperationalOversightUi\.js/);
});
