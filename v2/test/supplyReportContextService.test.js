import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createDocument,
  closeDocument
} = await import('../src/documents/documentService.js');
const {
  DOCUMENT_TYPES
} = await import('../src/documents/documentTypes.js');
const {
  updateSupplyReportContext
} = await import('../src/documents/supplyReportContextService.js');
const {
  STORES,
  get,
  getAll
} = await import('../src/storage/database.js');

test('guarda destino y responsable en metadata del surtido y los sincroniza', async () => {
  const document = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'almacenista-v5c'
  });

  const updated = await updateSupplyReportContext(document.id, {
    destinationName: 'CAFETERÍA',
    responsibleName: 'Armando',
    saintNotes: 'Descargo de turno mañana'
  });

  assert.equal(updated.metadata.destinationName, 'CAFETERÍA');
  assert.equal(updated.metadata.responsibleName, 'Armando');
  assert.equal(updated.metadata.saintNotes, 'Descargo de turno mañana');
  assert.ok(updated.version > document.version);

  const stored = await get(STORES.DOCUMENTS, document.id);
  assert.equal(stored.metadata.destinationName, 'CAFETERÍA');

  const queue = await getAll(STORES.SYNC_QUEUE);
  assert.equal(
    queue.some(item =>
      item.entityType === 'document' &&
      item.entityId === document.id &&
      item.operation === 'UPDATE' &&
      item.payload?.metadata?.destinationName === 'CAFETERÍA'
    ),
    true
  );
});

test('no permite editar contexto SAINT después de cerrar el surtido', async () => {
  const document = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'almacenista-v5c-closed'
  });

  // Un surtido vacío puede cerrarse en el servicio actual sin crear movimientos.
  await closeDocument(document.id, {
    userId: 'almacenista-v5c-closed'
  });

  await assert.rejects(
    updateSupplyReportContext(document.id, {
      destinationName: 'COCINA'
    }),
    /ya no está en borrador/i
  );
});
