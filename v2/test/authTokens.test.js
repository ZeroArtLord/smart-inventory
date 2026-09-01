import test from 'node:test';
import assert from 'node:assert/strict';

const {
  extractBearerToken
} = await import('../server/src/security/authTokens.js');

test('extrae bearer token sin importar mayúsculas', () => {
  assert.equal(
    extractBearerToken('Bearer abc.def.ghi'),
    'abc.def.ghi'
  );

  assert.equal(
    extractBearerToken('bearer token-123'),
    'token-123'
  );
});

test('rechaza authorization que no sea Bearer', () => {
  assert.equal(
    extractBearerToken('Basic abc123'),
    null
  );
});

test('rechaza bearer vacío', () => {
  assert.equal(
    extractBearerToken('Bearer   '),
    null
  );
});
