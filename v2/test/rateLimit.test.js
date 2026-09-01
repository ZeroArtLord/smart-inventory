import test from 'node:test';
import assert from 'node:assert/strict';

const {
  rateLimit,
  clearRateLimitState
} = await import('../server/src/middleware/rateLimit.js');

function makeRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    headers
  };
}

test('rateLimit permite solicitudes dentro del límite y bloquea exceso', () => {
  clearRateLimitState();

  const middleware = rateLimit({
    windowMs: 60000,
    max: 2,
    namespace: 'test'
  });

  const req = { ip: '127.0.0.1' };

  for (let index = 0; index < 2; index += 1) {
    const res = makeRes();
    let nextCalled = false;

    middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  }

  const blocked = makeRes();
  let nextCalled = false;

  middleware(req, blocked, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.equal(blocked.headers['X-RateLimit-Remaining'], '0');
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
});

test('rateLimit separa namespaces', () => {
  clearRateLimitState();

  const first = rateLimit({
    windowMs: 60000,
    max: 1,
    namespace: 'one'
  });

  const second = rateLimit({
    windowMs: 60000,
    max: 1,
    namespace: 'two'
  });

  const req = { ip: '10.0.0.4' };

  const resOne = makeRes();
  let firstNext = false;
  first(req, resOne, () => {
    firstNext = true;
  });

  const resTwo = makeRes();
  let secondNext = false;
  second(req, resTwo, () => {
    secondNext = true;
  });

  assert.equal(firstNext, true);
  assert.equal(secondNext, true);
});
