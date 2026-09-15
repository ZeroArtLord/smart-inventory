import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNT_WORKFLOW_MODES,
  buildCountCategoryProgress,
  buildCountOverallProgress,
  clearProductPending,
  countPendingProducts,
  markProductPending,
  normalizeCountWorkflowMetadata,
  selectNextCountProduct
} from '../src/documents/countWorkflow.js';

const categories = [
  { id: 'cat_viveres', name: 'VIVERES', active: true },
  { id: 'cat_bebidas', name: 'BEBIDAS', active: true }
];

const products = [
  { id: 'arroz', name: 'ARROZ', categoryId: 'cat_viveres', active: true },
  { id: 'harina', name: 'HARINA', categoryId: 'cat_viveres', active: true },
  { id: 'aceite', name: 'ACEITE', categoryId: 'cat_viveres', active: true },
  { id: 'agua', name: 'AGUA', categoryId: 'cat_bebidas', active: true },
  { id: 'refresco', name: 'REFRESCO', categoryId: 'cat_bebidas', active: true },
  { id: 'viejo', name: 'INACTIVO', categoryId: 'cat_viveres', active: false }
];

test('agrupa progreso por categoría sin contar productos inactivos', () => {
  const rows = buildCountCategoryProgress({
    products,
    categories,
    lines: [
      { productId: 'arroz' },
      { productId: 'agua' }
    ],
    metadata: {
      countPendingProductIds: ['harina']
    }
  });

  const viveres = rows.find(row => row.categoryId === 'cat_viveres');
  const bebidas = rows.find(row => row.categoryId === 'cat_bebidas');

  assert.deepEqual(
    {
      total: viveres.total,
      counted: viveres.counted,
      pending: viveres.pending,
      remaining: viveres.remaining
    },
    { total: 3, counted: 1, pending: 1, remaining: 1 }
  );

  assert.deepEqual(
    {
      total: bebidas.total,
      counted: bebidas.counted,
      pending: bebidas.pending,
      remaining: bebidas.remaining
    },
    { total: 2, counted: 1, pending: 0, remaining: 1 }
  );
});

test('saltar un producto lo deja pendiente y no equivale a contado ni a cero', () => {
  const patch = markProductPending({}, 'harina');
  const workflow = normalizeCountWorkflowMetadata(patch);

  assert.deepEqual(workflow.pendingProductIds, ['harina']);

  const next = selectNextCountProduct({
    products,
    lines: [],
    metadata: patch,
    categoryId: 'cat_viveres'
  });

  assert.equal(next.id, 'arroz');

  const overall = buildCountOverallProgress({
    products,
    lines: [],
    metadata: patch
  });

  assert.equal(overall.counted, 0);
  assert.equal(overall.pending, 1);
  assert.equal(overall.remaining, 4);
});

test('puede cambiar de categoría y recuperar pendientes globalmente', () => {
  let metadata = markProductPending({}, 'harina');
  metadata = markProductPending(metadata, 'refresco');

  const bebida = selectNextCountProduct({
    products,
    lines: [{ productId: 'agua' }],
    metadata,
    categoryId: 'cat_bebidas'
  });

  assert.equal(bebida, null);

  const pending = countPendingProducts({
    products,
    lines: [{ productId: 'arroz' }],
    metadata
  });

  assert.deepEqual(
    pending.map(product => product.id),
    ['harina', 'refresco']
  );

  const nextPending = selectNextCountProduct({
    products,
    lines: [{ productId: 'arroz' }],
    metadata,
    pendingOnly: true
  });

  assert.equal(nextPending.id, 'harina');
});

test('al contar un pendiente puede retirarse sin perder los demás', () => {
  let metadata = markProductPending({}, 'harina');
  metadata = markProductPending(metadata, 'refresco');
  metadata = clearProductPending(metadata, 'harina');

  const workflow = normalizeCountWorkflowMetadata(metadata);
  assert.deepEqual(workflow.pendingProductIds, ['refresco']);
});

test('normaliza el modo PENDING y elimina ids repetidos', () => {
  const workflow = normalizeCountWorkflowMetadata({
    countWorkflowMode: COUNT_WORKFLOW_MODES.PENDING,
    countActiveCategoryId: 'cat_viveres',
    countPendingProductIds: ['harina', 'harina', '', null]
  });

  assert.equal(workflow.mode, COUNT_WORKFLOW_MODES.PENDING);
  assert.equal(workflow.activeCategoryId, 'cat_viveres');
  assert.deepEqual(workflow.pendingProductIds, ['harina']);
});
