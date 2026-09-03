import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true
});

globalThis.window = {
  location: { origin: 'http://localhost:5190' }
};

const {
  createProduct,
  listProducts
} = await import('../src/catalog/catalogService.js');

const {
  listPendingOperations
} = await import('../src/sync/localQueue.js');

const {
  getSyncCursor
} = await import('../src/sync/syncSettings.js');

const {
  syncNow
} = await import('../src/sync/syncEngine.js');

test('guarda local, hace push idempotente y aplica cambios remotos', async () => {
  const local = await createProduct({
    name: 'Aceite local',
    minStock: 20,
    maxStock: 40
  });

  const before = await listPendingOperations();
  assert.equal(before.length, 1);
  assert.equal(before[0].entityId, local.id);

  let pushedEvents = [];

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);

    if (href.endsWith('/api/v1/dev/bootstrap')) {
      return jsonResponse({
        ok: true,
        workspace: { id: 'workspace-test' },
        user: { id: 'user-test' }
      });
    }

    if (href.endsWith('/api/v1/sync/push')) {
      const body = JSON.parse(options.body);
      pushedEvents = body.events;

      return jsonResponse({
        ok: true,
        applied: body.events.map((event, index) => ({
          id: event.id,
          duplicate: false,
          cursor: index + 1
        })),
        cursor: body.events.length
      });
    }

    if (href.includes('/api/v1/sync/pull')) {
      return jsonResponse({
        ok: true,
        cursor: 10,
        events: [
          {
            cursor: 10,
            id: 'server-event-10',
            entityType: 'product',
            entityId: 'prd_remote',
            operation: 'CREATE',
            payload: {
              id: 'prd_remote',
              name: 'Harina remota',
              nameNormalized: 'harina remota',
              aliases: [],
              sku: '',
              barcode: '',
              minStock: 10,
              maxStock: 30,
              replenishmentMethod: 'BOTH',
              active: true,
              createdAt: '2026-08-30T12:00:00.000Z',
              updatedAt: '2026-08-30T12:00:00.000Z'
            }
          }
        ]
      });
    }

    throw new Error(`URL inesperada: ${href}`);
  };

  const result = await syncNow({
    localUserId: 'almacenista-dev',
    displayName: 'Almacenista'
  });

  assert.equal(result.ok, true);
  assert.equal(result.pushed, 1);
  assert.equal(result.pulled, 1);
  assert.equal(pushedEvents.length, 1);
  assert.equal(pushedEvents[0].entityId, local.id);

  const after = await listPendingOperations();
  assert.equal(after.length, 0);

  const products = await listProducts();
  assert.deepEqual(
    products.map(product => product.name).sort(),
    ['Aceite local', 'Harina remota']
  );

  assert.equal(await getSyncCursor(), 10);
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}


test('una llamada concurrente espera el ciclo activo en vez de devolver already-syncing', async () => {
  let releaseFirstPull;
  let markFirstPullStarted;
  const firstPullStarted = new Promise(resolve => {
    markFirstPullStarted = resolve;
  });
  const firstPullGate = new Promise(resolve => {
    releaseFirstPull = resolve;
  });
  let pullCalls = 0;

  globalThis.fetch = async url => {
    const href = String(url);

    if (href.includes('/api/v1/sync/pull')) {
      pullCalls += 1;

      if (pullCalls === 1) {
        markFirstPullStarted();
        await firstPullGate;
      }

      return jsonResponse({
        ok: true,
        cursor: 10,
        events: []
      });
    }

    throw new Error(`URL inesperada: ${href}`);
  };

  const first = syncNow({
    localUserId: 'almacenista-dev',
    displayName: 'Almacenista'
  });

  await firstPullStarted;

  let secondSettled = false;
  const second = syncNow({
    localUserId: 'almacenista-dev',
    displayName: 'Almacenista'
  }).finally(() => {
    secondSettled = true;
  });

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(secondSettled, false);

  releaseFirstPull();

  const [firstResult, secondResult] = await Promise.all([
    first,
    second
  ]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(pullCalls, 2);
});
