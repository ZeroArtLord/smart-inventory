import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createDocument,
  listDraftDocuments,
  cancelDocument,
  canActorAccessOperationalDocument,
  filterOperationalDocumentsForActor
} = await import('../src/documents/documentService.js');

const {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS
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


test('cancelar un borrador lo conserva en auditoría pero deja de listarlo como pendiente', async () => {
  const draft = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'usuario-cancel'
  });

  await cancelDocument(draft.id, { userId: 'usuario-cancel' });

  const drafts = await listDraftDocuments({
    ownerId: 'usuario-cancel',
    type: DOCUMENT_TYPES.COUNT
  });

  assert.equal(drafts.length, 0);
});

test('almacenistas solo ven sus propias entradas y surtidos, mientras GOD ve todo el equipo', () => {
  assert.equal(typeof filterOperationalDocumentsForActor, 'function');

  const documents = [
    {
      id: 'entry-a',
      type: DOCUMENT_TYPES.ENTRY,
      status: DOCUMENT_STATUS.DRAFT,
      ownerId: 'warehouse-a'
    },
    {
      id: 'entry-b',
      type: DOCUMENT_TYPES.ENTRY,
      status: DOCUMENT_STATUS.DRAFT,
      ownerId: 'warehouse-b'
    },
    {
      id: 'supply-b',
      type: DOCUMENT_TYPES.SUPPLY,
      status: DOCUMENT_STATUS.CLOSED,
      ownerId: 'warehouse-b'
    }
  ];

  const warehouseVisible = filterOperationalDocumentsForActor(documents, {
    ownerId: 'warehouse-a',
    roleCode: 'WAREHOUSE'
  });

  assert.deepEqual(
    warehouseVisible.map(document => document.id),
    ['entry-a']
  );

  const godVisible = filterOperationalDocumentsForActor(documents, {
    ownerId: 'god-user',
    roleCode: 'GOD'
  });

  assert.deepEqual(
    godVisible.map(document => document.id),
    ['entry-a', 'entry-b', 'supply-b']
  );
});

test('solo el dueño o GOD pueden administrar un borrador operativo', () => {
  assert.equal(typeof canActorAccessOperationalDocument, 'function');

  const foreignDraft = {
    id: 'supply-other',
    type: DOCUMENT_TYPES.SUPPLY,
    status: DOCUMENT_STATUS.DRAFT,
    ownerId: 'warehouse-b'
  };

  assert.equal(
    canActorAccessOperationalDocument(foreignDraft, {
      ownerId: 'warehouse-a',
      roleCode: 'WAREHOUSE'
    }),
    false
  );

  assert.equal(
    canActorAccessOperationalDocument(foreignDraft, {
      ownerId: 'warehouse-b',
      roleCode: 'WAREHOUSE'
    }),
    true
  );

  assert.equal(
    canActorAccessOperationalDocument(foreignDraft, {
      ownerId: 'god-user',
      roleCode: 'GOD'
    }),
    true
  );
});
