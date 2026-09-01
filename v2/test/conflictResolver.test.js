import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  STORES,
  put,
  get,
  getAll
} = await import('../src/storage/database.js');

const {
  acceptServerConflict,
  reapplyLocalConflict
} = await import('../src/sync/conflictResolver.js');

test('aceptar servidor elimina conflicto y conserva versión canónica', async () => {
  const entityId = 'prd-conflict-server';
  const conflictId = 'sync-conflict-server';

  await put(STORES.PRODUCTS, {
    id: entityId,
    name: 'Servidor',
    version: 3,
    updatedAt: '2026-09-01T12:00:00.000Z'
  });

  await put(STORES.SYNC_QUEUE, {
    id: conflictId,
    entityType: 'product',
    entityId,
    operation: 'UPDATE',
    payload: {
      id: entityId,
      name: 'Local viejo',
      version: 3
    },
    status: 'CONFLICT',
    conflict: {
      serverVersion: 3,
      clientVersion: 3,
      reason: 'STALE_WRITE'
    }
  });

  const result = await acceptServerConflict(conflictId);

  assert.equal(result.resolution, 'SERVER');
  assert.equal(result.entity.name, 'Servidor');
  assert.equal(await get(STORES.SYNC_QUEUE, conflictId), undefined);
});

test('reaplicar local rebasea sobre la versión del servidor', async () => {
  const entityId = 'prd-conflict-local';
  const conflictId = 'sync-conflict-local';

  await put(STORES.PRODUCTS, {
    id: entityId,
    name: 'Servidor nuevo',
    sku: 'SERVER-SKU',
    minStock: 10,
    version: 5,
    updatedAt: '2026-09-01T12:00:00.000Z'
  });

  await put(STORES.SYNC_QUEUE, {
    id: conflictId,
    entityType: 'product',
    entityId,
    operation: 'UPDATE',
    payload: {
      id: entityId,
      name: 'Mi cambio',
      sku: 'LOCAL-SKU',
      minStock: 12,
      version: 5
    },
    status: 'CONFLICT',
    conflict: {
      serverVersion: 5,
      clientVersion: 5,
      reason: 'STALE_WRITE'
    }
  });

  const result = await reapplyLocalConflict(conflictId);

  assert.equal(result.resolution, 'LOCAL_REAPPLIED');
  assert.equal(result.entity.name, 'Mi cambio');
  assert.equal(result.entity.version, 6);

  const saved = await get(STORES.PRODUCTS, entityId);
  assert.equal(saved.version, 6);
  assert.equal(saved.sku, 'LOCAL-SKU');

  const queue = await getAll(STORES.SYNC_QUEUE);
  assert.equal(
    queue.some(item => item.id === conflictId),
    false
  );

  const rebasedEvent = queue.find(
    item => item.rebasedFromConflictId === conflictId
  );

  assert.equal(rebasedEvent.status, 'PENDING');
  assert.equal(rebasedEvent.payload.version, 6);
});

test('no resuelve si todavía no se descargó la versión canónica', async () => {
  const entityId = 'prd-conflict-not-pulled';
  const conflictId = 'sync-conflict-not-pulled';

  await put(STORES.PRODUCTS, {
    id: entityId,
    name: 'Estado local',
    version: 4
  });

  await put(STORES.SYNC_QUEUE, {
    id: conflictId,
    entityType: 'product',
    entityId,
    operation: 'UPDATE',
    payload: {
      id: entityId,
      name: 'Mi cambio',
      version: 4
    },
    status: 'CONFLICT',
    conflict: {
      serverVersion: 6,
      clientVersion: 4,
      reason: 'STALE_WRITE'
    }
  });

  await assert.rejects(
    acceptServerConflict(conflictId),
    /Sincroniza nuevamente/i
  );
});
