import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_DECISION as D,
  createWeeklyReview,
  decideReviewProduct,
  addReviewExtra,
  editReviewExtra,
  getReviewSummary,
  getReviewCategories,
  getReviewPending,
  buildReviewLists,
  reviewPrintQuantity
} from '../src/replenishment/monitorWeeklyReview.js';

const products = [
  { id: 'pepsi', name: 'Pepsi', categoryId: 'beb', unit: 'CJ', active: true, minStock: 0 },
  { id: 'agua', name: 'Agua', categoryId: 'beb', unit: 'UND', active: true },
  { id: 'arroz', name: 'Arroz', categoryId: 'ali', unit: 'KG', active: true, stock: 0 },
  { id: 'cinta', name: 'Producto inactivo', categoryId: 'ali', active: false }
];
const categories = [
  { id: 'beb', name: 'Bebidas', active: true },
  { id: 'ali', name: 'Alimentos', active: true },
  { id: 'otros', name: 'Otros', active: true }
];
const base = () => createWeeklyReview({
  workspaceId: 'establo-test',
  weekStart: '2026-10-12',
  createdAt: '2026-10-12T07:00:00Z'
});
const opt = (o = {}) => ({ actorId: 'staff-01', at: '2026-10-12T10:00:00Z', ...o });

test('sesión semanal estable por almacén y lunes', () => {
  const a = base(), b = base();
  assert.equal(a.id, b.id);
  assert.equal(a.schemaVersion, 1);
  assert.deepEqual(a.decisions, {});
});
test('rechaza semana no lunes e identificador sin valor', () => {
  assert.throws(() => createWeeklyReview({ workspaceId: 'a', weekStart: '2026-10-11' }), /lunes/);
  assert.throws(() => createWeeklyReview({ workspaceId: '', weekStart: '2026-10-12' }), /Almacén/);
});
test('revisión incluye productos sin sugerencias, aunque stock sea cero', () => {
  const s = base();
  assert.deepEqual(getReviewCategories(s, products, categories).find(x => x.categoryId === 'ali').products.map(p => p.id), ['arroz']);
  assert.equal(getReviewSummary(s, products).total, 3);
});
test('COMPRAR sin cantidad conserva null, nunca se convierte en cero', () => {
  const s = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY }));
  assert.equal(s.decisions.pepsi.quantity, null);
  assert.equal(getReviewSummary(s, products).quantitiesMissing, 1);
  assert.equal(buildReviewLists(s, products, categories).purchase[0].quantity, null);
});
test('PEDIR con cantidad positiva y unidad conserva valor', () => {
  const s = decideReviewProduct(base(), opt({ productId: 'agua', decision: D.ORDER, quantity: 12.5, unit: 'CAJA', notes: 'Distribuidor' }));
  assert.equal(buildReviewLists(s, products, categories).order[0].quantity, 12.5);
  assert.equal(buildReviewLists(s, products, categories).order[0].unit, 'CAJA');
});
test('cantidad vacía es null y cero o negativa son inválidos', () => {
  assert.equal(decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, quantity: '' })).decisions.pepsi.quantity, null);
  assert.throws(() => decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, quantity: 0 })), /mayor que cero/);
  assert.throws(() => decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, quantity: -1 })), /mayor que cero/);
  assert.throws(() => decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, quantity: 'abc' })), /mayor que cero/);
});
test('PENDIENTE se muestra en bandeja y no en listas ni revisión completada', () => {
  const s = decideReviewProduct(base(), opt({ productId: 'arroz', decision: D.PENDING }));
  assert.deepEqual(getReviewPending(s, products).map(p=>p.id), ['arroz']);
  assert.equal(getReviewSummary(s, products).pending, 1);
  assert.equal(getReviewSummary(s, products).reviewed, 0);
  assert.equal(buildReviewLists(s, products, categories).purchase.length, 0);
});
test('pendiente se recupera y se convierte a PEDIR', () => {
  const one = decideReviewProduct(base(), opt({ productId: 'arroz', decision: D.PENDING }));
  const two = decideReviewProduct(one, opt({ productId: 'arroz', decision: D.ORDER, expectedVersion: 1 }));
  assert.equal(getReviewPending(two, products).length, 0);
  assert.deepEqual(buildReviewLists(two, products, categories).order.map(x => x.name), ['Arroz']);
});
test('NO HACE FALTA cuenta como revisado pero nunca se imprime', () => {
  const s = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.NOT_NEEDED }));
  assert.equal(getReviewSummary(s, products).reviewed, 1);
  assert.equal(getReviewSummary(s, products).notNeeded, 1);
  assert.deepEqual(buildReviewLists(s, products, categories).purchase, []);
});
test('revisado no se duplica al cambiar de COMPRAR a PEDIR', () => {
  const first = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, quantity: 7 }));
  const second = decideReviewProduct(first, opt({ productId: 'pepsi', decision: D.ORDER, expectedVersion: 1 }));
  const lists = buildReviewLists(second, products, categories);
  assert.equal(lists.purchase.length, 0);
  assert.equal(lists.order.length, 1);
  assert.equal(lists.order[0].quantity, 7);
});
test('cantidad puede completarse después de la selección', () => {
  const first = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY }));
  const second = decideReviewProduct(first, opt({ productId: 'pepsi', decision: D.BUY, quantity: 5, expectedVersion: 1 }));
  assert.equal(getReviewSummary(second, products).quantitiesMissing, 0);
  assert.equal(buildReviewLists(second, products, categories).purchase[0].quantity, 5);
});
test('progreso por categoría diferencia pendiente de no revisado', () => {
  let s = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY }));
  s = decideReviewProduct(s, opt({ productId: 'agua', decision: D.PENDING }));
  const b = getReviewCategories(s, products, categories).find(x => x.categoryId === 'beb');
  assert.equal(b.total, 2);
  assert.equal(b.reviewed, 1);
  assert.equal(b.pending, 1);
  assert.equal(b.unreviewed, 0);
  assert.equal(b.percent, 50);
});
test('categorías vacías siguen visibles', () => {
  const g = getReviewCategories(base(), products, categories).find(x => x.categoryId === 'otros');
  assert.equal(g.total, 0);
});
test('extras manuales sin catálogo, cantidad ni unidad', () => {
  const s = addReviewExtra(base(), opt({ extraId: 'extra-1', description: 'Cinta métrica', method: D.BUY }));
  const item = buildReviewLists(s, products, categories).purchase[0];
  assert.equal(item.name, 'Cinta métrica');
  assert.equal(item.kind, 'EXTRA');
  assert.equal(item.category, 'EXTRAS');
  assert.equal(item.quantity, null);
  assert.equal(getReviewSummary(s, products).extras, 1);
});
test('extras de Pedir separados de Comprar', () => {
  const s = addReviewExtra(base(), opt({ extraId: 'e1', description: 'Guantes', method: D.ORDER }));
  assert.equal(buildReviewLists(s, products, categories).order.length, 1);
  assert.equal(buildReviewLists(s, products, categories).purchase.length, 0);
});
test('extras actualizables y borrado lógico para preservar trazabilidad', () => {
  const s = addReviewExtra(base(), opt({ extraId: 'e1', description: 'Guantes', method: D.BUY }));
  const t = editReviewExtra(s, opt({ extraId: 'e1', quantity: 2, method: D.ORDER, expectedVersion: 1 }));
  assert.equal(buildReviewLists(t, products, categories).order[0].quantity, 2);
  const u = editReviewExtra(t, opt({ extraId: 'e1', deleted: true, expectedVersion: 2 }));
  assert.equal(buildReviewLists(u, products, categories).order.length, 0);
  assert.equal(u.extras.e1.deleted, true);
});
test('duplicado extra por mismo ID se rechaza', () => {
  const s = addReviewExtra(base(), opt({ extraId: 'e1', description: 'Cinta', method: D.BUY }));
  assert.throws(() => addReviewExtra(s, opt({ extraId: 'e1', description: 'Cinta', method: D.BUY })), e => e.code === 'DUPLICATE_EXTRA');
});
test('versión esperada detecta dos usuarios editando el mismo producto', () => {
  const first = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, expectedVersion: 0 }));
  assert.throws(() => decideReviewProduct(first, opt({ productId: 'pepsi', decision: D.ORDER, expectedVersion: 0 })), e => e.code === 'REVIEW_CONFLICT');
});
test('cambios en productos distintos se combinan sin conflicto', () => {
  const first = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, expectedVersion: 0 }));
  const second = decideReviewProduct(first, opt({ productId: 'agua', decision: D.ORDER, expectedVersion: 0, actorId: 'staff-02' }));
  assert.equal(getReviewSummary(second, products).reviewed, 2);
});
test('replay con el mismo mutationId es idempotente', () => {
  const first = decideReviewProduct(base(), opt({ productId: 'pepsi', decision: D.BUY, mutationId: 'm-12', expectedVersion: 0 }));
  const again = decideReviewProduct(first, opt({ productId: 'pepsi', decision: D.BUY, mutationId: 'm-12', expectedVersion: 0 }));
  assert.strictEqual(again, first);
  assert.equal(again.decisions.pepsi.version, 1);
});
test('el input y los datos previos no se mutan', () => {
  const orig = base();
  const first = decideReviewProduct(orig, opt({ productId: 'pepsi', decision: D.BUY }));
  assert.deepEqual(orig.decisions, {});
  assert.deepEqual(orig.extras, {});
  assert.notStrictEqual(first, orig);
});
test('ticket imprime espacio para completar a mano sin cero ficticio', () => {
  assert.equal(reviewPrintQuantity({ quantity: null, unit: 'CJ' }), '________ CJ');
  assert.equal(reviewPrintQuantity({ quantity: 3, unit: 'KG' }), '3 KG');
});
test('no usa ni cambia stock al decidir o agregar extra', () => {
  const before = JSON.stringify(products);
  let s = decideReviewProduct(base(), opt({ productId: 'arroz', decision: D.BUY }));
  s = addReviewExtra(s, opt({ extraId: 'e', description: 'Cinta métrica', method: D.BUY }));
  assert.equal(JSON.stringify(products), before);
  assert.equal(s.decisions.arroz.quantity, null);
  assert.ok(!('movements' in s));
});
test('producto inactivo no aparece en el recorrido ni en listas', () => {
  const s = decideReviewProduct(base(), opt({ productId: 'cinta', decision: D.BUY }));
  assert.equal(getReviewSummary(s, products).total, 3);
  assert.equal(buildReviewLists(s, products, categories).purchase.length, 0);
});
