// VIGÍA Monitor — revisión semanal sin inventario paralelo.
// Núcleo aislado. NO crea movimientos, entradas, descargos ni eventos de sincronización V2.
export const REVIEW_DECISION = Object.freeze({
  UNREVIEWED: 'UNREVIEWED',
  BUY: 'BUY',
  ORDER: 'ORDER',
  NOT_NEEDED: 'NOT_NEEDED',
  PENDING: 'PENDING'
});

const CHOICES = new Set(Object.values(REVIEW_DECISION));
const METHODS = new Set([REVIEW_DECISION.BUY, REVIEW_DECISION.ORDER]);
const UNCATEGORIZED = '__UNCATEGORIZED__';

export function createWeeklyReview({ workspaceId, weekStart, createdAt = new Date().toISOString() }) {
  const workspace = requiredText(workspaceId, 'Almacén');
  const week = requiredText(weekStart, 'Semana');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(Date.parse(week + 'T00:00:00Z'))) {
    throw new Error('Semana inválida: use YYYY-MM-DD (lunes local)');
  }
  if (new Date(week + 'T00:00:00Z').getUTCDay() !== 1) {
    throw new Error('La semana debe comenzar un lunes');
  }
  return {
    schemaVersion: 1,
    id: 'review:' + encodeURIComponent(workspace) + ':' + week,
    workspaceId: workspace,
    weekStart: week,
    createdAt,
    updatedAt: createdAt,
    decisions: {},
    extras: {}
  };
}

export function decideReviewProduct(review, {
  productId,
  decision,
  quantity,
  unit,
  notes,
  expectedVersion,
  mutationId,
  actorId,
  at = new Date().toISOString()
}) {
  assertReview(review);
  const id = requiredText(productId, 'Producto');
  if (!CHOICES.has(decision)) throw new Error('Decisión inválida');
  const old = review.decisions[id] || null;
  if (isReplay(old, mutationId)) return review;
  checkVersion(old, expectedVersion);

  const next = {
    productId: id,
    decision,
    quantity: quantity === undefined ? (old?.quantity ?? null) : optionalPositive(quantity),
    unit: unit === undefined ? (old?.unit ?? '') : optionalText(unit),
    notes: notes === undefined ? (old?.notes ?? '') : optionalText(notes),
    version: (old?.version || 0) + 1,
    updatedBy: requiredText(actorId, 'Usuario'),
    updatedAt: at,
    mutationId: mutationId ? requiredText(mutationId, 'Evento') : null
  };
  return { ...review, updatedAt: at, decisions: { ...review.decisions, [id]: next } };
}

export function addReviewExtra(review, {
  extraId,
  description,
  method,
  quantity = null,
  unit = '',
  notes = '',
  mutationId,
  actorId,
  at = new Date().toISOString()
}) {
  assertReview(review);
  const id = requiredText(extraId, 'ID extra');
  const old = review.extras[id] || null;
  if (isReplay(old, mutationId)) return review;
  if (old) throw codedError('Ya existe un extra con este identificador', 'DUPLICATE_EXTRA');
  if (!METHODS.has(method)) throw new Error('Tipo de extra inválido');
  const extra = {
    extraId: id,
    description: requiredText(description, 'Descripción'),
    method,
    quantity: optionalPositive(quantity),
    unit: optionalText(unit),
    notes: optionalText(notes),
    deleted: false,
    version: 1,
    updatedBy: requiredText(actorId, 'Usuario'),
    updatedAt: at,
    mutationId: mutationId ? requiredText(mutationId, 'Evento') : null
  };
  return { ...review, updatedAt: at, extras: { ...review.extras, [id]: extra } };
}

export function editReviewExtra(review, {
  extraId,
  description,
  method,
  quantity,
  unit,
  notes,
  deleted,
  mutationId,
  expectedVersion,
  actorId,
  at = new Date().toISOString()
}) {
  assertReview(review);
  const id = requiredText(extraId, 'ID extra');
  const old = review.extras[id];
  if (!old) throw new Error('Extra no encontrado');
  if (isReplay(old, mutationId)) return review;
  checkVersion(old, expectedVersion);
  const nextMethod = method === undefined ? old.method : method;
  if (!METHODS.has(nextMethod)) throw new Error('Tipo de extra inválido');

  const updated = {
    ...old,
    description: description === undefined ? old.description : requiredText(description, 'Descripción'),
    method: nextMethod,
    quantity: quantity === undefined ? old.quantity : optionalPositive(quantity),
    unit: unit === undefined ? old.unit : optionalText(unit),
    notes: notes === undefined ? old.notes : optionalText(notes),
    deleted: deleted === undefined ? old.deleted : Boolean(deleted),
    version: old.version + 1,
    updatedBy: requiredText(actorId, 'Usuario'),
    updatedAt: at,
    mutationId: mutationId ? requiredText(mutationId, 'Evento') : null
  };
  return { ...review, updatedAt: at, extras: { ...review.extras, [id]: updated } };
}

