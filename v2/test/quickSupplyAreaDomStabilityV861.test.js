import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const quickUiSource = fs.readFileSync(
  path.resolve(__dirname, '../src/ui/quickSupplyAreaUi.js'),
  'utf8'
);
const swSource = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');

test('V8.6.1 no reescribe textContent si el estado visual del área no cambió', () => {
  assert.match(quickUiSource, /const nextStateText = area \? `✓ \$\{area\.name\}` : 'Sin área';/);
  assert.match(
    quickUiSource,
    /if \(state\.textContent !== nextStateText\) \{[\s\S]*state\.textContent = nextStateText;/
  );
});

test('V8.6.1 fuerza un shell PWA nuevo para desalojar el módulo V8.6 defectuoso', () => {
  assert.match(swSource, /smart-inventory-v2-shell-56/);
});
