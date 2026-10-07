import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const {
  renderWorkspace,
  renderReviewModal
} = await import('../src/ui/procurementWorkspaceV6Render.js');

const {
  renderPrintModal
} = await import('../src/ui/procurementWorkspaceV6Print.js');

function product(id, name, saintCode, sku) {
  return {
    id,
    name,
    saintCode,
    sku,
    active: true
  };
}

function draft(productId, {
  selected = true,
  method = 'PURCHASE',
  quantity = 1,
  unit = 'UND',
  note = '',
  manual = false
} = {}) {
  return {
    productId,
    selected,
    method,
    displayQuantity: quantity,
    displayUnit: unit,
    displayConversion: unit === 'CAJA' ? 24 : 1,
    note,
    manual,
    detailsOpen: false,
    noteOpen: false,
    meta: 'SAINT 100 · UND',
    suggestedBaseText: '24 UND',
    suggestedHumanText: '1 caja x24',
    stockText: '0 UND',
    pendingText: '0',
    targetText: '24',
    minText: '12',
    maxText: '24',
    unitOptionsHtml: `<option value="${unit}" selected>${unit}</option>`
  };
}

function ticketItem({
  id,
  name,
  method,
  quantity,
  unit,
  category,
  notes = '',
  extra = false,
  status = 'DRAFT'
}) {
  return {
    id,
    productId: extra ? `__VIGIA_EXTRA__:${id}` : id,
    productName: name,
    method,
    status,
    requestedQuantity: unit === 'CAJA' ? quantity * 24 : quantity,
    pendingQuantity: unit === 'CAJA' ? quantity * 24 : quantity,
    receivedQuantity: 0,
    notes,
    sourceSuggestion: {
      kind: extra ? 'EXTRA' : 'PRODUCT',
      outsideCatalog: extra,
      categoryNameAtDecision: extra ? 'EXTRAS' : category,
      displayQuantity: quantity,
      displayUnit: unit,
      displayConversion: unit === 'CAJA' ? 24 : 1,
      unit: extra ? unit : undefined
    }
  };
}

test('workspace conserva el diseño simple aprobado y permite decisión humana', () => {
  const p1 = product('p1', 'MAYONESA KRAFT SACHETS', '104201', 'MAY-01');
  const p2 = product('p2', 'PEPSI MAX 350ML', '1014761', 'PEP-01');
  const productsById = new Map([[p1.id, p1], [p2.id, p2]]);
  const drafts = new Map([
    [p1.id, draft(p1.id, { quantity: 1, unit: 'CAJA', note: 'comprar habitual' })],
    [p2.id, draft(p2.id, { method: 'ORDER', quantity: 11, unit: 'CAJA' })]
  ]);
  const visibleRows = [
    { productId: p1.id, riskLevel: 'CRITICAL', consumptionConfidence: 'INSUFFICIENT' },
    { productId: p2.id, riskLevel: 'LOW', consumptionConfidence: 'INSUFFICIENT' }
  ];

  const html = renderWorkspace({
    activeTab: 'replenish',
    visibleRows,
    manualRows: [],
    drafts,
    productsById,
    pendingExtras: [],
    lists: [],
    selectedCount: 2,
    purchaseCount: 1,
    orderCount: 1,
    query: '',
    filter: 'ALL'
  });

  for (const text of [
    'Necesito reponer',
    'Mis listas',
    'Extras',
    'VIGÍA sugiere',
    'Yo quiero',
    'Voy a',
    'COMPRAR',
    'PEDIR',
    'Ver detalles',
    '📝 Nota',
    'Agregar producto manual',
    'Revisar lista con 2'
  ]) {
    assert.ok(html.includes(text), `Falta contrato visual: ${text}`);
  }

  assert.ok(html.includes('MAYONESA KRAFT SACHETS'));
  assert.ok(html.includes('PEPSI MAX 350ML'));
  assert.ok(html.includes('(comprar habitual)'));
  assert.match(html, /class="v6p-product is-selected"/);
  assert.match(html, /data-v6p-field="displayQuantity"/);
  assert.match(html, /data-v6p-field="displayUnit"/);
  assert.match(html, /data-v6p-field="method"/);
});

