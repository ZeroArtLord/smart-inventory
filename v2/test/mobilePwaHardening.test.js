import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const indexHtml = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(
  await fs.readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8')
);
const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('PWA móvil usa shell V8.2 y precachea los assets operativos vigentes', () => {
  assert.match(sw, /smart-inventory-v2-shell-50/);

  const requiredAssets = [
    './css/mobile-launch-hardening.css',
    './css/v6-procurement-hardening.css',
    './css/v6-thermal-printer.css',
    './css/v6-catalog-category-filter.css',
    './css/v7-supply-areas.css',
    './css/v8-reports.css',
    './css/v8-god-oversight.css',
    './src/ui/godOperationalOversightUi.js',
    './src/documents/documentAccessPolicy.js'
  ];

  for (const asset of requiredAssets) {
    assert.match(sw, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('index carga el hardening móvil y la supervisión GOD sin desplazar app.js', () => {
  const appScriptIndex = indexHtml.indexOf('./src/ui/app.js');
  const godScriptIndex = indexHtml.indexOf('./src/ui/godOperationalOversightUi.js');

  assert.match(indexHtml, /mobile-launch-hardening\.css/);
  assert.match(indexHtml, /v8-god-oversight\.css/);
  assert.ok(appScriptIndex >= 0, 'app.js debe existir');
  assert.ok(godScriptIndex > appScriptIndex, 'la supervisión GOD debe mejorar la UI después del núcleo app.js');
});

test('manifest mantiene metadatos instalables de VIGÍA', () => {
  assert.equal(manifest.name, 'VIGÍA - Inventory Intelligence');
  assert.equal(manifest.short_name, 'VIGÍA');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(Array.isArray(manifest.icons));
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
});
