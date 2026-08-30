import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createDocument,
  listDraftDocuments
} = await import('../src/documents/documentService.js');

const {
  DOCUMENT_TYPES
} = await import('../src/documents/documentTypes.js');

test('reutiliza el conteo borrador existente del mismo usuario y ubicación', async () => {
  const first = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'almacenista-dev'
  });

  const second = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'almacenista-dev'
  });

  assert.equal(second.id, first.id);

  const drafts = await listDraftDocuments({
    ownerId: 'almacenista-dev',
    type: DOCUMENT_TYPES.COUNT
  });

  assert.equal(drafts.length, 1);
});

test('permite conteos independientes para usuarios distintos', async () => {
  const first = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'usuario-a'
  });

  const second = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'usuario-b'
  });

  assert.notEqual(second.id, first.id);
});