test('revisión final separa Comprar y Pedir e incluye observaciones y extras', () => {
  const buy = draft('p1', { quantity: 30, unit: 'KG', note: 'verdes para guasacaca' });
  const order = draft('p2', { method: 'ORDER', quantity: 11, unit: 'CAJA', note: 'distribuidor habitual' });

  const html = renderReviewModal({
    buyDrafts: [buy],
    orderDrafts: [order],
    buyExtras: [{
      description: 'TEIPE ELÉCTRICO NEGRO',
      displayQuantity: 3,
      unit: 'UND',
      notes: 'para mantenimiento'
    }],
    orderExtras: [],
    productName: id => id === 'p1' ? 'AGUACATE' : 'PEPSI MAX 350ML'
  });

  for (const text of [
    '🛒 Comprar',
    '📦 Pedir',
    'AGUACATE',
    'verdes para guasacaca',
    'PEPSI MAX 350ML',
    'distribuidor habitual',
    'TEIPE ELÉCTRICO NEGRO',
    'para mantenimiento',
    'EXTRA',
    'Crear listas separadas'
  ]) {
    assert.ok(html.includes(text), `Falta en revisión final: ${text}`);
  }
});

test('ticket de COMPRA imprime dos copias e incluye todos los activos, notas y extras', () => {
  const items = [
    ticketItem({ id: 'aguacate', name: 'AGUACATE', method: 'PURCHASE', quantity: 30, unit: 'KG', category: 'VERDURAS', notes: 'verdes para guasacaca' }),
    ticketItem({ id: 'lechuga', name: 'LECHUGA', method: 'PURCHASE', quantity: 35, unit: 'UND', category: 'VERDURAS' }),
    ticketItem({ id: 'extra1', name: 'TEIPE ELÉCTRICO NEGRO', method: 'PURCHASE', quantity: 3, unit: 'UND', category: 'EXTRAS', notes: 'para mantenimiento', extra: true }),
    ticketItem({ id: 'cancelled', name: 'NO DEBE SALIR', method: 'PURCHASE', quantity: 1, unit: 'UND', category: 'VARIOS', status: 'CANCELLED' })
  ];

  const html = renderPrintModal({
    list: {
      id: 'buy-list-1',
      code: 'COMPRA-0909-001',
      kind: 'PURCHASE',
      dateLabel: '09/09/2026',
      ownerLabel: 'Armando',
      items
    },
    businessName: 'ESTABLO'
  });

  assert.equal((html.match(/class="v6p-ticket is-buy"/g) || []).length, 2);
  assert.ok(html.includes('COPIA CHÓFER'));
  assert.ok(html.includes('COPIA DEPÓSITO'));
  assert.ok(html.includes('LISTA DE COMPRAS'));
  assert.ok(html.includes('AGUACATE'));
  assert.ok(html.includes('LECHUGA'));
  assert.ok(html.includes('TEIPE ELÉCTRICO NEGRO'));
  assert.ok(html.includes('verdes para guasacaca'));
  assert.ok(html.includes('para mantenimiento'));
  assert.ok(html.includes('EXTRAS'));
  assert.ok(html.includes('<small>EXTRA</small>'));
  assert.equal(html.includes('NO DEBE SALIR'), false);
});

test('ticket de PEDIDO imprime proveedor + depósito e incluye todas las líneas activas', () => {
  const items = [
    ticketItem({ id: 'pepsi', name: 'PEPSI MAX 350ML', method: 'ORDER', quantity: 11, unit: 'CAJA', category: 'BEBIDAS', notes: 'distribuidor habitual' }),
    ticketItem({ id: 'solera', name: 'CERVEZA SOLERA', method: 'ORDER', quantity: 3, unit: 'CAJA', category: 'BEBIDAS' })
  ];

  const html = renderPrintModal({
    list: {
      id: 'order-list-1',
      code: 'PEDIDO-0909-001',
      kind: 'ORDER',
      dateLabel: '09/09/2026',
      ownerLabel: 'Armando',
      items
    },
    businessName: 'ESTABLO'
  });

  assert.equal((html.match(/class="v6p-ticket is-order"/g) || []).length, 2);
  assert.ok(html.includes('COPIA PEDIDO / PROVEEDOR'));
  assert.ok(html.includes('COPIA DEPÓSITO'));
  assert.ok(html.includes('LISTA DE PEDIDOS'));
  assert.ok(html.includes('PEPSI MAX 350ML'));
  assert.ok(html.includes('CERVEZA SOLERA'));
  assert.ok(html.includes('distribuidor habitual'));
  assert.ok(html.includes('11 CJ'));
  assert.ok(html.includes('3 CJ'));
});

test('contrato CSS final protege escritorio, móvil y la impresión térmica real', async () => {
  const path = fileURLToPath(new URL('../css/v6-procurement-hardening.css', import.meta.url));
  const css = await readFile(path, 'utf8');

  assert.match(css, /left:\s*calc\(var\(--sidebar-width\)/);
  assert.match(css, /top:\s*72px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /padding-bottom:\s*calc\(170px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /#v6pPrintModal/);
  assert.match(css, /size:\s*80mm auto/);
  assert.match(css, /page-break-after:\s*always/);
  assert.equal(css.includes('body>*:not(.v6p-print-host)'), false);
});
