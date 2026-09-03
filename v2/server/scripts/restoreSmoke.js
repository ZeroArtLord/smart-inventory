import 'dotenv/config';
import pg from 'pg';
import { spawn } from 'node:child_process';
import {
  parsePostgresUrl,
  resolveBackupDir,
  findNewestBackup
} from './backupUtils.js';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL');
}

const db = parsePostgresUrl(databaseUrl);
const backupDir = resolveBackupDir(
  process.env.BACKUP_DIR
);
const backupFile = process.argv[2] ||
  await findNewestBackup(backupDir);

const executable =
  process.env.PG_RESTORE_PATH ||
  'pg_restore';

const restoreDatabase =
  `smart_inventory_restore_${Date.now()
    .toString(36)
    .replace(/[^a-z0-9_]/gi, '')}`
    .slice(0, 60);

const admin = new Client({
  host: db.host,
  port: Number(db.port),
  user: db.user,
  password: db.password,
  database: 'postgres'
});

const original = new Client({
  connectionString: databaseUrl
});

let restored = null;

await admin.connect();
await original.connect();

try {
  await admin.query(
    `CREATE DATABASE "${restoreDatabase}"`
  );

  await run(executable, [
    '--no-owner',
    '--no-privileges',
    '--host',
    db.host,
    '--port',
    db.port,
    '--username',
    db.user,
    '--dbname',
    restoreDatabase,
    backupFile
  ], {
    ...process.env,
    PGPASSWORD: db.password
  });

  restored = new Client({
    host: db.host,
    port: Number(db.port),
    user: db.user,
    password: db.password,
    database: restoreDatabase
  });

  await restored.connect();

  const originalSummary =
    await databaseSummary(original);

  const restoredSummary =
    await databaseSummary(restored);

  for (const [key, expected] of Object.entries(
    originalSummary
  )) {
    const actual = restoredSummary[key];

    if (actual !== expected) {
      throw new Error(
        `Restore inconsistente en ${key}: esperado ${expected}, restaurado ${actual}`
      );
    }
  }

  const restoredReadiness = await restored.query(
    `SELECT
       to_regclass('public.inventory_stock') IS NOT NULL AS stock_view,
       to_regclass('public.audit_events') IS NOT NULL AS audit_table,
       to_regclass('public.schema_migrations') IS NOT NULL AS migration_table`
  );

  const row = restoredReadiness.rows[0] || {};

  if (
    row.stock_view !== true ||
    row.audit_table !== true ||
    row.migration_table !== true
  ) {
    throw new Error(
      'El restore no contiene la estructura crítica esperada.'
    );
  }

  console.log(
    `✓ restore smoke: ${backupFile} restauró correctamente en ${restoreDatabase}`
  );
  console.log(
    JSON.stringify(restoredSummary)
  );
} finally {
  if (restored) {
    await restored.end().catch(() => {});
  }

  await original.end().catch(() => {});

  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1
       AND pid <> pg_backend_pid()`,
    [restoreDatabase]
  ).catch(() => {});

  await admin.query(
    `DROP DATABASE IF EXISTS "${restoreDatabase}"`
  ).catch(() => {});

  await admin.end().catch(() => {});
}

async function databaseSummary(client) {
  const result = await client.query(
    `SELECT
      (SELECT COUNT(*)::bigint FROM workspaces) AS workspaces,
      (SELECT COUNT(*)::bigint FROM users) AS users,
      (SELECT COUNT(*)::bigint FROM workspace_members) AS workspace_members,
      (SELECT COUNT(*)::bigint FROM products) AS products,
      (SELECT COUNT(*)::bigint FROM documents) AS documents,
      (SELECT COUNT(*)::bigint FROM document_lines) AS document_lines,
      (SELECT COUNT(*)::bigint FROM movements) AS movements,
      (SELECT COUNT(*)::bigint FROM lots) AS lots,
      (SELECT COUNT(*)::bigint FROM replenishments) AS replenishments,
      (SELECT COUNT(*)::bigint FROM sync_events) AS sync_events,
      (SELECT COUNT(*)::bigint FROM audit_events) AS audit_events,
      (SELECT COUNT(*)::bigint FROM workspace_initial_loads) AS workspace_initial_loads,
      (SELECT COUNT(*)::bigint FROM schema_migrations) AS schema_migrations`
  );

  const row = result.rows[0] || {};
  return Object.fromEntries(
    Object.entries(row).map(
      ([key, value]) => [
        key,
        Number(value || 0)
      ]
    )
  );
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      args,
      {
        env,
        stdio: [
          'ignore',
          'inherit',
          'inherit'
        ],
        windowsHide: true
      }
    );

    child.on('error', error => {
      reject(new Error(
        `No se pudo ejecutar ${command}: ${error.message}`
      ));
    });

    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `${command} terminó con código ${code}`
      ));
    });
  });
}
