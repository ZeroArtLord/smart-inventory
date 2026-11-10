import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMonitorToNormal } from '../src/replenishment/monitorToNormalMirror.js';
import { renderMonitorMirrorForNormal, printableMonitorMirror, currentMonitorWeek, attachMonitorSupplierPrint } from '../src/ui/monitorNormalMirrorUi.js';
import { buildMonitorNativeLists } from '../src/replenishment/monitorNativeTicketAdapter.js';
import { renderProcurementTickets } from '../src/ui/procurementWorkspaceV6Print.js';
import { buildThermalPrintPayload } from '../src/printing/thermalPrinterClient.js';
import { DEFAULT_THERMAL_CONFIG, buildProcurementJob } from '../server/src/printing/thermalEscPos.js';
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
  const html = printableMonitorMirror(project(),{businessName:'El Establo'});
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


test('Monitor and VIGÍA original render EXACT same print engine, four native V6 copies', () => {
  const snapshot=project();
  const nativeLists=buildMonitorNativeLists(snapshot,{ownerLabel:'Almacenista'});
  assert.equal(nativeLists.length,2);
  assert.equal(nativeLists[0].code,'COM-MON-261012');
  assert.equal(nativeLists[1].code,'PED-MON-261012');
  const reference=nativeLists.map(list=>renderProcurementTickets({
    list,businessName:'CLUB SOCIAL DEPORTIVO Y CAMPESTRE EL ESTABLO C.A'
  })).join('');
  const normalMarkup=printableMonitorMirror(snapshot,{
    ownerLabel:'Almacenista',
    businessName:'CLUB SOCIAL DEPORTIVO Y CAMPESTRE EL ESTABLO C.A'
  });
  assert.equal(normalMarkup,reference);
  assert.equal((normalMarkup.match(/VIGÍA · Inventory Intelligence/g)||[]).length,4);
  assert.equal((normalMarkup.match(/v6p-ticket is-buy/g)||[]).length,2);
  assert.equal((normalMarkup.match(/v6p-ticket is-order/g)||[]).length,2);
  assert.equal((normalMarkup.match(/v6p-ticket-row/g)||[]).length,6);
  assert.equal((normalMarkup.match(/Firma: __________________/g)||[]).length,4);
  assert.match(normalMarkup,/________ CJ/);
  assert.match(normalMarkup,/\(Comprar después\)/);
  assert.match(normalMarkup,/&lt;b&gt;&amp; peligro/);
  assert.match(normalMarkup,/EXTRAS/);
  assert.match(normalMarkup,/v6p-ticket-legend/);
  assert.match(normalMarkup,/v6p-ticket-notes/);
  const cards=renderMonitorMirrorForNormal(snapshot);
  assert.match(cards,/v6p-list-card/);
  assert.match(cards,/monitor-open-print/);
  assert.doesNotMatch(cards,/mp-ticket/);
});

test('Native ESC POS payload respects blank quantities and does not treat null as zero',()=>{
  const snapshot=project();
  const nativeLists=buildMonitorNativeLists(snapshot);
  const buy=buildThermalPrintPayload(nativeLists[0]);
  assert.equal(buy.kind,'PURCHASE');
  assert.equal(buy.items.length,2);
  const water=buy.items.find(x=>x.name==='Agua mineral');
  assert.equal(water.quantityText,'________ CJ');
  assert.equal(water.category,'BEBIDAS');
  assert.equal(water.note,'Comprar después');
  const gloves=buy.items.find(x=>x.name==='Guantes');
  assert.equal(gloves.extra,true);
  assert.equal(gloves.quantityText,'4 UND');
  const normalList={
    id:'original',kind:'PURCHASE',items:[
      {productName:'Otro',requestedQuantity:3,sourceSuggestion:{categoryNameAtDecision:'VIVERES'}}
    ]
  };
  assert.equal(buildThermalPrintPayload(normalList).items[0].quantityText,'3 UND');
});

