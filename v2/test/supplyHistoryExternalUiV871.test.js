import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [ui, css] = await Promise.all([
  fs.readFile(new URL('../src/ui/godOperationalOversightUi.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../css/v8-god-oversight.css', import.meta.url), 'utf8')
]);

test('V8.7.1 limita el rediseño al historial jerárquico de Surtidos', () => {
  assert.match(ui, /renderSupplyHistory/);
  assert.match(ui, /data-v871-supply-history-parent/);
  assert.match(ui, /data-v871-supply-actions-trigger/);
  assert.match(ui, /data-v871-summary-toggle/);
  assert.match(ui, /data-v871-deliveries-toggle/);
  assert.match(ui, /Ver entregas \(\$\{group\.summary\.deliveryCount\}\)/);
});

test('V8.7.1 conserva acciones reales de cada entrega hija por documento', () => {
  assert.match(ui, /renderSupplyDeliveryRow/);
  assert.match(ui, /data-action="export-document"/);
  assert.match(ui, /data-action="correct-document"/);
  assert.match(ui, /data-v82-document-id="\$\{escapeHtml\(document\.id\)\}"/);
  assert.match(ui, /data-v871-delivery-actions-trigger/);
});

test('V8.7.1 usa un portal global fixed para que menus no queden bajo otras tarjetas', () => {
  assert.match(ui, /ensureSupplyHistoryActionPortal/);
  assert.match(ui, /document\.body\.appendChild\(portal\)/);
  assert.match(ui, /positionSupplyHistoryActionPortal/);
  assert.match(css, /\.v871-history-action-portal/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /z-index:\s*2147483/);
});

test('V8.7.1 mantiene padre compacto con metadatos y entregas colapsadas', () => {
  assert.match(ui, /v871-history-parent-meta/);
  assert.match(ui, /v871-history-chip/);
  assert.match(ui, /v871-history-deliveries/);
  assert.match(css, /\.v871-history-parent/);
  assert.match(css, /\.v871-history-deliveries/);
});
