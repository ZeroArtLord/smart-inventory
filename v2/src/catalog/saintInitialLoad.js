import { createLocalId } from '../core/ids.js';
import {
  buildCatalogIdentityIndexes,
  resolveCatalogProductIdentity
} from './catalogImportGuard.js';
import {
  STORES,
  getAll
} from '../storage/database.js';
import {
  enqueueSyncOperation
} from '../sync/localQueue.js';

export function buildSaintInitialLoadDraft(
  preview,
  products
) {
  const rows = Array.isArray(preview?.rows)
    ? preview.rows
    : [];

  if (!rows.length) {
    throw new Error(
      'No hay filas SAINT válidas para preparar la existencia inicial'
    );
  }

  if (!preview?.hasInitialStockColumn) {
    throw new Error(
      'El archivo no contiene una columna de Existencia SAINT; el catálogo puede importarse, pero la apertura de stock no se puede preparar.'
    );
  }

  const indexes =
    buildCatalogIdentityIndexes(products);
  const missing = [];
  const conflicts = [];
  const mappedRows = [];

  for (const row of rows) {
    const resolution =
      resolveCatalogProductIdentity(
        row,
        indexes
      );

    if (resolution.error) {
      conflicts.push(
        `Fila ${row.excelRow || '?'}: ${resolution.error}`
      );
      continue;
    }

    const product =
      resolution.product;

    if (!product) {
      missing.push(
        row.sku ||
        row.barcode ||
        row.name ||
        `Fila ${row.excelRow || '?'}`
      );
      continue;
    }

    if (
      row.saintInitialStock === null ||
      row.saintInitialStock === undefined
    ) {
      throw new Error(
        `Falta existencia SAINT explícita para ${row.name || product.name}. Escribe 0 si realmente no hay stock.`
      );
    }

    const quantity = Number(
      row.saintInitialStock
    );

    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(
        `Existencia inicial inválida para ${row.name || product.name}`
      );
    }

    mappedRows.push({
      productId: product.id,
      quantity,
      sourceCode: row.sku || null,
      sourceRow: row.excelRow || null,
      name: product.name,
      unitCode: row.unitCode || 'UND'
    });
  }

  if (conflicts.length) {
    throw new Error(
      `La carga inicial tiene conflictos de identidad: ${conflicts.slice(0, 5).join(' | ')}`
    );
  }

  if (missing.length) {
    throw new Error(
      `No se pudieron vincular ${missing.length} producto(s) después de importar el catálogo: ${missing.slice(0, 8).join(', ')}`
    );
  }

  const now = new Date().toISOString();

  const draft = {
    id: createLocalId('saintload'),
    source: 'SAINT',
    fileName: preview.fileName || null,
    fileSize: Number(preview.fileSize || 0) || null,
    fileSha256: preview.fileSha256 || null,
    sheetName: preview.sheetName || null,
    createdAt: now,
    rows: mappedRows
  };

  validateClientDraft(draft);
  return draft;
}

export async function enqueueSaintInitialLoad(
  draft
) {
  validateClientDraft(draft);

  return enqueueSyncOperation({
    entityType: 'initialLoad',
    entityId: draft.id,
    operation: 'CREATE',
    payload: draft
  });
}

export async function getLocalSaintInitialLoadStatus() {
  const documents = await getAll(
    STORES.DOCUMENTS
  );

  const match = documents
    .filter(document =>
      document?.metadata?.kind ===
      'SAINT_INITIAL_LOAD'
    )
    .sort((a, b) =>
      String(
        b.closedAt ||
        b.updatedAt ||
        ''
      ).localeCompare(
        String(
          a.closedAt ||
          a.updatedAt ||
          ''
        )
      )
    )[0];

  if (!match) return null;

  return {
    applied: true,
    runId:
      match.metadata?.initialLoadId ||
      null,
    documentId: match.id,
    source:
      match.metadata?.source ||
      'SAINT',
    productCount:
      Number(
        match.metadata?.productCount ||
        0
      ),
    positiveStockCount:
      Number(
        match.metadata
          ?.positiveStockCount ||
        0
      ),
    fileSha256:
      match.metadata?.fileSha256 ||
      null,
    appliedAt:
      match.closedAt ||
      match.updatedAt ||
      null
  };
}

