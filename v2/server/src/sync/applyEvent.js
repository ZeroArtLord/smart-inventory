import { validateSyncEvent } from './validateEvent.js';
import { assertEventPermission } from '../security/permissions.js';
import { config } from '../config.js';
import { assertMovementKeepsStockNonNegative } from './stockInvariant.js';
import { assertMovementRelations } from './movementRelations.js';
import {
  assertMutableEntityVersion,
  persistMutableEntityVersion
} from './versioning.js';

export async function applyEvent(client, auth, event) {
  validateSyncEvent(event);
  assertEventPermission(auth, event);

  const { workspaceId, userId } = auth;
  const { entityType, operation, payload } = event;

  await assertMutableEntityVersion(
    client,
    workspaceId,
    event,
    {
      allowLegacy: config.nodeEnv !== 'production'
    }
  );

  let result;

  switch (entityType) {
    case 'product':
      result = await upsertProduct(
        client,
        workspaceId,
        payload,
        operation
      );
      break;
    case 'category':
      result = await upsertCategory(client, workspaceId, payload);
      break;
    case 'supplier':
      result = await upsertSupplier(client, workspaceId, payload);
      break;
    case 'location':
      result = await upsertLocation(client, workspaceId, payload);
      break;
    case 'document':
      result = await upsertDocument(client, workspaceId, payload);
      break;
    case 'documentLine':
      result = await upsertDocumentLine(client, workspaceId, payload);
      break;
    case 'lot':
      result = await upsertLot(client, workspaceId, payload);
      break;
    case 'replenishment':
      result = await upsertReplenishment(
        client,
        workspaceId,
        userId,
        payload
      );
      break;
    case 'movement':
      if (operation !== 'CREATE') {
        throw new Error('Los movimientos solo admiten CREATE');
      }
      result = await insertMovement(
        client,
        workspaceId,
        userId,
        payload
      );
      break;
    case 'initialLoad':
      if (operation !== 'CREATE') {
        throw new Error('La carga inicial solo admite CREATE');
      }
      result = await applyInitialLoad(
        client,
        workspaceId,
        userId,
        payload
      );
      break;
    default:
      throw new Error(`Entidad no soportada: ${entityType}`);
  }

  await persistMutableEntityVersion(
    client,
    workspaceId,
    event
  );

  return result;
}

async function upsertProduct(
  client,
  workspaceId,
  p,
  operation
) {
  if (operation === 'UPDATE') {
    const current = await client.query(
      `SELECT inventory_unit_id
       FROM products
       WHERE workspace_id = $1
         AND id = $2`,
      [workspaceId, p.id]
    );

    const currentUnit =
      current.rows[0]?.inventory_unit_id ||
      null;
    const nextUnit =
      p.inventoryUnitId ||
      null;

    if (
      current.rowCount > 0 &&
      currentUnit &&
      nextUnit &&
      currentUnit !== nextUnit
    ) {
      const movementCount =
        await client.query(
          `SELECT COUNT(*)::int AS total
           FROM movements
           WHERE workspace_id = $1
             AND product_id = $2`,
          [workspaceId, p.id]
        );

      if (
        Number(
          movementCount.rows[0]?.total ||
          0
        ) > 0
      ) {
        const error = new Error(
          'La unidad base no puede cambiarse porque el producto ya tiene movimientos'
        );
        error.code = 'BASE_UNIT_LOCKED';
        error.statusCode = 409;
        throw error;
      }
    }
  }

  await client.query(
    `INSERT INTO products (
      workspace_id,id,sku,name,name_normalized,aliases,barcode,category_id,
      inventory_unit_id,purchase_unit_id,purchase_conversion,presentations,
      min_stock,max_stock,replenishment_method,supplier_id,active,created_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19
    )
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      sku=EXCLUDED.sku,
      name=EXCLUDED.name,
      name_normalized=EXCLUDED.name_normalized,
      aliases=EXCLUDED.aliases,
      barcode=EXCLUDED.barcode,
      category_id=EXCLUDED.category_id,
      inventory_unit_id=EXCLUDED.inventory_unit_id,
      purchase_unit_id=EXCLUDED.purchase_unit_id,
      purchase_conversion=EXCLUDED.purchase_conversion,
      presentations=EXCLUDED.presentations,
      min_stock=EXCLUDED.min_stock,
      max_stock=EXCLUDED.max_stock,
      replenishment_method=EXCLUDED.replenishment_method,
      supplier_id=EXCLUDED.supplier_id,
      active=EXCLUDED.active,
      updated_at=EXCLUDED.updated_at`,
    [
      workspaceId,p.id,p.sku || null,p.name,p.nameNormalized || null,
      JSON.stringify(p.aliases || []),p.barcode || null,p.categoryId || null,
      p.inventoryUnitId || null,p.purchaseUnitId || null,p.purchaseConversion || 1,
      JSON.stringify(p.presentations || []),
      p.minStock || 0,p.maxStock || 0,p.replenishmentMethod || 'BOTH',
      p.supplierId || null,p.active !== false,p.createdAt,p.updatedAt
    ]
  );
}

