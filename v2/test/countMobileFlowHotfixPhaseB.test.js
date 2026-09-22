import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const ui = await fs.readFile(
  new URL('../src/ui/countWorkflowUi.js', import.meta.url),
  'utf8'
);

test('hotfix móvil mantiene identidad del producto visible y compacta Conteo', () => {
  for (const text of [
    'v5-count-expression-help',
    'focusCurrentCountInput',
    'preventScroll',
    'scrollIntoView',
    'enterkeyhint="next"',
    '.v5-count-product-card .math-pad',
    'grid-template-columns:repeat(6,minmax(0,1fr))',
    '.v89-count-buy-flag small{display:none}',
    '.v5-count-actions{grid-template-columns:1fr 1fr}'
  ]) {
    assert.ok(
      ui.includes(text),
      `Falta hotfix Conteo móvil: ${text}`
    );
  }
});

test('hotfix móvil recentra el producto después de guardar y continuar', () => {
  assert.match(
    ui,
    /requestAnimationFrame\(\(\) => \{[\s\S]*focusCurrentCountInput/
  );

  assert.match(
    ui,
    /setTimeout\([\s\S]*revealCurrentCountProduct[\s\S]*120/
  );
});
