import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true
});

const {
  saveSyncConfig
} = await import('../src/sync/syncSettings.js');

const {
  setAuthTokenProvider,
  clearAuthTokenProvider
} = await import('../src/auth/authProvider.js');

const {
  bootstrapFirebaseAccess
} = await import('../src/auth/authBootstrap.js');

test('Firebase bootstrap guarda autorización y la reutiliza offline para el mismo UID', async () => {
  await saveSyncConfig({
    authMode: 'firebase',
    apiBaseUrl: '',
    workspaceId: null,
    serverUserId: null
  });

  setAuthTokenProvider(
    async () => 'firebase-token-test'
  );

  let calls = 0;

  globalThis.fetch = async (url, options = {}) => {
    calls += 1;

    assert.equal(
      String(url),
      '/api/v1/auth/bootstrap'
    );
    assert.equal(
      options.headers.authorization,
      'Bearer firebase-token-test'
    );

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          user: {
            id: 'server-user-1',
            externalAuthId: 'firebase-uid-1',
            email: 'user@example.com',
            displayName: 'Usuario'
          },
          workspaces: [{
            id: 'workspace-auth-1',
            name: 'Almacén Test',
            roleCode: 'WAREHOUSE',
            permissions: [
              'catalog.view',
              'count.write'
            ]
          }]
        };
      }
    };
  };

  const online = await bootstrapFirebaseAccess({
    uid: 'firebase-uid-1'
  });

  assert.equal(online.offline, false);
  assert.equal(
    online.selectedWorkspace.id,
    'workspace-auth-1'
  );
  assert.equal(calls, 1);

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true
  });

  globalThis.fetch = async () => {
    throw new Error(
      'No debe hacer fetch durante bootstrap offline'
    );
  };

  const offline = await bootstrapFirebaseAccess({
    uid: 'firebase-uid-1'
  });

  assert.equal(offline.offline, true);
  assert.equal(
    offline.selectedWorkspace.id,
    'workspace-auth-1'
  );
  assert.deepEqual(
    offline.selectedWorkspace.permissions,
    ['catalog.view', 'count.write']
  );

  clearAuthTokenProvider();

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true
  });
});

test('autorización offline no se comparte con otro UID', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true
  });

  await assert.rejects(
    bootstrapFirebaseAccess({
      uid: 'firebase-uid-distinto'
    }),
    error =>
      error.code === 'OFFLINE_AUTH_CACHE_MISSING' &&
      /otra cuenta/i.test(error.message)
  );

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true
  });
});
