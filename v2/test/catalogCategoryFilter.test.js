import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function read(relativePath) {
  return readFile(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

test('catálogo permite ver productos por categoría sin reemplazar la búsqueda existente', async () => {
  const ui = await read('../src/ui/catalogCategoryFilterUi.js');

  for (const text of [
    'catalogCategoryFilter',
    'Todas las categorías',
    'Sin categoría',
    'catalogLocalSearch',
    'matchesSearch',
    'matchesCategory',
    'node.hidden = !(matchesSearch && matchesCategory)',
    'catalogRows',
    'catalogMobileList'
  ]) {
    assert.ok(ui.includes(text), `Falta contrato de filtro: ${text}`);
  }
});

test('filtro usa categorías reales y conserva selección durante la sesión', async () => {
  const ui = await read('../src/ui/catalogCategoryFilterUi.js');

  assert.match(ui, /listProducts\(\)/);
  assert.match(ui, /getAll\(STORES\.CATEGORIES\)/);
  assert.match(ui, /product\.categoryId/);
  assert.match(ui, /sessionStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(ui, /sessionStorage\.setItem\(STORAGE_KEY/);
  assert.match(ui, /\$\{option\.name\} \(\$\{option\.count\}\)/);
});

test('filtro de categoría es responsive y mantiene controles táctiles cómodos', async () => {
  const css = await read('../css/v6-catalog-category-filter.css');

  assert.match(css, /\.v6-catalog-category-filter/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /min-height:\s*46px/);
  assert.match(css, /font-size:\s*16px/);
});
