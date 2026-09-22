import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const {
  normalizeAreaShortcutKey,
  findAreaByShortcut
} = await import('../src/areas/areaService.js');

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('A3 normaliza atajos de área a una sola letra o número', () => {
  assert.equal(normalizeAreaShortcutKey('c'), 'C');
  assert.equal(normalizeAreaShortcutKey(' 7 '), '7');
  assert.equal(normalizeAreaShortcutKey(''), null);
  assert.equal(normalizeAreaShortcutKey(null), null);

  assert.throws(
    () => normalizeAreaShortcutKey('Ctrl+C'),
    /letra|número|atajo/i
  );
  assert.throws(
    () => normalizeAreaShortcutKey('AB'),
    /letra|número|atajo/i
  );
});

test('A3 resuelve solo áreas activas por su atajo', () => {
  const areas = [
    { id: 'kitchen', name: 'Cocina', active: true, shortcutKey: 'C' },
    { id: 'bar', name: 'Barra', active: false, shortcutKey: 'B' }
  ];

  assert.equal(findAreaByShortcut(areas, 'c')?.id, 'kitchen');
  assert.equal(findAreaByShortcut(areas, 'b'), null);
  assert.equal(findAreaByShortcut(areas, 'x'), null);
});

test('A3 configuración y reparto exponen el atajo Alt+ configurado', async () => {
  const [workspaceUi, supplyUi, route, migration] = await Promise.all([
    read('../src/ui/areaWorkspaceUi.js'),
    read('../src/ui/supplyAreaUi.js'),
    read('../server/src/routes/areas.js'),
    read('../server/migrations/017_area_shortcuts.sql')
  ]);

  for (const text of [
    'data-area-setting-shortcut',
    'shortcutKey',
    'Alt+'
  ]) {
    assert.ok(workspaceUi.includes(text), `Falta contrato A3 Configuración: ${text}`);
  }

  for (const text of [
    'event.altKey',
    'findAreaByShortcut',
    'shortcutKey',
    'setAllocations',
    'preventDefault'
  ]) {
    assert.ok(supplyUi.includes(text), `Falta contrato A3 Reparto: ${text}`);
  }

  assert.match(route, /shortcut_key/);
  assert.match(route, /shortcutKey/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS shortcut_key/);
  assert.match(migration, /UNIQUE INDEX/i);
  assert.match(migration, /\^\[A-Z0-9\]\$/);
});
