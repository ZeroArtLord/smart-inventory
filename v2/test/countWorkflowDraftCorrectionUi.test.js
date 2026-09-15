import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function resolve(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function read(relativePath) {
  return readFile(resolve(relativePath), 'utf8');
}

test('V5 count permite volver a productos contados y corregir el último', async () => {
  const source = await read('../src/ui/countWorkflowUi.js');

  assert.match(source, /Corregir último/);
  assert.match(source, /data-v5-count-action="edit-last"/);
  assert.match(source, /data-v5-count-action="cancel-edit"/);
  assert.match(source, /const jumpProducts = categoryProducts;/);
  assert.match(
    source,
    /categoryProducts\.find\(product => product\.id === forcedId\)/
  );
  assert.match(source, /CONTADO \$\{escapeHtml\(String\(countedLine\.countedStock\)\)\}/);
});

test('corregir una línea conserva la existencia esperada original', async () => {
  const [ui, service] = await Promise.all([
    read('../src/ui/countWorkflowUi.js'),
    read('../src/documents/documentService.js')
  ]);

  assert.match(ui, /existingLine\.expectedStock/);
  assert.match(ui, /expectedStock:\s*existingLine\.expectedStock/);
  assert.match(service, /return `line_\$\{document\.id\}_\$\{productId\}`;/);
  assert.match(service, /existing \? 'UPDATE' : 'CREATE'/);
});

test('V5 count restaura operadores matemáticos visibles', async () => {
  const source = await read('../src/ui/countWorkflowUi.js');

  assert.match(source, /renderCountMathPad\('v5CountValue'\)/);
  assert.match(source, /data-math-target=/);
  assert.match(source, /countMathButton\(targetId, '\+', '\+'\)/);
  assert.match(source, /countMathButton\(targetId, '-', '−'\)/);
  assert.match(source, /countMathButton\(targetId, '\*', '×'\)/);
  assert.match(source, /countMathButton\(targetId, '\/', '÷'\)/);
  assert.match(source, /countMathButton\(targetId, '\(', '\('\)/);
  assert.match(source, /countMathButton\(targetId, '\)', '\)'\)/);
});
