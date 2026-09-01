import 'dotenv/config';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';

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

  const concurrentProductId = `prd_ci_concurrent_${stamp}`;
  const concurrentEntryDocumentId = `ent_ci_concurrent_${stamp}`;
  const concurrentSupplyA = `sur_ci_concurrent_a_${stamp}`;
  const concurrentSupplyB = `sur_ci_concurrent_b_${stamp}`;

  await pushEvent({
    id: `evt_product_concurrent_${stamp}`,
    entityType: 'product',
    entityId: concurrentProductId,
    operation: 'CREATE',
    payload: {
      id: concurrentProductId,
      sku: `CI-CONCURRENT-${stamp}`,
      name: 'CI CONCURRENT PRODUCT',
      nameNormalized: 'ci concurrent product',
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
    id: `evt_entry_doc_concurrent_${stamp}`,
    entityType: 'document',
    entityId: concurrentEntryDocumentId,
    operation: 'CREATE',
    payload: baseDocument(
      concurrentEntryDocumentId,
      'ENTRY'
    )
  });

  await pushEvent({
    id: `evt_entry_concurrent_${stamp}`,
    entityType: 'movement',
    entityId: `mov_entry_concurrent_${stamp}`,
    operation: 'CREATE',
    payload: {
      id: `mov_entry_concurrent_${stamp}`,
      productId: concurrentProductId,
      type: 'ENTRY',
      quantity: 6,
      delta: null,
      documentId: concurrentEntryDocumentId,
      lotId: null,
      locationId: null,
      userId: 'forged-client-user',
      reversedMovementId: null,
      metadata: { concurrency: true },
      effectiveAt: now,
      createdAt: now
    }
  });

  await pushEvent({
    id: `evt_supply_doc_a_${stamp}`,
    entityType: 'document',
    entityId: concurrentSupplyA,
    operation: 'CREATE',
    payload: baseDocument(concurrentSupplyA, 'SUPPLY')
  });

  await pushEvent({
    id: `evt_supply_doc_b_${stamp}`,
    entityType: 'document',
    entityId: concurrentSupplyB,
    operation: 'CREATE',
    payload: baseDocument(concurrentSupplyB, 'SUPPLY')
  });

  const concurrentEvents = [
    {
      id: `evt_concurrent_a_${stamp}`,
      entityType: 'movement',
      entityId: `mov_concurrent_a_${stamp}`,
      operation: 'CREATE',
      payload: {
        id: `mov_concurrent_a_${stamp}`,
        productId: concurrentProductId,
        type: 'SUPPLY',
        quantity: 4,
        delta: null,
        documentId: concurrentSupplyA,
        lotId: null,
        locationId: null,
        userId: 'forged-client-user',
        reversedMovementId: null,
        metadata: { concurrency: 'A' },
        effectiveAt: now,
        createdAt: now
      }
    },
    {
      id: `evt_concurrent_b_${stamp}`,
      entityType: 'movement',
      entityId: `mov_concurrent_b_${stamp}`,
      operation: 'CREATE',
      payload: {
        id: `mov_concurrent_b_${stamp}`,
        productId: concurrentProductId,
        type: 'SUPPLY',
        quantity: 4,
        delta: null,
        documentId: concurrentSupplyB,
        lotId: null,
        locationId: null,
        userId: 'forged-client-user',
        reversedMovementId: null,
        metadata: { concurrency: 'B' },
        effectiveAt: now,
        createdAt: now
      }
    }
  ];

  const concurrentResults = await Promise.all(
    concurrentEvents.map(event =>
      rawPushEvent(event)
    )
  );

  const successes = concurrentResults.filter(
    result => result.response.status === 200
  );
  const stockBlocks = concurrentResults.filter(
    result =>
      result.response.status === 409 &&
      result.body?.code === 'STOCK_NEGATIVE'
  );

  if (successes.length !== 1 || stockBlocks.length !== 1) {
    throw new Error(
      `Concurrencia insegura: se esperaba 1 salida aceptada y 1 bloqueada. ${JSON.stringify(
        concurrentResults.map(item => ({
          status: item.response.status,
          body: item.body
        }))
      )}`
    );
  }

  await assertStock(
    db,
    bootstrap.workspace.id,
    concurrentProductId,
    2
  );

  const successfulEvent = concurrentEvents.find(
    event =>
      successes[0].body?.applied?.some(
        item => item.id === event.id
      )
  );

  if (!successfulEvent) {
    throw new Error(
      'No se pudo identificar el evento concurrente aceptado.'
    );
  }

  const duplicateResult = await rawPushEvent(
    successfulEvent
  );

  if (
    duplicateResult.response.status !== 200 ||
    duplicateResult.body?.applied?.[0]?.duplicate !== true
  ) {
    throw new Error(
      'La repetición idempotente del evento concurrente no fue reconocida como duplicada.'
    );
  }

  await assertStock(
    db,
    bootstrap.workspace.id,
    concurrentProductId,
    2
  );

  const bulkSize = 75;
  const bulkEvents = Array.from(
    { length: bulkSize },
    (_, index) => {
      const id = `prd_ci_bulk_${stamp}_${index}`;

      return {
        id: `evt_ci_bulk_${stamp}_${index}`,
        entityType: 'product',
        entityId: id,
        operation: 'CREATE',
        payload: {
          id,
          sku: `CI-BULK-${stamp}-${index}`,
          name: `CI BULK PRODUCT ${index}`,
          nameNormalized:
            `ci bulk product ${index}`,
          aliases: [],
          barcode: '',
          categoryId: null,
          inventoryUnitId: 'unit_und',
          purchaseUnitId: 'unit_und',
          purchaseConversion: 1,
          minStock: 0,
          maxStock: 100,
          replenishmentMethod: 'BOTH',
          supplierId: null,
          active: true,
          version: 1,
          createdAt: now,
          updatedAt: now
        }
      };
    }
  );

  const bulkStartedAt = Date.now();

  const bulkResult = await jsonFetch(
    '/api/v1/sync/push',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: bulkEvents
      })
    }
  );

  const bulkDurationMs =
    Date.now() - bulkStartedAt;

  if (
    !Array.isArray(bulkResult.applied) ||
    bulkResult.applied.length !== bulkSize
  ) {
    throw new Error(
      `El lote de carga no confirmó ${bulkSize} eventos.`
    );
  }

  const bulkCount = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM products
     WHERE workspace_id = $1
       AND sku LIKE $2`,
    [
      bootstrap.workspace.id,
      `CI-BULK-${stamp}-%`
    ]
  );

  if (
    Number(bulkCount.rows[0]?.total || 0) !==
    bulkSize
  ) {
    throw new Error(
      'El lote de carga no quedó completo en PostgreSQL.'
    );
  }

  if (bulkDurationMs > 15000) {
    throw new Error(
      `Lote de ${bulkSize} eventos excedió 15 s (${bulkDurationMs} ms).`
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

  const stateFile = String(
    process.env.SMOKE_STATE_FILE || ''
  ).trim();

  if (stateFile) {
    await writeFile(
      stateFile,
      JSON.stringify({
        workspaceId: bootstrap.workspace.id,
        userId: bootstrap.user.id,
        productId,
        expectedStock: 10,
        concurrentProductId,
        concurrentExpectedStock: 2
      }, null, 2),
      'utf8'
    );
  }

  console.log(
    `✓ integration smoke: stock, auth, sync, reversals, idempotencia, concurrencia y lote de ${bulkSize} eventos correctos (${bulkDurationMs} ms)`
  );
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

async function rawPushEvent(event) {
  const response = await fetch(
    `${baseUrl}/api/v1/sync/push`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: [event]
      })
    }
  );

  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  return { response, body };
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
