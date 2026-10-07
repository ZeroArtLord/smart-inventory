import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  STORES,
  put,
  get,
  getAll,
  clearStores
} = await import('../src/storage/database.js');

const {
  saveSyncConfig,
  getSyncConfig,
  saveSyncCursor,
  getSyncCursor
} = await import('../src/sync/syncSettings.js');

const {
  SYNC_STATUS
} = await import('../src/sync/localQueue.js');

const {
  WORKSPACE_OPERATIONAL_STORES,
  getWorkspaceCacheBinding,
  listWorkspaceSwitchBlockers,
  ensureWorkspaceCache,
  switchWorkspaceCacheAndConfig
} = await import('../src/sync/workspaceCache.js');

test('adopta cache existente cuando config y workspace coinciden', async () => {
  await resetLocalState();

  await saveSyncConfig({
    workspaceId: 'workspace-a',
    authMode: 'firebase'
  });

  await put(STORES.PRODUCTS, {
    id: 'prd-a',
    name: 'Producto A'
  });

  await saveSyncCursor(42);

  const result = await switchWorkspaceCacheAndConfig(
    'workspace-a',
    {
      authMode: 'firebase'
    }
  );

  assert.equal(result.action, 'adopted-existing');
  assert.equal(result.cleared, false);

  const product = await get(
    STORES.PRODUCTS,
    'prd-a'
  );

  assert.equal(product.name, 'Producto A');
  assert.equal(await getSyncCursor(), 42);

  const binding =
    await getWorkspaceCacheBinding();

  assert.equal(
    binding.workspaceId,
    'workspace-a'
  );
});

test('cambiar de workspace limpia cache operacional y reinicia cursor', async () => {
  await resetLocalState();

  await switchWorkspaceCacheAndConfig(
    'workspace-a',
    {
      authMode: 'firebase'
    }
  );

  await put(STORES.PRODUCTS, {
    id: 'prd-a2',
    name: 'Producto A2'
  });

  await put(STORES.SUPPLY_AREA_DRAFTS, {
    id: 'supply-a::product-a',
    parentCartId: 'supply-a',
    productId: 'product-a',
    productName: 'Producto A',
    quantity: 4,
    allocations: [{ areaId: 'area-a', areaName: 'Barra', quantity: 4 }],
    syncStatus: 'SYNCED',
    updatedAt: new Date().toISOString()
  });

  await put(STORES.SYNC_QUEUE, {
    id: 'sync-synced',
    entityType: 'product',
    entityId: 'prd-a2',
    operation: 'CREATE',
    payload: {},
    status: SYNC_STATUS.SYNCED,
    attempts: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await saveSyncCursor(88);

  const result = await switchWorkspaceCacheAndConfig(
    'workspace-b',
    {
      authMode: 'firebase'
    }
  );

  assert.equal(result.action, 'cache-replaced');
  assert.equal(result.cleared, true);
  assert.equal(await getSyncCursor(), 0);

  assert.equal(
    (await getAll(STORES.PRODUCTS)).length,
    0
  );

  assert.equal(
    (await getAll(STORES.SUPPLY_AREA_DRAFTS)).length,
    0
  );

  assert.equal(
    (await getAll(STORES.SYNC_QUEUE)).length,
    0
  );

  const config = await getSyncConfig();
  assert.equal(config.workspaceId, 'workspace-b');

  const binding =
    await getWorkspaceCacheBinding();

  assert.equal(
    binding.workspaceId,
    'workspace-b'
  );
});

test('bloquea cambio de workspace si existen operaciones sin sincronizar', async () => {
  await resetLocalState();

  await switchWorkspaceCacheAndConfig(
    'workspace-a',
    {
      authMode: 'firebase'
    }
  );

  await put(STORES.PRODUCTS, {
    id: 'prd-pending',
    name: 'Producto pendiente'
  });

  await put(STORES.SYNC_QUEUE, {
    id: 'sync-pending',
    entityType: 'product',
    entityId: 'prd-pending',
    operation: 'CREATE',
    payload: {
      id: 'prd-pending'
    },
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await assert.rejects(
    switchWorkspaceCacheAndConfig(
      'workspace-b',
      {
        authMode: 'firebase'
      }
    ),
    error =>
      error.code === 'WORKSPACE_SWITCH_BLOCKED' &&
      error.details.blockers === 1 &&
      error.details.statuses.PENDING === 1
  );

  const config = await getSyncConfig();
  assert.equal(config.workspaceId, 'workspace-a');

  const binding =
    await getWorkspaceCacheBinding();

  assert.equal(
    binding.workspaceId,
    'workspace-a'
  );

  assert.ok(
    await get(
      STORES.PRODUCTS,
      'prd-pending'
    )
  );
});

test('V8.5 bloquea cambio de workspace mientras un reparto de áreas no esté sincronizado', async () => {
  await resetLocalState();

  await switchWorkspaceCacheAndConfig('workspace-a', { authMode: 'firebase' });

  await put(STORES.SUPPLY_AREA_DRAFTS, {
    id: 'supply-a::product-pending',
    parentCartId: 'supply-a',
    productId: 'product-pending',
    productName: 'Producto pendiente',
    quantity: 4,
    allocations: [{ areaId: 'area-a', areaName: 'Barra', quantity: 4 }],
    syncStatus: 'PENDING',
    updatedAt: new Date().toISOString()
  });

  const blockers = await listWorkspaceSwitchBlockers();
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].entityType, 'supplyAreaDraft');
  assert.equal(blockers[0].status, 'PENDING');

  await assert.rejects(
    switchWorkspaceCacheAndConfig('workspace-b', { authMode: 'firebase' }),
    error =>
      error.code === 'WORKSPACE_SWITCH_BLOCKED' &&
      error.details.blockers === 1 &&
      error.details.statuses.PENDING === 1
  );

  assert.ok(await get(STORES.SUPPLY_AREA_DRAFTS, 'supply-a::product-pending'));
});

test('ensureWorkspaceCache falla cerrado si el cache pertenece a otro workspace', async () => {
  await resetLocalState();

  await switchWorkspaceCacheAndConfig(
    'workspace-a',
    {
      authMode: 'firebase'
    }
  );

  await assert.rejects(
    ensureWorkspaceCache('workspace-b'),
    error =>
      error.code ===
      'WORKSPACE_CACHE_MISMATCH' &&
      error.details.cachedWorkspaceId ===
        'workspace-a'
  );
});

test('V8.5 incluye datos por áreas entre los stores ligados al workspace', () => {
  assert.ok(WORKSPACE_OPERATIONAL_STORES.includes(STORES.AREAS));
  assert.ok(WORKSPACE_OPERATIONAL_STORES.includes(STORES.SUPPLY_AREA_DELIVERIES));
  assert.ok(WORKSPACE_OPERATIONAL_STORES.includes(STORES.SUPPLY_AREA_DRAFTS));
});

async function resetLocalState() {
  await clearStores([
    ...WORKSPACE_OPERATIONAL_STORES,
    STORES.AREAS,
    STORES.SUPPLY_AREA_DELIVERIES,
    STORES.SUPPLY_AREA_DRAFTS,
    STORES.SETTINGS
  ]);
}