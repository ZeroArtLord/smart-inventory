import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  saveSyncConfig
} = await import('../src/sync/syncSettings.js');

const {
  setAuthTokenProvider,
  clearAuthTokenProvider
} = await import('../src/auth/authProvider.js');

const {
  apiRequest
} = await import('../src/api/apiClient.js');

test('apiRequest usa headers DEV cuando corresponde', async () => {
  await saveSyncConfig({
    authMode: 'dev',
    workspaceId: 'workspace-dev',
    serverUserId: 'user-dev'
  });

  let received = null;
  globalThis.fetch = async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ ok: true, value: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await apiRequest('/api/v1/session');

  assert.equal(result.value, 1);
  assert.equal(received.options.headers['x-workspace-id'], 'workspace-dev');
  assert.equal(received.options.headers['x-user-id'], 'user-dev');
  assert.equal(received.options.headers.authorization, undefined);
});

test('apiRequest usa Bearer token y no x-user-id en Firebase', async () => {
  await saveSyncConfig({
    authMode: 'firebase',
    workspaceId: 'workspace-prod',
    serverUserId: 'legacy-dev-user'
  });

  setAuthTokenProvider(async () => 'signed-token-test');

  let received = null;
  globalThis.fetch = async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  await apiRequest('/api/v1/session');

  assert.equal(received.options.headers['x-workspace-id'], 'workspace-prod');
  assert.equal(received.options.headers.authorization, 'Bearer signed-token-test');
  assert.equal(received.options.headers['x-user-id'], undefined);

  clearAuthTokenProvider();
});

test('apiRequest expone código y status de errores del servidor', async () => {
  await saveSyncConfig({
    authMode: 'dev',
    workspaceId: 'workspace-error',
    serverUserId: 'user-error'
  });

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    code: 'PERMISSION_DENIED',
    message: 'Sin permiso'
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' }
  });

  await assert.rejects(
    apiRequest('/api/v1/admin/members'),
    error =>
      error.code === 'PERMISSION_DENIED' &&
      error.status === 403 &&
      /Sin permiso/.test(error.message)
  );
});


test('apiRequest fuerza refresh una vez tras AUTH_TOKEN_INVALID', async () => {
  await saveSyncConfig({
    authMode: 'firebase',
    workspaceId: 'workspace-refresh',
    serverUserId: null
  });

  const tokenCalls = [];

  setAuthTokenProvider(async options => {
    tokenCalls.push(
      Boolean(options?.forceRefresh)
    );

    return options?.forceRefresh
      ? 'fresh-token'
      : 'stale-token';
  });

  let fetchCalls = 0;

  globalThis.fetch = async (_url, options) => {
    fetchCalls += 1;

    if (fetchCalls === 1) {
      assert.equal(
        options.headers.authorization,
        'Bearer stale-token'
      );

      return new Response(
        JSON.stringify({
          ok: false,
          code: 'AUTH_TOKEN_INVALID',
          message: 'Token vencido'
        }),
        {
          status: 401,
          headers: {
            'content-type':
              'application/json'
          }
        }
      );
    }

    assert.equal(
      options.headers.authorization,
      'Bearer fresh-token'
    );

    return new Response(
      JSON.stringify({
        ok: true,
        refreshed: true
      }),
      {
        status: 200,
        headers: {
          'content-type':
            'application/json'
        }
      }
    );
  };

  const result = await apiRequest(
    '/api/v1/session'
  );

  assert.equal(result.refreshed, true);
  assert.equal(fetchCalls, 2);
  assert.deepEqual(
    tokenCalls,
    [false, true]
  );

  clearAuthTokenProvider();
});
