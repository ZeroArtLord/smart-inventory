import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('B1 conflicto remoto de barcode identifica el evento exacto y no condena todo el lote', async () => {
  const [route, engine] = await Promise.all([
    read('../server/src/routes/sync.js'),
    read('../src/sync/syncEngine.js')
  ]);

  assert.match(route, /eventId/);
  assert.match(route, /entityId/);

  assert.match(engine, /BARCODE_DUPLICATE/);
  assert.match(engine, /markConflict/);
  assert.match(engine, /Lote revertido por conflicto en otro evento/);
});
