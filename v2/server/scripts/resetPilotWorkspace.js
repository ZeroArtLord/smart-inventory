import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL');
}

const args = parseArgs(process.argv.slice(2));

if (!args.workspaceKey) {
  throw new Error('Debes indicar --workspace-key');
}

const expectedPilot = [
  { saintCode: 'PIL001', name: 'REFRESCO PILOTO' },
  { saintCode: 'PIL002', name: 'AGUA PILOTO' },
  { saintCode: 'PIL003', name: 'ACEITE PILOTO' },
  { saintCode: 'LIMPIADOR', name: 'LIMPIADOR PILOTO' },
  { saintCode: 'PIL005', name: 'PRODUCTO POR CAJA' }
];

const expectedSaintCodes = new Set(
  expectedPilot.map(item => item.saintCode.toUpperCase())
);

const expectedNames = new Map(
  expectedPilot.map(item => [
    item.saintCode.toUpperCase(),
    item.name
  ])
);

const confirmationPhrase =
  `RESET-PILOT-${args.workspaceKey}`;

const client = new Client({
  connectionString: databaseUrl
});

await client.connect();

try {
  const inspection = await inspectWorkspace(
    client,
    args.workspaceKey
  );

  printInspection(inspection);

  assertPilotOnly(inspection);

  if (!args.execute) {
    console.log('\nDRY RUN APROBADO: no se modificó la base de datos.');
    console.log(
      `Para ejecutar: npm run pilot:reset -- --workspace-key ${args.workspaceKey} --execute --confirm ${confirmationPhrase}`
    );
    process.exitCode = 0;
  } else {
    if (args.confirm !== confirmationPhrase) {
      throw new Error(
        `Confirmación inválida. Debe ser exactamente: ${confirmationPhrase}`
      );
    }

    const result = await resetPilotWorkspace(
      client,
      inspection
    );

    console.log('\nRESET PILOTO COMPLETADO');
    console.log(JSON.stringify(result, null, 2));

    const after = await inspectWorkspace(
      client,
      args.workspaceKey
    );

    console.log('\nESTADO DESPUÉS DEL RESET');
    printInspection(after);

    if (
      after.products.length !== 0 ||
      after.movements.length !== 0 ||
      after.initialLoads.length !== 0 ||
      after.documents.length !== 0 ||
      after.documentLines.length !== 0 ||
      after.lots.length !== 0 ||
      after.replenishments.length !== 0 ||
      after.syncEventCount !== 0
    ) {
      throw new Error(
        'El workspace no quedó operacionalmente vacío después del reset'
      );
    }
  }
} finally {
  await client.end();
}

