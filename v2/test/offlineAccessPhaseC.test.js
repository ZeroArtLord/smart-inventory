import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  OFFLINE_ACCESS_MAX_AGE_MS,
  saveOfflineAccessSnapshot,
  readOfflineAccessSnapshot,
  clearOfflineAccessSnapshot,
  setOfflineLogoutLock,
  getOfflineLogoutLock,
  clearOfflineLogoutLock
} = await import('../src/auth/offlineAccess.js');

test('Fase C guarda autorización offline ligada a usuario y permisos', async () => {
  const now = Date.parse('2026-09-22T20:00:00.000Z');

  await saveOfflineAccessSnapshot({
    user: {
      id: 'user-1',
      externalAuthId: 'firebase-1',
      email: 'user@example.com'
    },
    workspaces: [{
      id: 'ws-1',
      roleCode: 'WAREHOUSE',
      permissions: ['count.write', 'supply.write']
    }]
  }, { now });

  const snapshot = await readOfflineAccessSnapshot({
    uid: 'firebase-1',
    workspaceId: 'ws-1',
    now: now + 1000
  });

  assert.equal(snapshot.user.externalAuthId, 'firebase-1');
  assert.equal(snapshot.selectedWorkspace.id, 'ws-1');
  assert.deepEqual(
    snapshot.selectedWorkspace.permissions,
    ['count.write', 'supply.write']
  );
  assert.equal(snapshot.offline, true);
  assert.equal(snapshot.expired, false);
});

test('Fase C rechaza snapshot de otra cuenta', async () => {
  const now = Date.parse('2026-09-22T20:00:00.000Z');

  await assert.rejects(
    () => readOfflineAccessSnapshot({
      uid: 'firebase-OTRO',
      workspaceId: 'ws-1',
      now
    }),
    error => error?.code === 'OFFLINE_AUTH_USER_MISMATCH'
  );
});

test('Fase C expira autorización offline después de la ventana segura', async () => {
  const verifiedAt = Date.parse('2026-09-22T20:00:00.000Z');

  await assert.rejects(
    () => readOfflineAccessSnapshot({
      workspaceId: 'ws-1',
      now: verifiedAt + OFFLINE_ACCESS_MAX_AGE_MS + 1
    }),
    error => error?.code === 'OFFLINE_AUTH_EXPIRED'
  );
});

test('Fase C logout local bloquea reapertura offline hasta revalidar', async () => {
  await setOfflineLogoutLock({
    uid: 'firebase-1',
    at: '2026-09-22T20:10:00.000Z'
  });

  assert.equal(
    (await getOfflineLogoutLock())?.uid,
    'firebase-1'
  );

  await clearOfflineLogoutLock();
  assert.equal(await getOfflineLogoutLock(), null);

  await clearOfflineAccessSnapshot();
  await assert.rejects(
    () => readOfflineAccessSnapshot({
      workspaceId: 'ws-1'
    }),
    error => error?.code === 'OFFLINE_AUTH_CACHE_MISSING'
  );
});
