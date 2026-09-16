import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function resolve(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function read(relativePath) {
  return readFile(resolve(relativePath), 'utf8');
}

test('Reportes V8 usa constructor personalizable y análisis Producto ↔ Área sin métricas monetarias', async () => {
  const ui = await read('../src/ui/reportBuilderV8Ui.js');
  const css = await read('../css/v8-reports.css');
  const index = await read('../index.html');

  assert.match(ui, /Constructor de reporte/);
  assert.match(ui, /Pregúntale a VIGÍA/);
  assert.match(ui, /Producto ↔ Área/);
  assert.match(ui, /Desviaciones contra el consumo normal/);
  assert.match(ui, /Sin sumas absurdas/);
  assert.match(ui, /localStorage/);
  assert.match(ui, /validSupplyKeys/);
  assert.match(ui, /reversedMovementId/);
  assert.equal(/unitCost|knownCost|costs\.view|precio unitario|gasto monetario/i.test(ui), false);
  assert.match(css, /\.v8-report-layout/);
  assert.match(css, /\.v8-product-area-card/);
  assert.match(index, /v8-reports\.css/);
  assert.match(index, /reportBuilderV8Ui\.js/);
});

test('Reportes V8 no inventa patrón normal sin historial suficiente', async () => {
  const ui = await read('../src/ui/reportBuilderV8Ui.js');
  assert.match(ui, /BASE_WINDOWS = 3/);
  assert.match(ui, /ANOMALY_LIMIT = 30/);
  assert.match(ui, /length<2/);
  assert.match(ui, /Sin base suficiente para declarar anomalías/);
  assert.match(ui, /No inventa un patrón normal/);
});

test('Reportes V8 evita sumar unidades incompatibles', async () => {
  const ui = await read('../src/ui/reportBuilderV8Ui.js');
  assert.match(ui, /units\.size>1/);
  assert.match(ui, /La selección mezcla unidades incompatibles/);
  assert.match(ui, /VIGÍA evita sumarlas/);
});

test('Reportes V8 excluye surtidos reversados de la atribución por áreas', async () => {
  const ui = await read('../src/ui/reportBuilderV8Ui.js');
  assert.match(ui, /m\.type === 'SUPPLY'/);
  assert.match(ui, /m\.voided !== true/);
  assert.match(ui, /!reversed\.has\(m\.id\)/);
  assert.match(ui, /validSupplyKeys\.has/);
  assert.match(ui, /Los surtidos anteriores a V7 no se inventan retroactivamente/);
});

test('Reportes V8.1 corrige presets invisibles, checkboxes gigantes y sidebar fuera del viewport', async () => {
  const css = await read('../css/v8-reports.css');

  assert.match(css, /\.v8-presets \.ghost-button\{/);
  assert.match(css, /background:#f8fbff;color:#27405f/);
  assert.match(css, /\.v8-block-checks input\[type="checkbox"\]\{/);
  assert.match(css, /width:18px;height:18px/);
  assert.match(css, /max-height:calc\(100vh - 104px\)/);
  assert.match(css, /overflow-y:auto/);
});

test('Reportes V8.1 no pinta actividad falsa en buckets de tendencia con valor cero', async () => {
  const css = await read('../css/v8-reports.css');

  assert.match(css, /\.v8-trend-bar\[title\^="0 "\] i\{height:0!important;min-height:0!important\}/);
  assert.match(css, /\.v8-trend-bar:not\(\[title\^="0 "\]\) i\{min-height:5px\}/);
});

test('Reportes V8.1 compacta únicamente la conciliación vacía y mejora el detalle', async () => {
  const css = await read('../css/v8-reports.css');

  assert.match(css, /#v5CountReconciliationPanel:has\(\.v5-recon-empty\)/);
  assert.match(css, /\.v5-recon-empty\{display:none\}/);
  assert.match(css, /\.v8-table-scroll\{max-height:500px;margin:0;border:1px solid #e7edf5/);
});

test('módulo Reportes V8 tiene sintaxis JavaScript válida', async () => {
  const file = resolve('../src/ui/reportBuilderV8Ui.js');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
