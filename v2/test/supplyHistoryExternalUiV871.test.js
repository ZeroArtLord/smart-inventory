import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [ui, css] = await Promise.all([
  fs.readFile(new URL('../src/ui/godOperationalOversightUi.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../css/v8-god-oversight.css', import.meta.url), 'utf8')
]);

test('V8.7.1 limita el rediseño exclusivamente al Historial del equipo GOD de Surtidos', () => {
  assert.match(ui, /renderSupplyHistory/);
  assert.match(ui, /actor\.roleCode !== 'GOD'/);
  assert.match(ui, /renderSupplyHistoryV87\(container, groups, actor, memberIndex\)/);
  assert.match(ui, /data-v871-supply-history-parent/);
  assert.match(ui, /data-v871-supply-actions-trigger/);
  assert.match(ui, /data-v871-summary-toggle/);
  assert.match(ui, /data-v871-deliveries-toggle/);
  assert.match(ui, /Ver entregas \(\$\{group\.summary\.deliveryCount\}\)/);
});

test('V8.7.1 el padre visual GOD no se anuncia como documento fisico cerrado', () => {
  assert.match(
    ui,
    /class="v82-operational-row v871-history-parent \$\{godForeign \? 'v82-god-foreign' : ''\}"/
  );
  assert.match(
    ui,
    /trigger\.closest\('\[data-v871-supply-history-parent\], \.closed-document-row'\)/
  );
});

test('V8.7.1 replica el encabezado y metadatos visibles del boceto v5 corregido', () => {
  assert.match(ui, /Fecha operativa: \$\{escapeHtml\(operationalDate\)\} · Responsable:/);
  assert.match(ui, /v871-history-badge v871-history-badge-status/);
  assert.match(ui, /v871-history-badge v871-history-badge-green/);
  assert.match(ui, /entrega\$\{Number\(summary\.deliveryCount \|\| 0\) === 1 \? '' : 's'\}/);
  assert.match(ui, /entregado<\/span>/);
  assert.match(css, /grid-template-columns:\s*40px minmax\(0,\s*1fr\) auto/);
});

test('V8.7.1 muestra Resumen como cuatro cajas del boceto', () => {
  assert.match(ui, /v871-history-summary-box/);
  assert.match(ui, /<span>Planificado<\/span>/);
  assert.match(ui, /<span>Entregado<\/span>/);
  assert.match(ui, /<span>Pendiente<\/span>/);
  assert.match(ui, /<span>Estado<\/span>/);
  assert.doesNotMatch(ui, /<span>Cancelado<\/span>/);
  assert.match(css, /\.v871-history-summary-grid[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
});

test('V8.7.1 numera entregas dentro del padre y conserva cada ID fisico real', () => {
  assert.match(ui, /deliveryNumber:\s*index \+ 1/);
  assert.match(ui, /Entrega \$\{Number\(deliveryNumber\)\} ·/);
  assert.match(ui, /data-v82-document-id="\$\{escapeHtml\(document\.id\)\}"/);
  assert.match(ui, /data-action="export-document"/);
  assert.match(ui, /data-action="correct-document"/);
  assert.match(ui, /data-v871-delivery-actions-trigger/);
  assert.match(ui, />Acciones ▾<\/button>/);
  assert.match(css, /grid-template-columns:\s*28px minmax\(0,\s*1fr\) auto/);
});

test('V8.7.1 menu del padre conserva exactamente las acciones tecnicas del boceto', () => {
  assert.match(ui, /data-v871-parent-action="csv"[^>]*>CSV<\/button>/);
  assert.match(ui, /data-v871-parent-action="xlsx"[^>]*>Excel<\/button>/);
  assert.match(ui, /data-v871-parent-action="print"[^>]*>Imprimir \/ PDF<\/button>/);
  assert.match(ui, /data-v871-parent-action="thermal"[^>]*>80mm<\/button>/);
  assert.match(ui, /class="v871-history-menu-section">SAINT<\/div>/);
  assert.match(ui, /data-v871-parent-action="saint-xlsx"[^>]*>SAINT Excel<\/button>/);
  assert.match(ui, /data-v871-parent-action="saint-print"[^>]*>SAINT PDF<\/button>/);
  assert.match(ui, /data-v871-parent-action="correct"[^>]*>Corregir<\/button>/);
  assert.doesNotMatch(ui, /data-v871-portal-toggle="summary"/);
});

test('V8.7.1 acciones del padre nunca fingen que el acumulador es una entrega fisica', () => {
  assert.match(ui, /resolveParentSupplyAction/);
  assert.match(ui, /querySelectorAll\('\.v871-history-delivery\[data-v82-document-id\]'\)/);
  assert.match(ui, /data-v871-parent-delivery-choice/);
  assert.match(ui, /data-v871-parent-action-choice/);
  assert.match(ui, /findSupplyHistoryDeliveryAction/);
});

test('V8.7.1 usa un portal global vertical fixed que nunca queda bajo otras tarjetas', () => {
  assert.match(ui, /ensureSupplyHistoryActionPortal/);
  assert.match(ui, /document\.body\.appendChild\(portal\)/);
  assert.match(ui, /positionSupplyHistoryActionPortal/);
  assert.match(css, /\.v871-history-action-portal/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /z-index:\s*2147483646/);
  assert.match(css, /width:\s*220px/);
  assert.match(css, /\.v871-history-action-grid[\s\S]*grid-template-columns:\s*1fr/);
});

test('V8.7.1 cierra el portal al hacer scroll o resize como el boceto v5 aprobado', () => {
  assert.match(ui, /window\.addEventListener\('resize', closeSupplyHistoryActionPortal\)/);
  assert.match(ui, /window\.addEventListener\('scroll', closeSupplyHistoryActionPortal, true\)/);
  assert.doesNotMatch(ui, /const reposition = \(\) =>/);
});

test('V8.7.1 mantiene entregas colapsadas y layout responsive del boceto', () => {
  assert.match(ui, /v871-history-deliveries/);
  assert.match(css, /\.v871-history-parent/);
  assert.match(css, /\.v871-history-deliveries/);
  assert.match(css, /@media \(max-width:\s*1180px\)/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
});
