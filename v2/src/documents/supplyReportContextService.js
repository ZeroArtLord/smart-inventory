import { createLocalId } from '../core/ids.js';
import { nextEntityVersion } from '../core/versioning.js';
import {
  STORES,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { DOCUMENT_STATUS, DOCUMENT_TYPES } from './documentTypes.js';

/**
 * Guarda contexto humano del surtido sin tocar líneas ni movimientos.
 * Se persiste en metadata para que viaje por la sincronización existente.
 */
export async function updateSupplyReportContext(
  documentId,
  {
    destinationName = undefined,
    responsibleName = undefined,
    saintNotes = undefined
  } = {}
) {
  const id = String(documentId || '').trim();
  if (!id) throw new Error('Surtido no identificado');

  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const current = await requestToPromise(documentStore.get(id));
      assertEditableSupply(current);

      const metadata = {
        ...(current.metadata || {})
      };

      if (destinationName !== undefined) {
        metadata.destinationName = clean(destinationName) || null;
      }
      if (responsibleName !== undefined) {
        metadata.responsibleName = clean(responsibleName) || null;
      }
      if (saintNotes !== undefined) {
        metadata.saintNotes = clean(saintNotes) || null;
      }

      const now = new Date().toISOString();
      const updated = {
        ...current,
        metadata,
        version: nextEntityVersion(current),
        updatedAt: now
      };

      await requestToPromise(documentStore.put(updated));
      await requestToPromise(queueStore.add({
        id: createLocalId('sync'),
        entityType: 'document',
        entityId: updated.id,
        operation: 'UPDATE',
        payload: updated,
        status: SYNC_STATUS.PENDING,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        lastError: null
      }));

      return updated;
    }
  );
}

function assertEditableSupply(document) {
  if (!document) throw new Error('Surtido no encontrado');
  if (document.type !== DOCUMENT_TYPES.SUPPLY) {
    throw new Error('El documento no es un surtido');
  }
  if (document.status !== DOCUMENT_STATUS.DRAFT) {
    throw new Error('El surtido ya no está en borrador');
  }
}

function clean(value) {
  return String(value ?? '').trim();
}