async function upsertCategory(client, workspaceId, p) {
  await client.query(
    `INSERT INTO categories (workspace_id,id,name,name_normalized,active,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (workspace_id,id) DO UPDATE SET
       name=EXCLUDED.name,
       name_normalized=EXCLUDED.name_normalized,
       active=EXCLUDED.active,
       updated_at=EXCLUDED.updated_at`,
    [workspaceId,p.id,p.name,p.nameNormalized || null,p.active !== false,p.updatedAt || p.createdAt]
  );
}

async function upsertSupplier(client, workspaceId, p) {
  await client.query(
    `INSERT INTO suppliers (
      workspace_id,id,name,name_normalized,phone,email,notes,active,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      name=EXCLUDED.name,
      name_normalized=EXCLUDED.name_normalized,
      phone=EXCLUDED.phone,
      email=EXCLUDED.email,
      notes=EXCLUDED.notes,
      active=EXCLUDED.active,
      updated_at=EXCLUDED.updated_at`,
    [
      workspaceId,p.id,p.name,p.nameNormalized || null,p.phone || null,
      p.email || null,p.notes || null,p.active !== false,p.updatedAt || p.createdAt
    ]
  );
}

async function upsertLocation(client, workspaceId, p) {
  await client.query(
    `INSERT INTO locations (workspace_id,id,name,name_normalized,active,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (workspace_id,id) DO UPDATE SET
       name=EXCLUDED.name,
       name_normalized=EXCLUDED.name_normalized,
       active=EXCLUDED.active,
       updated_at=EXCLUDED.updated_at`,
    [workspaceId,p.id,p.name,p.nameNormalized || null,p.active !== false,p.updatedAt || p.createdAt]
  );
}

async function upsertDocument(client, workspaceId, p) {
  await client.query(
    `INSERT INTO documents (
      workspace_id,id,type,status,owner_id,location_id,destination_id,supplier_id,
      reference,notes,metadata,created_at,updated_at,closed_at,closed_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      status=EXCLUDED.status,
      owner_id=EXCLUDED.owner_id,
      location_id=EXCLUDED.location_id,
      destination_id=EXCLUDED.destination_id,
      supplier_id=EXCLUDED.supplier_id,
      reference=EXCLUDED.reference,
      notes=EXCLUDED.notes,
      metadata=EXCLUDED.metadata,
      updated_at=EXCLUDED.updated_at,
      closed_at=EXCLUDED.closed_at,
      closed_by=EXCLUDED.closed_by`,
    [
      workspaceId,p.id,p.type,p.status,p.ownerId || null,p.locationId || null,
      p.destinationId || null,p.supplierId || null,p.reference || null,p.notes || null,
      JSON.stringify(p.metadata || {}),p.createdAt,p.updatedAt,p.closedAt || null,p.closedBy || null
    ]
  );
}

async function upsertDocumentLine(client, workspaceId, p) {
  await client.query(
    `INSERT INTO document_lines (
      workspace_id,id,document_id,product_id,payload,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      payload=EXCLUDED.payload,
      updated_at=EXCLUDED.updated_at`,
    [
      workspaceId,p.id,p.documentId,p.productId,JSON.stringify(p),
      p.createdAt,p.updatedAt
    ]
  );
}

