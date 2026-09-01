import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Client } = pg;

const baseUrl =
  process.env.SMOKE_BASE_URL ||
  'http://127.0.0.1:5190';

const databaseUrl = process.env.DATABASE_URL;
const stateFile = String(
  process.env.SMOKE_STATE_FILE || ''
).trim();

if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL');
}

if (!stateFile) {
  throw new Error(
    'Falta SMOKE_STATE_FILE para verificar reinicio'
  );
}

const state = JSON.parse(
  await readFile(stateFile, 'utf8')
);

const readyResponse = await fetch(
  `${baseUrl}/ready`
);
const ready = await readyResponse.json();

if (!readyResponse.ok || ready?.ok !== true) {
  throw new Error(
    `Servidor no quedó listo tras reinicio: ${JSON.stringify(ready)}`
  );
}

const db = new Client({
  connectionString: databaseUrl
});
await db.connect();

try {
  await assertStock(
    db,
    state.workspaceId,
    state.productId,
    state.expectedStock
  );

  await assertStock(
    db,
    state.workspaceId,
    state.concurrentProductId,
    state.concurrentExpectedStock
  );

  const movementCount = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM movements
     WHERE workspace_id = $1`,
    [state.workspaceId]
  );

  if (Number(movementCount.rows[0]?.total || 0) < 5) {
    throw new Error(
      'Los movimientos del smoke no persistieron tras reinicio.'
    );
  }

  const auditCount = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM audit_events
     WHERE workspace_id = $1`,
    [state.workspaceId]
  );

  if (Number(auditCount.rows[0]?.total || 0) < 1) {
    throw new Error(
      'La auditoría no persistió tras reinicio.'
    );
  }

  console.log(
    '✓ restart smoke: stock, movimientos y auditoría persistieron'
  );
} finally {
  await db.end();
}

async function assertStock(
  client,
  workspaceId,
  productId,
  expected
) {
  const result = await client.query(
    `SELECT stock
     FROM inventory_stock
     WHERE workspace_id = $1
       AND product_id = $2
       AND location_id IS NULL`,
    [workspaceId, productId]
  );

  const stock = result.rowCount
    ? Number(result.rows[0].stock)
    : 0;

  if (Math.abs(stock - expected) > 0.000001) {
    throw new Error(
      `Stock no persistió. Esperado ${expected}, recibido ${stock}.`
    );
  }
}
