import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5190';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL para smoke test');
}

const stamp = Date.now().toString(36);
const now = new Date().toISOString();

const bootstrap = await jsonFetch('/api/v1/dev/bootstrap', {
  method: 'POST',
  headers: {
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    workspaceKey: `ci-${stamp}`,
    externalUserId: `ci-user-${stamp}`,
    displayName: 'CI Operator'
  })
});

const headers = {
  'content-type': 'application/json',
  'x-workspace-id': bootstrap.workspace.id,
  'x-user-id': bootstrap.user.id
};

const productId = `prd_ci_${stamp}`;
const entryDocumentId = `ent_ci_${stamp}`;
const supplyDocumentId = `sur_ci_${stamp}`;
const entryMovementId = `mov_ci_entry_${stamp}`;
const supplyMovementId = `mov_ci_supply_${stamp}`;
const rejectedMovementId = `mov_ci_reject_${stamp}`;
const reversalMovementId = `mov_ci_reversal_${stamp}`;

await pushEvent({
  id: `evt_product_${stamp}`,
  entityType: 'product',
  entityId: productId,
  operation: 'CREATE',
  payload: {
    id: productId,
    sku: `CI-${stamp}`,
    name: 'CI PRODUCT',
    nameNormalized: 'ci product',
    aliases: [],
    barcode: '',
    categoryId: null,
    inventoryUnitId: 'unit_und',
    purchaseUnitId: 'unit_und',
    purchaseConversion: 1,
    minStock: 0,
    maxStock: 50,
    replenishmentMethod: 'BOTH',
    supplierId: null,
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now
  }
});

await pushEvent({
  id: `evt_entry_doc_${stamp}`,
  entityType: 'document',
  entityId: entryDocumentId,
  operation: 'CREATE',
  payload: baseDocument(entryDocumentId, 'ENTRY')
});

await pushEvent({
  id: `evt_entry_movement_${stamp}`,
  entityType: 'movement',
  entityId: entryMovementId,
  operation: 'CREATE',
  payload: {
    id: entryMovementId,
    productId,
    type: 'ENTRY',
    quantity: 10,
    delta: null,
    documentId: entryDocumentId,
    lotId: null,
    locationId: null,
    userId: 'forged-client-user',
    reversedMovementId: null,
    metadata: {
      smoke: true
    },
    effectiveAt: now,
    createdAt: now
  }
});

await pushEvent({
  id: `evt_supply_doc_${stamp}`,
  entityType: 'document',
  entityId: supplyDocumentId,
  operation: 'CREATE',
  payload: baseDocument(supplyDocumentId, 'SUPPLY')
});

await pushEvent({
  id: `evt_supply_movement_${stamp}`,
  entityType: 'movement',
  entityId: supplyMovementId,
  operation: 'CREATE',
  payload: {
    id: supplyMovementId,
    productId,
    type: 'SUPPLY',
    quantity: 4,
    delta: null,
    documentId: supplyDocumentId,
    lotId: null,
    locationId: null,
    userId: 'forged-client-user',
    reversedMovementId: null,
    metadata: {
      smoke: true
    },
    effectiveAt: now,
    createdAt: now
  }
});

const db = new Client({
  connectionString: databaseUrl
});
await db.connect();

try {
  await assertStock(db, bootstrap.workspace.id, productId, 6);

  const rejected = await fetch(
    `${baseUrl}/api/v1/sync/push`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: [{
          id: `evt_rejected_${stamp}`,
          entityType: 'movement',
          entityId: rejectedMovementId,
          operation: 'CREATE',
          payload: {
            id: rejectedMovementId,
            productId,
            type: 'SUPPLY',
            quantity: 7,
            delta: null,
            documentId: supplyDocumentId,
            lotId: null,
            locationId: null,
            userId: 'forged-client-user',
            reversedMovementId: null,
            metadata: {
              smoke: true
            },
            effectiveAt: now,
            createdAt: now
          }
        }]
      })
    }
  );

  const rejectedBody = await rejected.json();

  if (
    rejected.status !== 409 ||
    rejectedBody.code !== 'STOCK_NEGATIVE'
  ) {
    throw new Error(
      `Se esperaba STOCK_NEGATIVE 409 y llegó ${rejected.status}: ${JSON.stringify(rejectedBody)}`
    );
  }

  await assertStock(db, bootstrap.workspace.id, productId, 6);

  await pushEvent({
    id: `evt_reversal_${stamp}`,
    entityType: 'movement',
    entityId: reversalMovementId,
    operation: 'CREATE',
    payload: {
      id: reversalMovementId,
      productId,
      type: 'REVERSAL',
      quantity: 4,
      delta: 4,
      documentId: supplyDocumentId,
      lotId: null,
      locationId: null,
      userId: 'forged-client-user',
      reversedMovementId: supplyMovementId,
      metadata: {
        reason: 'CI reversal'
      },
      effectiveAt: now,
      createdAt: now
    }
  });

  await assertStock(db, bootstrap.workspace.id, productId, 10);

  const userCheck = await db.query(
    `SELECT user_id
     FROM movements
     WHERE workspace_id = $1
       AND id = $2`,
    [
      bootstrap.workspace.id,
      entryMovementId
    ]
  );

  if (
    userCheck.rowCount !== 1 ||
    userCheck.rows[0].user_id !== bootstrap.user.id
  ) {
    throw new Error(
      'El servidor no reemplazó el userId falsificado por la identidad autenticada.'
    );
  }

  const pull = await jsonFetch(
    '/api/v1/sync/pull?cursor=0&limit=100',
    {
      headers
    }
  );

  if (!Array.isArray(pull.events) || pull.events.length < 6) {
    throw new Error('El pull incremental no devolvió los eventos esperados.');
  }

  console.log('✓ integration smoke: stock, auth, sync, reversal e invariantes correctos');
} finally {
  await db.end();
}

function baseDocument(id, type) {
  return {
    id,
    type,
    status: 'DRAFT',
    ownerId: `ci-user-${stamp}`,
    locationId: null,
    destinationId: null,
    supplierId: null,
    reference: '',
    notes: '',
    metadata: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedBy: null
  };
}

async function pushEvent(event) {
  return jsonFetch('/api/v1/sync/push', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      events: [event]
    })
  });
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(
    `${baseUrl}${path}`,
    options
  );
  const body = await response.json();

  if (!response.ok || body?.ok === false) {
    throw new Error(
      `${path} falló (${response.status}): ${JSON.stringify(body)}`
    );
  }

  return body;
}

async function assertStock(client, workspaceId, targetProductId, expected) {
  const result = await client.query(
    `SELECT stock
     FROM inventory_stock
     WHERE workspace_id = $1
       AND product_id = $2
       AND location_id IS NULL`,
    [
      workspaceId,
      targetProductId
    ]
  );

  const stock = result.rowCount
    ? Number(result.rows[0].stock)
    : 0;

  if (Math.abs(stock - expected) > 0.000001) {
    throw new Error(
      `Stock inesperado. Esperado ${expected}, recibido ${stock}.`
    );
  }
}