export function getReviewSummary(review, products = []) {
  assertReview(review);
  const result = { total: 0, reviewed: 0, pending: 0, unreviewed: 0, buying: 0, ordering: 0, notNeeded: 0, quantitiesMissing: 0, extras: 0 };
  for (const p of activeProducts(products)) {
    result.total++;
    const row = review.decisions[p.id];
    const choice = row?.decision ?? REVIEW_DECISION.UNREVIEWED;
    if (choice === REVIEW_DECISION.PENDING) result.pending++;
    else if (choice === REVIEW_DECISION.UNREVIEWED) result.unreviewed++;
    else {
      result.reviewed++;
      if (choice === REVIEW_DECISION.BUY) result.buying++;
      if (choice === REVIEW_DECISION.ORDER) result.ordering++;
      if (choice === REVIEW_DECISION.NOT_NEEDED) result.notNeeded++;
      if (METHODS.has(choice) && row?.quantity == null) result.quantitiesMissing++;
    }
  }
  result.extras = Object.values(review.extras).filter(x => !x.deleted).length;
  result.percent = result.total ? Math.round(100 * result.reviewed / result.total) : 0;
  return result;
}

export function getReviewCategories(review, products = [], categories = []) {
  assertReview(review);
  const groups = new Map();
  const activeCategories = (categories || []).filter(c => c && c.active !== false && c.id);
  for (const c of activeCategories) {
    groups.set(String(c.id), { categoryId: String(c.id), categoryName: c.name || 'Sin nombre', products: [], total: 0, reviewed: 0, pending: 0, unreviewed: 0 });
  }
  for (const p of activeProducts(products)) {
    const id = p.categoryId && groups.has(String(p.categoryId)) ? String(p.categoryId) : UNCATEGORIZED;
    if (!groups.has(id)) groups.set(id, { categoryId: id, categoryName: 'Sin categoría', products: [], total: 0, reviewed: 0, pending: 0, unreviewed: 0 });
    const row = groups.get(id);
    row.total++;
    row.products.push(p);
    const state = review.decisions[p.id]?.decision || REVIEW_DECISION.UNREVIEWED;
    if (state === REVIEW_DECISION.UNREVIEWED) row.unreviewed++;
    else if (state === REVIEW_DECISION.PENDING) row.pending++;
    else row.reviewed++;
  }
  return [...groups.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'es')).map(group => ({
    ...group,
    percent: group.total ? Math.round(100 * group.reviewed / group.total) : 0
  }));
}

export function getReviewPending(review, products = []) {
  assertReview(review);
  return activeProducts(products).filter(product => review.decisions[product.id]?.decision === REVIEW_DECISION.PENDING);
}

export function buildReviewLists(review, products = [], categories = []) {
  assertReview(review);
  const lookup = new Map(activeProducts(products).map(p => [p.id, p]));
  const catLookup = new Map((categories || []).map(c => [String(c.id), c.name]));
  const lists = { BUY: [], ORDER: [] };
  for (const [productId, row] of Object.entries(review.decisions)) {
    if (!METHODS.has(row.decision)) continue;
    const p = lookup.get(productId);
    if (!p) continue;
    lists[row.decision].push({
      id: 'product:' + productId,
      kind: 'PRODUCT',
      productId,
      name: p.name || productId,
      category: catLookup.get(String(p.categoryId)) || 'Sin categoría',
      unit: row.unit || p.unit || p.unitCode || '',
      quantity: row.quantity ?? null,
      notes: row.notes || ''
    });
  }
  for (const extra of Object.values(review.extras)) {
    if (extra.deleted || !METHODS.has(extra.method)) continue;
    lists[extra.method].push({
      id: 'extra:' + extra.extraId,
      kind: 'EXTRA',
      extraId: extra.extraId,
      name: extra.description,
      category: 'EXTRAS',
      unit: extra.unit,
      quantity: extra.quantity ?? null,
      notes: extra.notes || ''
    });
  }
  const sorter = (a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es');
  lists.BUY.sort(sorter);
  lists.ORDER.sort(sorter);
  return { purchase: lists.BUY, order: lists.ORDER };
}

export function reviewPrintQuantity(item) {
  const qty = item?.quantity;
  if (qty == null) return '________' + (item?.unit ? ' ' + item.unit : '');
  return String(qty) + (item?.unit ? ' ' + item.unit : '');
}

function assertReview(review) {
  if (!review || review.schemaVersion !== 1 || !review.workspaceId || !review.weekStart || !review.decisions || !review.extras) {
    throw new Error('Sesión de revisión inválida');
  }
}
function checkVersion(current, expectedVersion) {
  if (expectedVersion == null) return;
  if (!Number.isInteger(expectedVersion) || expectedVersion !== (current?.version || 0)) {
    throw codedError('Cambios simultáneos: vuelve a cargar antes de editar este producto', 'REVIEW_CONFLICT');
  }
}
function isReplay(current, mutationId) {
  return Boolean(current && mutationId && current.mutationId === mutationId);
}
function codedError(message, code) {
  const error = new Error(message); error.code = code; return error;
}
function requiredText(value, label) {
  const v = String(value ?? '').trim();
  if (!v) throw new Error(label + ' obligatorio');
  return v;
}
function optionalText(value) { return String(value ?? '').trim(); }
function optionalPositive(value) {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('La cantidad debe ser mayor que cero, o quedar en blanco');
  return n;
}
function activeProducts(products) {
  return (products || []).filter(p => p && p.active !== false && String(p.id || '').trim());
}