async function upsertLot(client, workspaceId, p) {
  await client.query(
    `INSERT INTO lots (
      workspace_id,id,product_id,lot_number,received_at,expires_at,
      original_quantity,remaining_quantity,unit_cost,supplier_id,
      location_id,document_id,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      lot_number=EXCLUDED.lot_number,
      expires_at=EXCLUDED.expires_at,
      remaining_quantity=EXCLUDED.remaining_quantity,
      unit_cost=EXCLUDED.unit_cost,
      supplier_id=EXCLUDED.supplier_id,
      location_id=EXCLUDED.location_id,
      updated_at=EXCLUDED.updated_at`,
    [
      workspaceId,p.id,p.productId,p.lotNumber || null,p.receivedAt,
      p.expiresAt || null,p.originalQuantity,p.remainingQuantity,
      p.unitCost ?? null,p.supplierId || null,p.locationId || null,
      p.documentId || null,p.createdAt,p.updatedAt
    ]
  );
}

async function upsertReplenishment(client, workspaceId, userId, p) {
  await client.query(
    `INSERT INTO replenishments (
      workspace_id,id,product_id,product_name,supplier_id,method,status,
      requested_quantity,received_quantity,pending_quantity,expected_at,
      reference,notes,owner_id,source_suggestion,receipt_documents,
      ordered_at,received_at,cancelled_at,updated_by,created_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,
      $16::jsonb,$17,$18,$19,$20,$21,$22
    )
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      product_name=EXCLUDED.product_name,
      supplier_id=EXCLUDED.supplier_id,
      method=EXCLUDED.method,
      status=EXCLUDED.status,
      requested_quantity=EXCLUDED.requested_quantity,
      received_quantity=EXCLUDED.received_quantity,
      pending_quantity=EXCLUDED.pending_quantity,
      expected_at=EXCLUDED.expected_at,
      reference=EXCLUDED.reference,
      notes=EXCLUDED.notes,
      owner_id=EXCLUDED.owner_id,
      source_suggestion=EXCLUDED.source_suggestion,
      receipt_documents=EXCLUDED.receipt_documents,
      ordered_at=EXCLUDED.ordered_at,
      received_at=EXCLUDED.received_at,
      cancelled_at=EXCLUDED.cancelled_at,
      updated_by=EXCLUDED.updated_by,
      updated_at=EXCLUDED.updated_at`,
    [
      workspaceId,p.id,p.productId,p.productName || null,p.supplierId || null,
      p.method,p.status,p.requestedQuantity,p.receivedQuantity || 0,
      p.pendingQuantity,p.expectedAt || null,p.reference || null,p.notes || null,
      p.ownerId || null,JSON.stringify(p.sourceSuggestion || null),
      JSON.stringify(p.receiptDocuments || []),p.orderedAt || null,
      p.receivedAt || null,p.cancelledAt || null,userId || null,
      p.createdAt,p.updatedAt
    ]
  );
}

