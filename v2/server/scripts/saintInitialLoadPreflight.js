import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL');
}

const args = parseArgs(process.argv.slice(2));

const client = new Client({
  connectionString: databaseUrl
});

await client.connect();

try {
  const migrations = await client.query(
    `SELECT filename
     FROM schema_migrations
     WHERE filename = ANY($1::text[])`,
    [[
      '010_product_presentations.sql',
      '011_saint_initial_load.sql',
      '012_product_saint_code.sql'
    ]]
  );

  const appliedMigrations = new Set(
    migrations.rows.map(row => row.filename)
  );

  const missingMigrations = [
    '010_product_presentations.sql',
    '011_saint_initial_load.sql',
    '012_product_saint_code.sql'
  ].filter(
    filename =>
      !appliedMigrations.has(filename)
  );

  if (missingMigrations.length) {
    fail(
      'Faltan migraciones requeridas',
      {
        missingMigrations
      }
    );
  }

  const where = [];
  const values = [];

  if (args.workspaceId) {
    values.push(args.workspaceId);
    where.push(
      `w.id = $${values.length}`
    );
  }

  if (args.workspaceKey) {
    values.push(args.workspaceKey);
    where.push(
      `w.workspace_key = $${values.length}`
    );
  }

  const workspaces = await client.query(
    `SELECT
       w.id,
       w.workspace_key,
       w.name,
       w.active,
       (
         SELECT COUNT(*)::int
         FROM products p
         WHERE p.workspace_id = w.id
           AND p.active = true
       ) AS products,
       (
         SELECT COUNT(*)::int
         FROM movements m
         WHERE m.workspace_id = w.id
       ) AS movements,
       (
         SELECT COUNT(*)::int
         FROM workspace_initial_loads l
         WHERE l.workspace_id = w.id
       ) AS initial_loads
     FROM workspaces w
     ${where.length
       ? 'WHERE ' + where.join(' AND ')
       : ''}
     ORDER BY w.name, w.workspace_key`,
    values
  );

  if (workspaces.rowCount === 0) {
    fail(
      'No se encontró ningún workspace con los filtros indicados',
      {
        workspaceId:
          args.workspaceId || null,
        workspaceKey:
          args.workspaceKey || null
      }
    );
  }

  const results =
    workspaces.rows.map(row => {
      const products =
        Number(row.products || 0);
      const movements =
        Number(row.movements || 0);
      const initialLoads =
        Number(row.initial_loads || 0);

      let state;
      let ready = false;

      if (!row.active) {
        state = 'WORKSPACE_INACTIVE';
      } else if (initialLoads > 0) {
        state =
          'INITIAL_LOAD_ALREADY_APPLIED';
      } else if (movements > 0) {
        state =
          'MOVEMENTS_ALREADY_EXIST';
      } else if (products === 0) {
        state =
          'CATALOG_NOT_LOADED';
      } else {
        state =
          'READY_FOR_SAINT_INITIAL_LOAD';
        ready = true;
      }

      return {
        workspaceId: row.id,
        workspaceKey:
          row.workspace_key,
        name: row.name,
        active: row.active,
        products,
        movements,
        initialLoads,
        ready,
        state
      };
    });

  console.log(
    JSON.stringify({
      ok: true,
      requiredMigrations: {
        applied: [
          '010_product_presentations.sql',
          '011_saint_initial_load.sql',
          '012_product_saint_code.sql'
        ],
        missing: []
      },
      workspaces: results
    }, null, 2)
  );

  for (const item of results) {
    const icon = item.ready ? '✓' : '⚠';
    console.log(
      `${icon} ${item.name} [${item.workspaceKey}] · productos=${item.products} · movimientos=${item.movements} · aperturas=${item.initialLoads} · ${item.state}`
    );
  }

  if (
    (args.workspaceId ||
      args.workspaceKey) &&
    !results.every(item => item.ready)
  ) {
    process.exitCode = 2;
  }
} finally {
  await client.end();
}

function parseArgs(argv) {
  const result = {
    workspaceId: null,
    workspaceKey: null
  };

  for (
    let index = 0;
    index < argv.length;
    index++
  ) {
    const value = argv[index];

    if (value === '--workspace-id') {
      result.workspaceId =
        String(argv[++index] || '').trim() ||
        null;
      continue;
    }

    if (value === '--workspace-key') {
      result.workspaceKey =
        String(argv[++index] || '').trim() ||
        null;
    }
  }

  return result;
}

function fail(message, details) {
  const error = new Error(message);
  error.details = details;
  throw error;
}
