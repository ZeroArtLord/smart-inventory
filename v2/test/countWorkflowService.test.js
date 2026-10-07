import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createDocument
} = await import('../src/documents/documentService.js');
const {
  DOCUMENT_TYPES
} = await import('../src/documents/documentTypes.js');
const {
  clearCountProductPending,
  getCountWorkflow,
  markCountProductPending,
  updateCountWorkflow
} = await import('../src/documents/countWorkflowService.js');
const {
  COUNT_WORKFLOW_MODES
} = await import('../src/documents/countWorkflow.js');
const {
  STORES,
  get,
  getAll
} = await import('../src/storage/database.js');

test('persiste categoría activa y pendientes dentro del borrador de conteo', async () => {
  const draft = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'v5-count-user'
  });

  const selected = await updateCountWorkflow(draft.id, {
    activeCategoryId: 'cat_viveres',
    mode: COUNT_WORKFLOW_MODES.CATEGORY
  });

  assert.equal(
    getCountWorkflow(selected).activeCategoryId,
    'cat_viveres'
  );

  const skipped = await markCountProductPending(
    draft.id,
    'product_harina'
  );

  assert.deepEqual(
    getCountWorkflow(skipped).pendingProductIds,
    ['product_harina']
  );

  const stored = await get(
    STORES.DOCUMENTS,
    draft.id
  );

  assert.equal(
    stored.metadata.countActiveCategoryId,
    'cat_viveres'
  );
  assert.deepEqual(
    stored.metadata.countPendingProductIds,
    ['product_harina']
  );

  const queue = await getAll(STORES.SYNC_QUEUE);
  const updates = queue.filter(item =>
    item.entityType === 'document' &&
    item.entityId === draft.id &&
    item.operation === 'UPDATE'
  );

  assert.ok(updates.length >= 2);
});

test('retira un pendiente al ser resuelto sin borrar otros', async () => {
  const draft = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'v5-pending-user'
  });

  await markCountProductPending(draft.id, 'a');
  await markCountProductPending(draft.id, 'b');
  const updated = await clearCountProductPending(
    draft.id,
    'a'
  );

  assert.deepEqual(
    getCountWorkflow(updated).pendingProductIds,
    ['b']
  );
});