async function applyInitialLoad(
  client,
  workspaceId,
  userId,
  payload
) {
  await client.query(
    `SELECT id
     FROM workspaces
     WHERE id = $1
     FOR UPDATE`,
    [workspaceId]
  );

  const alreadyApplied = await client.query(
    `SELECT run_id, document_id, applied_at
     FROM workspace_initial_loads
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (alreadyApplied.rowCount > 0) {
    throw initialLoadError(
      'INITIAL_LOAD_ALREADY_APPLIED',
      'La existencia inicial SAINT ya fue aplicada en este almacén'
    );
  }

  const existingMovements = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM movements
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (Number(existingMovements.rows[0]?.total || 0) > 0) {
    throw initialLoadError(
      'INITIAL_LOAD_NOT_CLEAN',
      'La carga inicial requiere un almacén sin movimientos previos'
    );
  }

  const productIds = payload.rows.map(row => row.productId);
  const productResult = await client.query(
    `SELECT id
     FROM products
     WHERE workspace_id = $1
       AND id = ANY($2::text[])`,
    [workspaceId, productIds]
  );

  const found = new Set(
    productResult.rows.map(row => row.id)
  );
  const missing = productIds.filter(id => !found.has(id));

  if (missing.length > 0) {
    throw initialLoadError(
      'INITIAL_LOAD_PRODUCT_MISSING',
      `Hay ${missing.length} producto(s) que todavía no existen en el servidor`,
      409,
      { productIds: missing.slice(0, 20) }
    );
  }

  const now = new Date().toISOString();
  const documentId = initialLoadDocumentId(payload.id);
  const positiveRows = payload.rows.filter(
    row => Number(row.quantity || 0) > 0
  );

  await client.query(
    `INSERT INTO documents (
      workspace_id,id,type,status,owner_id,location_id,destination_id,supplier_id,
      reference,notes,metadata,created_at,updated_at,closed_at,closed_by,version
    ) VALUES (
      $1,$2,'ADJUSTMENT','CLOSED',$3,NULL,NULL,NULL,
      $4,$5,$6::jsonb,$7,$7,$7,$3,1
    )`,
    [
      workspaceId,
      documentId,
      userId || null,
      'CARGA INICIAL SAINT',
      'Existencia inicial importada una sola vez desde SAINT.',
      JSON.stringify({
        kind: 'SAINT_INITIAL_LOAD',
        initialLoadId: payload.id,
        source: payload.source || 'SAINT',
        productCount: payload.rows.length,
        positiveStockCount: positiveRows.length,
        fileName: payload.fileName || null,
        fileSize: Number(payload.fileSize || 0) || null,
        fileSha256: payload.fileSha256 || null
      }),
      now
    ]
  );

  for (let index = 0; index < payload.rows.length; index++) {
    const row = payload.rows[index];
    const quantity = Number(row.quantity || 0);
    const lineId = initialLoadLineId(payload.id, index);

    const linePayload = {
      id: lineId,
      documentId,
      documentType: 'ADJUSTMENT',
      productId: row.productId,
      expectedStock: 0,
      countedStock: quantity,
      quantity,
      sourceCode: row.sourceCode || null,
      sourceRow: row.sourceRow || null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    await client.query(
      `INSERT INTO document_lines (
        workspace_id,id,document_id,product_id,payload,created_at,updated_at,version
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$6,1)`,
      [
        workspaceId,
        lineId,
        documentId,
        row.productId,
        JSON.stringify(linePayload),
        now
      ]
    );

    if (!(quantity > 0)) continue;

    await insertMovement(
      client,
      workspaceId,
      userId,
      {
        id: initialLoadMovementId(payload.id, index),
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
          kind: 'SAINT_INITIAL_LOAD',
          initialLoadId: payload.id,
          source: payload.source || 'SAINT',
          sourceCode: row.sourceCode || null,
          sourceRow: row.sourceRow || null,
          saintInitialStock: quantity
        },
        effectiveAt: now,
        createdAt: now
      }
    );
  }

  await client.query(
    `INSERT INTO workspace_initial_loads (
      workspace_id,run_id,source,document_id,product_count,
      positive_stock_count,applied_by,applied_at,metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      workspaceId,
      payload.id,
      payload.source || 'SAINT',
      documentId,
      payload.rows.length,
      positiveRows.length,
      userId || null,
      now,
      JSON.stringify({
        fileName: payload.fileName || null,
        fileSize: Number(payload.fileSize || 0) || null,
        fileSha256: payload.fileSha256 || null,
        sheetName: payload.sheetName || null
      })
    ]
  );

  payload.appliedAt = now;
  payload.documentId = documentId;
  payload.appliedBy = userId || null;
  payload.positiveStockCount = positiveRows.length;

  return {
    runId: payload.id,
    documentId,
    productCount: payload.rows.length,
    positiveStockCount: positiveRows.length,
    fileSha256: payload.fileSha256 || null,
    appliedAt: now
  };
}

function initialLoadDocumentId(runId) {
  return `adj_saint_initial_${runId}`;
}

function initialLoadLineId(runId, index) {
  return `line_saint_initial_${runId}_${String(index + 1).padStart(5, '0')}`;
}

function initialLoadMovementId(runId, index) {
  return `mov_saint_initial_${runId}_${String(index + 1).padStart(5, '0')}`;
}

function initialLoadError(
  code,
  message,
  statusCode = 409,
  details = null
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

async function insertMovement(client, workspaceId, userId, p) {
  await assertMovementRelations(
    client,
    workspaceId,
    p
  );

  const invariant = await assertMovementKeepsStockNonNegative(
    client,
    workspaceId,
    p
  );

  if (invariant.duplicateMovement) return;

  await client.query(
    `INSERT INTO movements (
      workspace_id,id,product_id,type,quantity,delta,document_id,lot_id,
      location_id,user_id,reversed_movement_id,metadata,effective_at,created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    [
      workspaceId,p.id,p.productId,p.type,p.quantity || 0,
      p.delta ?? null,p.documentId || null,p.lotId || null,
      p.locationId || null,userId || null,p.reversedMovementId || null,
      JSON.stringify(p.metadata || {}),p.effectiveAt,p.createdAt
    ]
  );
}
