import test from 'node:test';
import assert from 'node:assert/strict';

const {
  setAuthTokenProvider,
  clearAuthTokenProvider,
  getAuthToken
} = await import('../src/auth/authProvider.js');

test('proveedor de autenticación devuelve token normalizado', async () => {
  setAuthTokenProvider(async () => '  signed-token-test  ');
  assert.equal(await getAuthToken({ required: true }), 'signed-token-test');
  clearAuthTokenProvider();
});

test('modo requerido falla si no existe proveedor', async () => {
  clearAuthTokenProvider();
  await assert.rejects(
    getAuthToken({ required: true }),
    /no configurado/i
  );
});

test('rechaza proveedores que no sean funciones', () => {
  assert.throws(
    () => setAuthTokenProvider('token-estatico'),
    /debe ser una función/i
  );
});


test('proveedor recibe forceRefresh cuando se solicita', async () => {
  let received = null;

  setAuthTokenProvider(async options => {
    received = options;
    return 'refreshed-token';
  });

  assert.equal(
    await getAuthToken({
      required: true,
      forceRefresh: true
    }),
    'refreshed-token'
  );

  assert.equal(
    received?.forceRefresh,
    true
  );

  clearAuthTokenProvider();
});
