import { createLocalId } from '../core/ids.js';
import { nextEntityVersion } from '../core/versioning.js';
import {
  STORES,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { DOCUMENT_STATUS, DOCUMENT_TYPES } from './documentTypes.js';
import {
  buildCountWorkflowMetadataPatch,
  clearProductPending,
  markProductPending,
  normalizeCountWorkflowMetadata
} from './countWorkflow.js';

export async function updateCountWorkflow(
  documentId,
  patch = {}
) {
  return updateCountDocument(documentId, document => ({
    ...document,
    metadata: {
      ...(document.metadata || {}),
      ...buildCountWorkflowMetadataPatch(
        document.metadata,
        patch
      )
    }
  }));
}

export async function markCountProductPending(
  documentId,
  productId
) {
  return updateCountDocument(documentId, document => ({
    ...document,
    metadata: {
      ...(document.metadata || {}),
      ...markProductPending(
        document.metadata,
        productId
      )
    }
  }));
}

export async function clearCountProductPending(
  documentId,
  productId
) {
  return updateCountDocument(documentId, document => ({
    ...document,
    metadata: {
      ...(document.metadata || {}),
      ...clearProductPending(
        document.metadata,
        productId
      )
    }
  }));
}

export function getCountWorkflow(document) {
  return normalizeCountWorkflowMetadata(
    document?.metadata
  );
}

async function updateCountDocument(
  documentId,
  updater
) {
  const id = String(documentId || '').trim();
  if (!id) throw new Error('Conteo no identificado');

  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const current = await requestToPromise(
        documentStore.get(id)
      );

      assertEditableCount(current);

      const now = new Date().toISOString();
      const proposed = updater(current);
      const updated = {
        ...proposed,
        id: current.id,
        type: current.type,
        status: current.status,
        version: nextEntityVersion(current),
        createdAt: current.createdAt,
        updatedAt: now
      };

      await requestToPromise(
        documentStore.put(updated)
      );

      await requestToPromise(
        queueStore.add({
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
        })
      );

      return updated;
    }
  );
}

function assertEditableCount(document) {
  if (!document) {
    throw new Error('Conteo no encontrado');
  }

  if (document.type !== DOCUMENT_TYPES.COUNT) {
    throw new Error('El documento no es un conteo');
  }

  if (document.status !== DOCUMENT_STATUS.DRAFT) {
    throw new Error('El conteo ya no está en borrador');
  }
}