test('Monitor pedido groups preview and thermal copies by assigned supplier, keeping unassigned items',()=>{
  const base=project({serverItems:[
    {...rows[1],itemKey:'product:p2',productId:'p2',quantity:2},
    {itemKey:'extra:e3',kind:'EXTRA',description:'Vasos',decision:'ORDER',quantity:4,unit:'BUL',notes:'Azules',version:1},
    {itemKey:'extra:e4',kind:'EXTRA',description:'Aceite',decision:'ORDER',quantity:3,unit:'CJ',version:1}
  ]});
  const supplierData={weekStart:'2026-10-12',round:1,
    items:[{itemKey:'product:p2',version:2},{itemKey:'extra:e3',version:1},{itemKey:'extra:e4',version:1}],
    assignments:[{itemKey:'extra:e4',supplierId:'s1'}],
    preferences:{p2:'s2'},
    suppliers:[{id:'s1',name:'SUMERVALCA',active:true},{id:'s2',name:'TOLEDO',active:true}]};
  const snapshot=attachMonitorSupplierPrint(base,supplierData);
  const list=buildMonitorNativeLists(snapshot).find(x=>x.kind==='ORDER');
  const html=renderProcurementTickets({list,businessName:'El Establo'});
  assert.equal((html.match(/PROVEEDOR: SUMERVALCA/g)||[]).length,2);
  assert.equal((html.match(/PROVEEDOR: TOLEDO/g)||[]).length,2);
  assert.equal((html.match(/SIN PROVEEDOR ASIGNADO/g)||[]).length,2);
  const payload=buildThermalPrintPayload(list);
  assert.equal(payload.items.find(x=>x.name==='Aceite').category,'PROVEEDOR: SUMERVALCA');
  assert.equal(payload.items.find(x=>x.name==='Malta Polar').category,'PROVEEDOR: TOLEDO');
  assert.equal(payload.items.find(x=>x.name==='Vasos').category,'SIN PROVEEDOR ASIGNADO');
  const job=buildProcurementJob(DEFAULT_THERMAL_CONFIG,payload);
  const receipt=job.buffer.toString('latin1');
  assert.equal(job.copies,2);
  assert.equal((receipt.match(/PROVEEDOR: SUMERVALCA/g)||[]).length,2);
  assert.equal((receipt.match(/SIN PROVEEDOR ASIGNADO/g)||[]).length,2);
  assert.equal((receipt.match(/ACEITE/g)||[]).length,2);
  assert.equal((receipt.match(/VASOS/g)||[]).length,2);
  assert.equal((receipt.match(/3 CJ/g)||[]).length,2);
  assert.equal((receipt.match(/4 BUL/g)||[]).length,2);
});

test('Explicit assignment wins over learned supplier when preparing the printed list',()=>{
  const snapshot=project({serverItems:[rows[1]]});
  const attached=attachMonitorSupplierPrint(snapshot,{weekStart:snapshot.weekStart,round:snapshot.round,
    items:[{itemKey:'product:p2',version:2}],suppliers:[{id:'s1',name:'Toledo'},{id:'s2',name:'Sumervalca'}],
    assignments:[{itemKey:'product:p2',supplierId:'s1'}],preferences:{p2:'s2'}});
  assert.equal(buildThermalPrintPayload(buildMonitorNativeLists(attached)[1]).items[0].category,'PROVEEDOR: Toledo');
});

test('Supplier print refuses a stale cycle or changed order rather than mislabel products',()=>{
  const snapshot=project();
  const data={weekStart:'2026-10-12',round:1,items:[{itemKey:'product:p2',version:2}],assignments:[],suppliers:[]};
  assert.throws(()=>attachMonitorSupplierPrint(snapshot,{...data,round:2}),/ciclo/);
  assert.throws(()=>attachMonitorSupplierPrint(snapshot,{...data,items:[]}),/cambió/);
});

test('Thermal ticket keeps a long supplier name readable instead of truncating it',()=>{
  const snapshot=project({serverItems:[rows[1]]});
  const supplierName='Distribuidora de alimentos y empaques para el establo central';
  const assigned=attachMonitorSupplierPrint(snapshot,{weekStart:snapshot.weekStart,round:snapshot.round,
    items:[{itemKey:'product:p2',version:2}],suppliers:[{id:'large',name:supplierName}],
    assignments:[{itemKey:'product:p2',supplierId:'large'}]});
  const list=buildMonitorNativeLists(assigned)[1];
  const job=buildProcurementJob(DEFAULT_THERMAL_CONFIG,buildThermalPrintPayload(list));
  const text=job.buffer.toString('latin1');
  assert.equal((text.match(/ESTABLO CENTRAL/g)||[]).length,2);
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
  assert.match(normal,/button\.dataset\.v6pAction/);
  assert.match(normal,/monitorNativePrintFlow/);
  assert.match(normal,/syncBeforeFetch:true/);
  assert.match(css,/body\.vigia-monitor-normal-print-active #v6MonitorPrintPage \*/);
  assert.match(css,/visibility:visible!important/);
  assert.match(css,/body\.vigia-monitor-print-active>\*:not\(#vigiaMonitorPilot\)/);
  assert.match(pilot,/renderProcurementTickets/);
  assert.match(pilot,/advancePendingReview/);
  assert.match(sw,/monitorNativeTicketAdapter\.js/);
});
