import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  }
};

const {
  buildProcurementWorkspaceDraft,
  saveProcurementWorkspaceDraft,
  loadProcurementWorkspaceDraft,
  clearProcurementWorkspaceDraft
} = await import('../src/replenishment/procurementWorkspaceDraft.js');

test('borrador Comprar/Pedir persiste decisiones humanas y extras', async () => {
  const drafts = new Map([
    ['auto', {
      productId: 'auto',
      selected: false,
      manual: false,
      dirty: false,
      displayQuantity: 10,
      displayUnit: 'UND',
      displayConversion: 1,
      method: 'PURCHASE',
      note: ''
    }],
    ['selected', {
      productId: 'selected',
      selected: true,
      manual: false,
      dirty: true,
      displayQuantity: 3,
      displayUnit: 'CAJA',
      displayConversion: 24,
      method: 'ORDER',
      note: 'pedido semanal'
    }]
  ]);

  const snapshot = buildProcurementWorkspaceDraft({
    workspaceId: 'ws-1',
    userId: 'user-1',
    drafts,
    pendingExtras: [{
      id: 'extra-1',
      description: 'Teipe negro',
      displayQuantity: 2,
      requestedQuantity: 2,
      unit: 'UND',
      method: 'PURCHASE',
      notes: 'mantenimiento',
      categoryName: 'EXTRAS'
    }]
  });

  assert.equal(snapshot.drafts.length, 1);
  assert.equal(snapshot.drafts[0].productId, 'selected');
  assert.equal(snapshot.drafts[0].displayQuantity, 3);
  assert.equal(snapshot.pendingExtras.length, 1);

  await saveProcurementWorkspaceDraft({
    workspaceId: 'ws-1',
    userId: 'user-1',
    drafts,
    pendingExtras: snapshot.pendingExtras
  });

  const restored = await loadProcurementWorkspaceDraft({
    workspaceId: 'ws-1',
    userId: 'user-1'
  });

  assert.equal(restored.drafts.length, 1);
  assert.equal(restored.drafts[0].selected, true);
  assert.equal(restored.drafts[0].method, 'ORDER');
  assert.equal(restored.pendingExtras[0].description, 'Teipe negro');
});

test('borradores quedan aislados por almacén y usuario', async () => {
  await saveProcurementWorkspaceDraft({
    workspaceId: 'ws-a',
    userId: 'user-a',
    drafts: [{
      productId: 'p1',
      selected: true,
      displayQuantity: 1,
      displayUnit: 'UND',
      displayConversion: 1,
      method: 'PURCHASE'
    }]
  });

  assert.ok(await loadProcurementWorkspaceDraft({
    workspaceId: 'ws-a',
    userId: 'user-a'
  }));

  assert.equal(await loadProcurementWorkspaceDraft({
    workspaceId: 'ws-a',
    userId: 'user-b'
  }), null);
});

test('confirmar lista deja tombstone y no resucita borrador antiguo', async () => {
  await saveProcurementWorkspaceDraft({
    workspaceId: 'ws-clear',
    userId: 'user-clear',
    drafts: [{
      productId: 'p1',
      selected: true,
      displayQuantity: 1,
      displayUnit: 'UND',
      displayConversion: 1,
      method: 'PURCHASE'
    }]
  });

  await clearProcurementWorkspaceDraft({
    workspaceId: 'ws-clear',
    userId: 'user-clear'
  });

  assert.equal(await loadProcurementWorkspaceDraft({
    workspaceId: 'ws-clear',
    userId: 'user-clear'
  }), null);
});
