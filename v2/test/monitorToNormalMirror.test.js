import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMonitorToNormal } from '../src/replenishment/monitorToNormalMirror.js';
import { renderMonitorMirrorForNormal, printableMonitorMirror, currentMonitorWeek } from '../src/ui/monitorNormalMirrorUi.js';
import { renderMonitorTicketSet } from '../src/ui/monitorTicketTemplate.js';
import { readFileSync } from 'node:fs';

const PRODUCTS = [
  { id: 'p1', name: 'Agua mineral', categoryId: 'c1', unitCode: 'UND' },
  { id: 'p2', name: 'Malta Polar', categoryId: 'c1', unitCode: 'UND' }
];
const CATEGORIES = [{ id: 'c1', name: 'BEBIDAS' }];
const rows = [
  { itemKey: 'product:p1', kind: 'PRODUCT', productId: 'p1', decision: 'BUY',
    quantity: null, notes: 'Comprar después', unit: 'CJ', version: 1 },
  { itemKey: 'product:p2', kind: 'PRODUCT', productId: 'p2', decision: 'ORDER',
    quantity: 2, notes: '<b>& peligro', unit: 'CJ', version: 2 },
  { itemKey: 'extra:e1', kind: 'EXTRA', description: 'Guantes', decision: 'BUY',
    quantity: 4, unit: 'UND', notes: 'Talla M', version: 1 },
  { itemKey: 'extra:e2', kind: 'EXTRA', description: 'Borrado', decision: 'ORDER',
    deleted: true, quantity: 2, unit: 'UND' },
  { itemKey: 'product:p3', kind: 'PRODUCT', productId: 'p3', decision: 'NOT_NEEDED',
    quantity: null, unit: 'UND' }
];
const project = overrides => projectMonitorToNormal({
  serverItems: rows, products: PRODUCTS, categories: CATEGORIES,
  weekStart: '2026-10-12', ...overrides
});

test('Monitor remains authoritative; preserves blank quantity, notes, unit, extras and week', () => {
  const result = project();
  assert.equal(result.readOnly, true);
  assert.equal(result.weekStart, '2026-10-12');
  assert.equal(result.counts.reviewed, 3);
  assert.equal(result.counts.notNeeded, 1);
  assert.equal(result.counts.totalProducts, 2);
  assert.equal(result.lists.PURCHASE.length, 2);
  assert.equal(result.lists.ORDER.length, 1);
  assert.equal(result.lists.PURCHASE.find(x => x.productId === 'p1').quantity, null);
  assert.equal(result.lists.PURCHASE.find(x => x.productId === 'p1').unit, 'CJ');
  assert.equal(result.lists.ORDER[0].notes, '<b>& peligro');
  assert.equal(result.lists.PURCHASE.find(x => x.kind === 'EXTRA').description, 'Guantes');
  assert.equal(rows[0].quantity, null);
});

test('Only pending local queue overlays server; stale cached remote cannot erase fresh server', () => {
  const pending = { ...rows[0], decision: 'ORDER', quantity: 9, localOnly: true, localStatus: 'PENDING' };
  const localState = { items: [pending, { ...rows[1], decision: 'BUY', quantity: 999 }] };
  const result = project({localState});
  assert.equal(result.lists.PURCHASE.some(x => x.itemKey === 'product:p1'), false);
  assert.equal(result.lists.ORDER.find(x => x.itemKey === 'product:p1').quantity, 9);
  assert.equal(result.lists.ORDER.find(x => x.itemKey === 'product:p2').quantity, 2);
  assert.equal(result.counts.pendingLocal, 1);
});

test('Conflict is visibly marked; no implicit conflict resolution', () => {
  const conflict = { ...rows[0], quantity: 10, localOnly: true, localStatus: 'CONFLICT' };
  const projected = project({localState:{items:[conflict]}});
  assert.equal(projected.counts.conflicts, 1);
  assert.match(renderMonitorMirrorForNormal(projected), /conflicto/);
});

test('Never hide unknown product IDs or forge a conversion', () => {
  const result = project({serverItems:[{itemKey:'product:missing',kind:'PRODUCT',
    productId:'missing',decision:'BUY',quantity:3,unit:'CJ'}]});
  assert.equal(result.counts.unresolvedProducts, 1);
  assert.match(result.lists.PURCHASE[0].description, /missing/);
  assert.equal(result.lists.PURCHASE[0].quantity, 3);
  assert.equal(result.lists.PURCHASE[0].unit, 'CJ');
});

