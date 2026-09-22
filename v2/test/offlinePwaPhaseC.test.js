import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sw = await fs.readFile(
  new URL('../sw.js', import.meta.url),
  'utf8'
);

test('Fase C precachea módulos de autorización offline y shell 62', () => {
  assert.match(sw, /smart-inventory-v2-shell-62/);
  assert.match(sw, /\.\/src\/auth\/offlineAccess\.js/);
  assert.match(sw, /\.\/src\/auth\/authBootstrap\.js/);
  assert.match(sw, /\.\/src\/auth\/firebaseClient\.js/);
});

test('Fase C navegación offline cae al index cacheado', () => {
  assert.match(sw, /event\.request\.mode === 'navigate'/);
  assert.match(sw, /caches\.match\('\.\/index\.html'\)/);
});
