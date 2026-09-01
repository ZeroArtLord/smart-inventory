import test from 'node:test';
import assert from 'node:assert/strict';

const {
  initialEntityVersion,
  nextEntityVersion
} = await import('../src/core/versioning.js');

const {
  assertMutableEntityVersion,
  persistMutableEntityVersion
} = await import('../server/src/sync/versioning.js');

function clientWithVersion(version = null) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });

      if (/SELECT version/i.test(sql)) {
        return version === null
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ version }] };
      }

      if (/UPDATE .*SET version/i.test(sql.replace(/\s+/g, ' '))) {
        return {
          rowCount: 1,
          rows: [{ version: params[2] }]
        };
      }

      throw new Error('Consulta inesperada en mock');
    }
  };
}

test('versiones locales empiezan en 1 y aumentan de uno en uno', () => {
  assert.equal(initialEntityVersion(), 1);
  assert.equal(nextEntityVersion({ version: 1 }), 2);
  assert.equal(nextEntityVersion({ version: 8 }), 9);
  assert.equal(nextEntityVersion({}), 2);
});

test('CREATE nuevo acepta versión 1', async () => {
  const client = clientWithVersion(null);
  const event = {
    id: 'sync-create',
    entityType: 'product',
    entityId: 'prd-1',
    operation: 'CREATE',
    payload: { id: 'prd-1', version: 1 }
  };

  await assertMutableEntityVersion(
    client,
    'workspace-1',
    event
  );

  assert.equal(event.payload.version, 1);
});

test('UPDATE acepta exactamente serverVersion + 1', async () => {
  const client = clientWithVersion(3);
  const event = {
    id: 'sync-update',
    entityType: 'product',
    entityId: 'prd-1',
    operation: 'UPDATE',
    payload: { id: 'prd-1', version: 4 }
  };

  await assertMutableEntityVersion(
    client,
    'workspace-1',
    event
  );
});

test('UPDATE obsoleto genera conflicto 409 con detalle', async () => {
  const client = clientWithVersion(3);
  const event = {
    id: 'sync-stale',
    entityType: 'product',
    entityId: 'prd-1',
    operation: 'UPDATE',
    payload: { id: 'prd-1', version: 3 }
  };

  await assert.rejects(
    assertMutableEntityVersion(
      client,
      'workspace-1',
      event
    ),
    error => {
      assert.equal(error.code, 'SYNC_CONFLICT');
      assert.equal(error.statusCode, 409);
      assert.equal(error.details.eventId, 'sync-stale');
      assert.equal(error.details.serverVersion, 3);
      assert.equal(error.details.clientVersion, 3);
      assert.equal(error.details.reason, 'STALE_WRITE');
      return true;
    }
  );
});

test('desarrollo puede normalizar evento legado sin versión', async () => {
  const client = clientWithVersion(4);
  const event = {
    id: 'sync-legacy',
    entityType: 'document',
    entityId: 'doc-1',
    operation: 'UPDATE',
    payload: { id: 'doc-1' }
  };

  await assertMutableEntityVersion(
    client,
    'workspace-1',
    event,
    { allowLegacy: true }
  );

  assert.equal(event.payload.version, 5);
});

test('persistencia canónica escribe la versión aceptada', async () => {
  const client = clientWithVersion(1);
  const event = {
    id: 'sync-persist',
    entityType: 'product',
    entityId: 'prd-1',
    operation: 'UPDATE',
    payload: { id: 'prd-1', version: 2 }
  };

  const version = await persistMutableEntityVersion(
    client,
    'workspace-1',
    event
  );

  assert.equal(version, 2);
  assert.ok(
    client.calls.some(call =>
      /SET version/i.test(call.sql)
    )
  );
});
