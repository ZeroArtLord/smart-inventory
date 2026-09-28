import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false },
  configurable: true
});

globalThis.fetch = async () => {
  throw new Error(
    'Una operación local offline no debe intentar red'
  );
};

const {
  createDocument
} = await import('../src/documents/documentService.js');

const {
  DOCUMENT_TYPES
} = await import('../src/documents/documentTypes.js');

const {
  STORES,
  getAll
} = await import('../src/storage/database.js');

test('Fase C crea trabajo operativo offline y lo deja en cola para reconexión', async () => {
  const document = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'offline-user-phase-c'
  });

  assert.ok(document?.id);

  const queue = await getAll(
    STORES.SYNC_QUEUE
  );

  const queued = queue.find(item =>
    item.entityType === 'document' &&
    item.entityId === document.id &&
    item.operation === 'CREATE'
  );

  assert.ok(queued);
  assert.equal(queued.status, 'PENDING');
});
