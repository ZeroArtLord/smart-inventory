import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [app, sw, html] = await Promise.all([
  fs.readFile(new URL('../src/ui/app.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('hotfix PWA fuerza comprobación de actualización y expone shell', () => {
  assert.match(sw, /smart-inventory-v2-shell-64/);
  assert.match(app, /CLIENT_BUILD = 'shell-64'/);
  assert.match(app, /updateViaCache:\s*'none'/);
  assert.match(app, /registration\.update\(\)/);
  assert.match(app, /controllerchange/);
  assert.match(html, /app\.js\?v=64/);
});

test('dashboard muestra conectividad real y diagnóstico de sync', () => {
  assert.match(app, /Último sync/);
  assert.match(app, /data-action="retry-sync"/);
  assert.match(app, /state\.lastSyncError/);
  assert.match(app, /state\.authAccessOffline/);
  assert.match(app, /Autorización offline activa/);
  assert.match(app, /CLIENT_BUILD/);
});

test('botón reintentar ejecuta sync y vuelve a renderizar', () => {
  assert.match(app, /case 'retry-sync'/);
  assert.match(app, /retrySyncNow/);
  assert.match(app, /syncAndRefresh\(\{ renderAfter: true \}\)/);
});