test('HTML escaping protects notes in normal list', () => {
  const html = renderMonitorMirrorForNormal(project());
  assert.match(html, /&lt;b&gt;&amp; peligro/);
  assert.doesNotMatch(html, /<b>& peligro/);
  assert.match(html, /________/);
  assert.match(html, /LISTA DE PEDIDOS/);
  assert.match(html, /COPIA CHÓFER/);
});

test('Reject corrupt quantities, never approximate or silently skip', () => {
  assert.throws(() => project({serverItems:[
    {itemKey:'product:p1',kind:'PRODUCT',productId:'p1',decision:'ORDER',quantity:0}
  ]}), /Cantidad Monitor inválida/);
});

test('Weekly dates follow local Monday, even at year change', () => {
  assert.equal(currentMonitorWeek(new Date(2026, 9, 13)), '2026-10-12');
  assert.equal(currentMonitorWeek(new Date(2027, 0, 1)), '2026-12-28');
});


test('Imprimir VIGÍA normal uses IDENTICAL HTML template as Monitor pilot', () => {
  const snapshot = project();
  const pilotMarkup = renderMonitorTicketSet({
    weekStart: snapshot.weekStart,
    items: [
      {name:'Agua mineral',category:'BEBIDAS',decision:'BUY',quantity:null,unit:'CJ',notes:'Comprar después'},
      {name:'Malta Polar',category:'BEBIDAS',decision:'ORDER',quantity:2,unit:'CJ',notes:'<b>& peligro'},
      {name:'Guantes',category:'EXTRAS',decision:'BUY',quantity:4,unit:'UND',notes:'Talla M'}
    ]
  });
  const normalMarkup = printableMonitorMirror(snapshot);
  assert.equal(normalMarkup, pilotMarkup);
  assert.equal((normalMarkup.match(/VIGÍA MONITOR/g)||[]).length,4);
  assert.equal((normalMarkup.match(/LISTA DE COMPRAS/g)||[]).length,2);
  assert.equal((normalMarkup.match(/LISTA DE PEDIDOS/g)||[]).length,2);
  assert.equal((normalMarkup.match(/Firma: ______________/g)||[]).length,4);
  assert.match(normalMarkup,/________ CJ/);
  assert.match(normalMarkup,/Nota: Comprar después/);
  assert.match(normalMarkup,/&lt;b&gt;&amp; peligro/);
  assert.match(normalMarkup,/EXTRAS/);
});

test('Printing refuses conflicts, queued changes even when NONE of them selected', () => {
  const pendingReview = project({localState:{
    items:[{itemKey:'product:p4',kind:'PRODUCT',decision:'NOT_NEEDED',localOnly:true,localStatus:'PENDING'}],
    pendingCount:1,conflictCount:0
  }});
  assert.equal(pendingReview.counts.pendingLocal,1);
  assert.throws(()=>printableMonitorMirror(pendingReview),/sin sincronizar/);
  const conflictReview = project({localState:{items:[], pendingCount:0,conflictCount:1}});
  assert.equal(conflictReview.counts.conflicts,1);
  assert.throws(()=>printableMonitorMirror(conflictReview),/conflicto/);
});

test('Printing refuses stale/unknown products and empty selections', () => {
  const unknown = project({serverItems:[{itemKey:'product:missing',kind:'PRODUCT',
    productId:'missing',decision:'ORDER',quantity:5,unit:'CJ'}]});
  assert.throws(()=>printableMonitorMirror(unknown),/catálogo/);
  assert.throws(()=>printableMonitorMirror(project({serverItems:[]})),/No hay productos/);
});

test('Ticket printing in BOTH views is safely isolated from old V6 global print CSS', () => {
  const css=readFileSync(new URL('../css/monitor-pilot.css',import.meta.url),'utf8');
  const normal=readFileSync(new URL('../src/ui/procurementWorkspaceV6Ui.js',import.meta.url),'utf8');
  const pilot=readFileSync(new URL('../src/ui/monitorReviewPilotUi.js',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(normal,/data\.v6pAction/);
  assert.match(normal,/print-monitor-mirror/);
  assert.match(normal,/syncBeforeFetch:true/);
  assert.match(css,/body\.vigia-monitor-normal-print-active #v6MonitorPrintPage \*/);
  assert.match(css,/visibility:visible!important/);
  assert.match(css,/body\.vigia-monitor-print-active>\*:not\(#vigiaMonitorPilot\)/);
  assert.match(pilot,/renderMonitorTicketSet/);
  assert.match(sw,/monitorTicketTemplate\.js/);
});
