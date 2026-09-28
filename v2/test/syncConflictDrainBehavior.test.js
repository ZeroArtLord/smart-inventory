import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true
});

globalThis.window = {
  location: {
    origin: 'http://localhost:5190'
  }
};

const {
  createProduct
} = await import(
  '../src/catalog/catalogService.js'
);

const {
  listPendingOperations,
  listSyncConflicts
} = await import(
  '../src/sync/localQueue.js'
);

const {
  syncNow
} = await import(
  '../src/sync/syncEngine.js'
);

test('un conflicto puntual no bloquea el evento siguiente del mismo lote', async () => {
  const first = await createProduct({
    name: 'CONFLICT FIRST',
    sku: 'SYNC-CONFLICT-FIRST'
  });

  const second = await createProduct({
    name: 'SHOULD STILL SYNC',
    sku: 'SYNC-CONFLICT-SECOND'
  });

  const before =
    await listPendingOperations();

  assert.equal(before.length, 2);

  const firstEvent =
    before.find(item =>
      item.entityId === first.id
    );

  const secondEvent =
    before.find(item =>
      item.entityId === second.id
    );

  assert.ok(firstEvent);
  assert.ok(secondEvent);

  let pushCalls = 0;
  let secondBatchIds = [];

  globalThis.fetch = async (
    url,
    options = {}
  ) => {
    const href = String(url);

    if (
      href.endsWith(
        '/api/v1/dev/bootstrap'
      )
    ) {
      return jsonResponse({
        ok: true,
        workspace: {
          id: 'workspace-conflict-drain'
        },
        user: {
          id: 'user-conflict-drain'
        }
      });
    }

    if (
      href.endsWith(
        '/api/v1/sync/push'
      )
    ) {
      pushCalls += 1;

      const body =
        JSON.parse(options.body);

      if (pushCalls === 1) {
        assert.equal(
          body.events.length,
          2
        );

        return jsonResponse({
          ok: false,
          code: 'SYNC_CONFLICT',
          message:
            'Conflicto deliberado de prueba',
          details: {
            eventId: firstEvent.id,
            entityType: 'product',
            entityId: first.id,
            serverVersion: 2,
            clientVersion: 1
          }
        }, 409);
      }

      secondBatchIds =
        body.events.map(
          item => item.id
        );

      return jsonResponse({
        ok: true,
        applied: body.events.map(
          (event, index) => ({
            id: event.id,
            duplicate: false,
            cursor: index + 1
          })
        ),
        cursor: body.events.length
      });
    }

    if (
      href.includes(
        '/api/v1/sync/pull'
      )
    ) {
      return jsonResponse({
        ok: true,
        cursor: 0,
        events: []
      });
    }

    throw new Error(
      `URL inesperada: ${href}`
    );
  };

  const result = await syncNow({
    localUserId:
      'conflict-drain-user',
    displayName:
      'Conflict Drain User'
  });

  assert.equal(result.ok, true);
  assert.equal(result.conflict, true);
  assert.equal(result.conflicts, 1);
  assert.equal(result.pushed, 1);
  assert.equal(pushCalls, 2);

  assert.deepEqual(
    secondBatchIds,
    [secondEvent.id]
  );

  const pendingAfter =
    await listPendingOperations();

  assert.equal(
    pendingAfter.length,
    0
  );

  const conflicts =
    await listSyncConflicts();

  assert.equal(
    conflicts.length,
    1
  );

  assert.equal(
    conflicts[0].id,
    firstEvent.id
  );

  assert.equal(
    conflicts[0].entityId,
    first.id
  );
});

function jsonResponse(
  data,
  status = 200
) {
  return {
    ok:
      status >= 200 &&
      status < 300,
    status,
    async json() {
      return data;
    }
  };
}
