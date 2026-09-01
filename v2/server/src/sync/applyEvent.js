import { validateSyncEvent } from './validateEvent.js';

export async function applyEvent(client, auth, event) {
  validateSyncEvent(event);

  const { workspaceId, userId } = auth;
  const { entityType, operation, payload } = event;

  switch (entityType) {
    case 'product':
      return upsertProduct(client, workspaceId, payload);
    case 'category':
      return upsertCategory(client, workspaceId, payload);
    case 'supplier':
      return upsertSupplier(client, workspaceId, payload);
    case 'location':
      return upsertLocation(client, workspaceId, payload);
    case 'document':
      return upsertDocument(client, workspaceId, payload);
    case 'documentLine':
      return upsertDocumentLine(client, workspaceId, payload);
    case 'lot':
      return upsertLot(client, workspaceId, payload);
    case 'movement':
      if (operation !== 'CREATE') {
        throw new Error('Los movimientos solo admiten CREATE');
      }
      return insertMovement(client, workspaceId, userId, payload);
    default:
      throw new Error(`Entidad no soportada: ${entityType}`);
  }
}

async function upsertProduct(client, workspaceId, p) {
  await client.query(
    `INSERT INTO products (
      workspace_id,id,sku,name,name_normalized,aliases,barcode,category_id,
      inventory_unit_id,purchase_unit_id,purchase_conversion,min_stock,max_stock,
      replenishment_method,supplier_id,active,created_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
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
      document_id,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (workspace_id,id) DO UPDATE SET
      lot_number=EXCLUDED.lot_number,
      expires_at=EXCLUDED.expires_at,
      remaining_quantity=EXCLUDED.remaining_quantity,
      unit_cost=EXCLUDED.unit_cost,
      supplier_id=EXCLUDED.supplier_id,
      updated_at=EXCLUDED.updated_at`,
    [
      workspaceId,p.id,p.productId,p.lotNumber || null,p.receivedAt,
      p.expiresAt || null,p.originalQuantity,p.remainingQuantity,
      p.unitCost ?? null,p.supplierId || null,p.documentId || null,
      p.createdAt,p.updatedAt
    ]
  );
}

async function insertMovement(client, workspaceId, userId, p) {
  await client.query(
    `INSERT INTO movements (
      workspace_id,id,product_id,type,quantity,delta,document_id,lot_id,
      location_id,user_id,reversed_movement_id,metadata,effective_at,created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
    ON CONFLICT (workspace_id,id) DO NOTHING`,
    [
      workspaceId,p.id,p.productId,p.type,p.quantity || 0,
      p.delta ?? null,p.documentId || null,p.lotId || null,
      p.locationId || null,userId || null,p.reversedMovementId || null,
      JSON.stringify(p.metadata || {}),p.effectiveAt,p.createdAt
    ]
  );
}