export function reconstructSaintInitialLoad(
  event
) {
  const payload = event?.payload || {};
  validateClientDraft(payload);

  const appliedAt =
    payload.appliedAt ||
    event?.appliedAt ||
    payload.createdAt ||
    new Date().toISOString();

  const userId =
    payload.appliedBy ||
    event?.userId ||
    null;

  const documentId =
    payload.documentId ||
    initialLoadDocumentId(payload.id);

  const positiveStockCount =
    payload.rows.filter(
      row => Number(row.quantity || 0) > 0
    ).length;

  const document = {
    id: documentId,
    type: 'ADJUSTMENT',
    status: 'CLOSED',
    ownerId: userId,
    locationId: null,
    destinationId: null,
    supplierId: null,
    reference: 'CARGA INICIAL SAINT',
    notes:
      'Existencia inicial importada una sola vez desde SAINT.',
    metadata: {
      kind: 'SAINT_INITIAL_LOAD',
      initialLoadId: payload.id,
      source: payload.source || 'SAINT',
      productCount: payload.rows.length,
      positiveStockCount,
      fileName: payload.fileName || null,
      fileSize: Number(payload.fileSize || 0) || null,
      fileSha256: payload.fileSha256 || null
    },
    version: 1,
    createdAt: appliedAt,
    updatedAt: appliedAt,
    closedAt: appliedAt,
    closedBy: userId
  };

  const lines = payload.rows.map(
    (row, index) => ({
      id: initialLoadLineId(
        payload.id,
        index
      ),
      documentId,
      documentType: 'ADJUSTMENT',
      productId: row.productId,
      expectedStock: 0,
      countedStock:
        Number(row.quantity || 0),
      quantity:
        Number(row.quantity || 0),
      sourceCode:
        row.sourceCode ||
        null,
      sourceRow:
        row.sourceRow ||
        null,
      version: 1,
      createdAt: appliedAt,
      updatedAt: appliedAt
    })
  );

  const movements = payload.rows
    .map((row, index) => ({
      row,
      index
    }))
    .filter(({ row }) =>
      Number(row.quantity || 0) > 0
    )
    .map(({ row, index }) => {
      const quantity =
        Number(row.quantity || 0);

      return {
        id: initialLoadMovementId(
          payload.id,
          index
        ),
        productId: row.productId,
        type: 'ADJUSTMENT',
        quantity,
        delta: quantity,
        documentId,
        lotId: null,
        locationId: null,
        userId,
        reversedMovementId: null,
        metadata: {
          kind:
            'SAINT_INITIAL_LOAD',
          initialLoadId:
            payload.id,
          source:
            payload.source ||
            'SAINT',
          sourceCode:
            row.sourceCode ||
            null,
          sourceRow:
            row.sourceRow ||
            null,
          saintInitialStock:
            quantity
        },
        effectiveAt: appliedAt,
        createdAt: appliedAt,
        syncedAt: appliedAt
      };
    });

  return {
    document,
    lines,
    movements
  };
}

export function saintInitialLoadSummary(
  draft
) {
  const rows = Array.isArray(draft?.rows)
    ? draft.rows
    : [];

  return {
    productCount: rows.length,
    positiveStockCount:
      rows.filter(
        row =>
          Number(row.quantity || 0) > 0
      ).length,
    zeroStockCount:
      rows.filter(
        row =>
          Number(row.quantity || 0) === 0
      ).length
  };
}

export function initialLoadDocumentId(
  runId
) {
  return `adj_saint_initial_${runId}`;
}

export function initialLoadLineId(
  runId,
  index
) {
  return `line_saint_initial_${runId}_${String(
    index + 1
  ).padStart(5, '0')}`;
}

export function initialLoadMovementId(
  runId,
  index
) {
  return `mov_saint_initial_${runId}_${String(
    index + 1
  ).padStart(5, '0')}`;
}

function validateClientDraft(draft) {
  if (
    !draft ||
    typeof draft !== 'object'
  ) {
    throw new Error(
      'Carga inicial SAINT inválida'
    );
  }

  if (!draft.id) {
    throw new Error(
      'La carga inicial no tiene ID'
    );
  }

  if (
    draft.fileSha256 &&
    !/^[a-f0-9]{64}$/i.test(
      String(draft.fileSha256)
    )
  ) {
    throw new Error(
      'Huella SHA-256 del archivo SAINT inválida'
    );
  }

  if (
    !Array.isArray(draft.rows) ||
    draft.rows.length === 0
  ) {
    throw new Error(
      'La carga inicial no contiene productos'
    );
  }

  if (draft.rows.length > 5000) {
    throw new Error(
      'La carga inicial supera 5000 productos'
    );
  }

  const seen = new Set();

  for (const row of draft.rows) {
    if (!row?.productId) {
      throw new Error(
        'Producto inválido en carga inicial'
      );
    }

    if (seen.has(row.productId)) {
      throw new Error(
        'Producto duplicado en carga inicial'
      );
    }
    seen.add(row.productId);

    const quantity = Number(
      row.quantity || 0
    );

    if (
      !Number.isFinite(quantity) ||
      quantity < 0
    ) {
      throw new Error(
        'Existencia inicial inválida'
      );
    }
  }
}