async function inspectWorkspace(client, workspaceKey) {
  const workspaceResult = await client.query(
    `SELECT id, workspace_key, name, active
     FROM workspaces
     WHERE workspace_key = $1`,
    [workspaceKey]
  );

  if (workspaceResult.rowCount !== 1) {
    throw new Error(
      `Workspace no encontrado o ambiguo: ${workspaceKey}`
    );
  }

  const workspace = workspaceResult.rows[0];
  const workspaceId = workspace.id;

  const [
    products,
    movements,
    initialLoads,
    documents,
    documentLines,
    lots,
    replenishments,
    categories,
    syncEvents,
    auditEvents
  ] = await Promise.all([
    client.query(
      `SELECT id, saint_code, sku, name, category_id, active
       FROM products
       WHERE workspace_id = $1
       ORDER BY saint_code NULLS LAST, name`,
      [workspaceId]
    ),
    client.query(
      `SELECT id, product_id, type, quantity, delta,
              document_id, metadata
       FROM movements
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId]
    ),
    client.query(
      `SELECT workspace_id, run_id, source, document_id,
              product_count, positive_stock_count,
              applied_by, applied_at, metadata
       FROM workspace_initial_loads
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    client.query(
      `SELECT id, type, status, reference, metadata,
              created_at, closed_at
       FROM documents
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId]
    ),
    client.query(
      `SELECT id, document_id, product_id
       FROM document_lines
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId]
    ),
    client.query(
      `SELECT id, product_id, document_id, lot_number,
              original_quantity, remaining_quantity
       FROM lots
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId]
    ),
    client.query(
      `SELECT id, product_id, status, requested_quantity,
              received_quantity, pending_quantity
       FROM replenishments
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId]
    ),
    client.query(
      `SELECT id, name, active
       FROM categories
       WHERE workspace_id = $1
       ORDER BY name, id`,
      [workspaceId]
    ),
    client.query(
      `SELECT COUNT(*)::int AS total
       FROM sync_events
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    client.query(
      `SELECT COUNT(*)::int AS total
       FROM audit_events
       WHERE workspace_id = $1`,
      [workspaceId]
    )
  ]);

  return {
    workspace,
    products: products.rows,
    movements: movements.rows,
    initialLoads: initialLoads.rows,
    documents: documents.rows,
    documentLines: documentLines.rows,
    lots: lots.rows,
    replenishments: replenishments.rows,
    categories: categories.rows,
    syncEventCount: Number(syncEvents.rows[0]?.total || 0),
    auditEventCount: Number(auditEvents.rows[0]?.total || 0)
  };
}

function printInspection(info) {
  console.log(JSON.stringify({
    workspace: info.workspace,
    counts: {
      products: info.products.length,
      movements: info.movements.length,
      initialLoads: info.initialLoads.length,
      documents: info.documents.length,
      documentLines: info.documentLines.length,
      lots: info.lots.length,
      replenishments: info.replenishments.length,
      categories: info.categories.length,
      syncEvents: info.syncEventCount,
      auditEvents: info.auditEventCount
    },
    products: info.products.map(product => ({
      id: product.id,
      saintCode: product.saint_code,
      sku: product.sku,
      name: product.name,
      categoryId: product.category_id,
      active: product.active
    })),
    initialLoads: info.initialLoads,
    documents: info.documents
  }, null, 2));
}

function assertPilotOnly(info) {
  if (!info.workspace.active) {
    throw new Error('El workspace está inactivo; reset rechazado');
  }

  if (info.products.length !== expectedPilot.length) {
    throw new Error(
      `Guardia activada: se esperaban exactamente ${expectedPilot.length} productos piloto y existen ${info.products.length}`
    );
  }

  const seenCodes = new Set();

  for (const product of info.products) {
    const code = String(product.saint_code || '')
      .trim()
      .toUpperCase();

    if (!expectedSaintCodes.has(code)) {
      throw new Error(
        `Guardia activada: producto no piloto detectado (${product.name}, SAINT=${product.saint_code || 'VACÍO'})`
      );
    }

    const expectedName = expectedNames.get(code);
    if (product.name !== expectedName) {
      throw new Error(
        `Guardia activada: nombre inesperado para ${code}. Esperado=${expectedName}; actual=${product.name}`
      );
    }

    if (seenCodes.has(code)) {
      throw new Error(
        `Guardia activada: Código SAINT piloto duplicado (${code})`
      );
    }

    seenCodes.add(code);
  }

  if (seenCodes.size !== expectedSaintCodes.size) {
    throw new Error(
      'Guardia activada: falta al menos un producto piloto esperado'
    );
  }

  const pilotProductIds = new Set(
    info.products.map(product => product.id)
  );

  if (info.movements.length !== 4) {
    throw new Error(
      `Guardia activada: se esperaban exactamente 4 movimientos piloto y existen ${info.movements.length}`
    );
  }

  for (const movement of info.movements) {
    if (!pilotProductIds.has(movement.product_id)) {
      throw new Error(
        `Guardia activada: movimiento de producto no piloto (${movement.id})`
      );
    }
  }

  if (info.initialLoads.length !== 1) {
    throw new Error(
      `Guardia activada: se esperaba exactamente 1 apertura SAINT y existen ${info.initialLoads.length}`
    );
  }

  const initialLoad = info.initialLoads[0];

  if (
    String(initialLoad.source || '').toUpperCase() !== 'SAINT' ||
    Number(initialLoad.product_count) !== 5 ||
    Number(initialLoad.positive_stock_count) !== 4
  ) {
    throw new Error(
      'Guardia activada: la apertura registrada no coincide con el piloto esperado (SAINT, 5 productos, 4 positivos)'
    );
  }

  if (info.documents.length !== 1) {
    throw new Error(
      `Guardia activada: se esperaba exactamente 1 documento piloto y existen ${info.documents.length}`
    );
  }

  const document = info.documents[0];

  if (
    document.id !== initialLoad.document_id ||
    document.type !== 'ADJUSTMENT' ||
    document.status !== 'CLOSED'
  ) {
    throw new Error(
      'Guardia activada: el documento de apertura no coincide con la carga inicial SAINT esperada'
    );
  }

  if (info.documentLines.length !== 5) {
    throw new Error(
      `Guardia activada: se esperaban 5 líneas de apertura y existen ${info.documentLines.length}`
    );
  }

  for (const line of info.documentLines) {
    if (
      line.document_id !== initialLoad.document_id ||
      !pilotProductIds.has(line.product_id)
    ) {
      throw new Error(
        `Guardia activada: línea ajena al piloto detectada (${line.id})`
      );
    }
  }

  for (const lot of info.lots) {
    if (!pilotProductIds.has(lot.product_id)) {
      throw new Error(
        `Guardia activada: lote de producto no piloto detectado (${lot.id})`
      );
    }
  }

  for (const replenishment of info.replenishments) {
    if (!pilotProductIds.has(replenishment.product_id)) {
      throw new Error(
        `Guardia activada: reposición de producto no piloto detectada (${replenishment.id})`
      );
    }
  }

  console.log('\nGUARDIAS PILOTO: APROBADAS');
  console.log('Solo se detectó el conjunto exacto de datos controlados del piloto.');
}

async function resetPilotWorkspace(client, info) {
  const workspaceId = info.workspace.id;
  const productIds = info.products.map(product => product.id);
  const categoryIds = [
    ...new Set(
      info.products
        .map(product => product.category_id)
        .filter(Boolean)
    )
  ];
  const initialDocumentId =
    info.initialLoads[0].document_id;

  await client.query('BEGIN');

  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`pilot-reset:${workspaceId}`]
    );

    await client.query(
      `ALTER TABLE movements
       DISABLE TRIGGER movements_no_update`
    );

    const deleted = {};

    deleted.replenishments = rowCount(
      await client.query(
        `DELETE FROM replenishments
         WHERE workspace_id = $1
           AND product_id = ANY($2::text[])`,
        [workspaceId, productIds]
      )
    );

    deleted.lots = rowCount(
      await client.query(
        `DELETE FROM lots
         WHERE workspace_id = $1
           AND product_id = ANY($2::text[])`,
        [workspaceId, productIds]
      )
    );

    deleted.movements = rowCount(
      await client.query(
        `DELETE FROM movements
         WHERE workspace_id = $1
           AND product_id = ANY($2::text[])`,
        [workspaceId, productIds]
      )
    );

    deleted.documentLines = rowCount(
      await client.query(
        `DELETE FROM document_lines
         WHERE workspace_id = $1
           AND document_id = $2`,
        [workspaceId, initialDocumentId]
      )
    );

    deleted.documents = rowCount(
      await client.query(
        `DELETE FROM documents
         WHERE workspace_id = $1
           AND id = $2`,
        [workspaceId, initialDocumentId]
      )
    );

    deleted.initialLoads = rowCount(
      await client.query(
        `DELETE FROM workspace_initial_loads
         WHERE workspace_id = $1`,
        [workspaceId]
      )
    );

    deleted.products = rowCount(
      await client.query(
        `DELETE FROM products
         WHERE workspace_id = $1
           AND id = ANY($2::text[])`,
        [workspaceId, productIds]
      )
    );

    if (categoryIds.length > 0) {
      deleted.categories = rowCount(
        await client.query(
          `DELETE FROM categories c
           WHERE c.workspace_id = $1
             AND c.id = ANY($2::text[])
             AND NOT EXISTS (
               SELECT 1
               FROM products p
               WHERE p.workspace_id = c.workspace_id
                 AND p.category_id = c.id
             )`,
          [workspaceId, categoryIds]
        )
      );
    } else {
      deleted.categories = 0;
    }

    deleted.syncEvents = rowCount(
      await client.query(
        `DELETE FROM sync_events
         WHERE workspace_id = $1`,
        [workspaceId]
      )
    );

    deleted.auditEvents = rowCount(
      await client.query(
        `DELETE FROM audit_events
         WHERE workspace_id = $1`,
        [workspaceId]
      )
    );

    await client.query(
      `INSERT INTO audit_events (
         workspace_id,
         user_id,
         action,
         entity_type,
         entity_id,
         metadata
       ) VALUES (
         $1,
         NULL,
         'PILOT_RESET',
         'workspace',
         $2,
         $3::jsonb
       )`,
      [
        workspaceId,
        workspaceId,
        JSON.stringify({
          reason: 'Controlled pilot cleanup before real SAINT catalog load',
          removedSaintCodes: expectedPilot.map(item => item.saintCode),
          removedProductCount: productIds.length,
          removedInitialDocumentId: initialDocumentId
        })
      ]
    );

    await client.query(
      `ALTER TABLE movements
       ENABLE TRIGGER movements_no_update`
    );

    await client.query('COMMIT');

    return {
      workspaceKey: info.workspace.workspace_key,
      workspaceId,
      preserved: [
        'workspace',
        'users',
        'workspace_members',
        'locations',
        'suppliers',
        'schema_migrations'
      ],
      deleted,
      auditMarker: 'PILOT_RESET'
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  }
}

function rowCount(result) {
  return Number(result.rowCount || 0);
}

function parseArgs(argv) {
  const result = {
    workspaceKey: null,
    execute: false,
    confirm: null
  };

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];

    if (value === '--workspace-key') {
      result.workspaceKey =
        String(argv[++index] || '').trim() || null;
      continue;
    }

    if (value === '--execute') {
      result.execute = true;
      continue;
    }

    if (value === '--confirm') {
      result.confirm =
        String(argv[++index] || '').trim() || null;
    }
  }

  return result;
}
