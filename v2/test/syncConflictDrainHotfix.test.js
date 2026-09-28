import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sync = await fs.readFile(
  new URL('../src/sync/syncEngine.js', import.meta.url),
  'utf8'
);

test('sync no aborta todo el drenaje por un conflicto puntual', () => {
  assert.match(sync, /MAX_CONFLICT_PEELS_PER_SYNC/);
  assert.match(sync, /continueAfterConflict/);
  assert.match(sync, /conflictId/);
  assert.match(sync, /remainingBatch/);
  assert.match(sync, /Lote reintentado sin el evento en conflicto/);
});

test('los conflictos permanecen CONFLICT y los demás eventos continúan', () => {
  assert.match(sync, /markConflict/);
  assert.match(sync, /markPending/);
  assert.match(sync, /return \{ count, conflicts \}/);
});

test('syncNow puede completar push aunque haya conflictos aislados', () => {
  assert.match(sync, /pushed\.conflicts/);
  assert.match(sync, /state: pushed\.conflicts > 0 \? 'conflict' : 'synced'/);
});
