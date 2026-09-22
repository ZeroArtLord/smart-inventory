import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { STORES, put } = await import('../src/storage/database.js');
const {
  canRefreshAreaDraftsRemotely
} = await import('../src/areas/supplyAreaDeliveryService.js');

test('Fase A no consulta borradores remotos mientras el CREATE del carrito padre siga local', async () => {
  const cartId = 'phase-a-local-parent';

  await put(STORES.SYNC_QUEUE, {
    id: 'sync-phase-a-parent',
    entityType: 'document',
    entityId: cartId,
    operation: 'CREATE',
    payload: { id: cartId, type: 'SUPPLY' },
    status: 'PENDING',
    attempts: 0,
    createdAt: '2026-09-22T15:00:00.000Z',
    updatedAt: '2026-09-22T15:00:00.000Z'
  });

  assert.equal(
    await canRefreshAreaDraftsRemotely(cartId),
    false
  );

  await put(STORES.SYNC_QUEUE, {
    id: 'sync-phase-a-parent',
    entityType: 'document',
    entityId: cartId,
    operation: 'CREATE',
    payload: { id: cartId, type: 'SUPPLY' },
    status: 'SYNCED',
    attempts: 1,
    createdAt: '2026-09-22T15:00:00.000Z',
    updatedAt: '2026-09-22T15:00:10.000Z'
  });

  assert.equal(
    await canRefreshAreaDraftsRemotely(cartId),
    true
  );
});

test('Fase A permite refresco remoto si el documento no nació en esta cola local', async () => {
  assert.equal(
    await canRefreshAreaDraftsRemotely('server-origin-parent'),
    true
  );
});
