import 'dotenv/config';
import {
  access,
  mkdir,
  readFile
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { getReadiness } from '../src/readiness.js';
import { resolveBackupDir } from './backupUtils.js';

const checks = [];

try {
  assert(
    config.nodeEnv === 'production',
    'NODE_ENV=production',
    config.nodeEnv
  );

  assert(
    config.authMode === 'firebase',
    'AUTH_MODE=firebase',
    config.authMode
  );

  assert(
    config.devAllowHeaderAuth === false,
    'DEV_ALLOW_HEADER_AUTH=false',
    String(config.devAllowHeaderAuth)
  );

  assert(
    Boolean(config.firebaseProjectId),
    'FIREBASE_PROJECT_ID configurado',
    config.firebaseProjectId || 'vacío'
  );

  const credentialPath = String(
    process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  ).trim();

  assert(
    Boolean(credentialPath),
    'GOOGLE_APPLICATION_CREDENTIALS configurado',
    credentialPath || 'vacío'
  );

  if (credentialPath) {
    let credential;

    try {
      const raw = await readFile(
        credentialPath,
        'utf8'
      );
      credential = JSON.parse(raw);

      const hasRequiredFields = Boolean(
        credential?.project_id &&
        credential?.client_email &&
        credential?.private_key
      );

      checks.push({
        check: 'Service account Firebase legible',
        ok: hasRequiredFields,
        detail: hasRequiredFields
          ? credential.client_email
          : 'faltan campos requeridos'
      });

      checks.push({
        check: 'Service account pertenece al proyecto Firebase',
        ok:
          credential?.project_id ===
          config.firebaseProjectId,
        detail:
          credential?.project_id ||
          'project_id ausente'
      });
    } catch (error) {
      checks.push({
        check: 'Service account Firebase legible',
        ok: false,
        detail: error.message
      });
    }
  }

  const database = await pool.query(
    'SELECT current_database() AS database, now() AS now'
  );

  checks.push({
    check: 'PostgreSQL accesible',
    ok: database.rowCount === 1,
    detail: database.rows[0]?.database || 'sin respuesta'
  });

  const readiness = await getReadiness();

  checks.push({
    check: 'Migraciones al día',
    ok: readiness.ok,
    detail: readiness.pending.length
      ? `pendientes: ${readiness.pending.join(', ')}`
      : 'sin pendientes'
  });

  const schema = await pool.query(
    `SELECT
       to_regclass('public.inventory_stock') IS NOT NULL AS stock_view,
       to_regclass('public.audit_events') IS NOT NULL AS audit_table,
       to_regclass('public.uq_movements_single_reversal') IS NOT NULL AS reversal_index`
  );

  const row = schema.rows[0] || {};

  checks.push({
    check: 'Vista inventory_stock',
    ok: row.stock_view === true,
    detail: String(row.stock_view)
  });

  checks.push({
    check: 'Tabla audit_events',
    ok: row.audit_table === true,
    detail: String(row.audit_table)
  });

  checks.push({
    check: 'Índice de reverso único',
    ok: row.reversal_index === true,
    detail: String(row.reversal_index)
  });

  const trigger = await pool.query(
    `SELECT 1
     FROM pg_trigger
     WHERE tgname = 'movements_no_update'
       AND NOT tgisinternal`
  );

  checks.push({
    check: 'Movimientos inmutables',
    ok: trigger.rowCount === 1,
    detail: trigger.rowCount === 1
      ? 'trigger activo'
      : 'trigger faltante'
  });

  const workspaces = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM workspaces
     WHERE active = true`
  );

  checks.push({
    check: 'Workspace activo',
    ok: Number(workspaces.rows[0]?.total || 0) > 0,
    detail: String(workspaces.rows[0]?.total || 0)
  });

  const admins = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM workspace_members
     WHERE active = true
       AND (
         role_code = 'ADMIN'
         OR permissions ? '*'
         OR permissions ? 'users.manage'
       )`
  );

  checks.push({
    check: 'Administrador recuperable',
    ok: Number(admins.rows[0]?.total || 0) > 0,
    detail: String(admins.rows[0]?.total || 0)
  });

  const backupDir = resolveBackupDir(
    process.env.BACKUP_DIR
  );

  await mkdir(backupDir, { recursive: true });
  await access(
    backupDir,
    constants.R_OK | constants.W_OK
  );

  checks.push({
    check: 'Directorio de backup accesible',
    ok: true,
    detail: backupDir
  });

  printChecks(checks);

  const failed = checks.filter(item => !item.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
    throw new Error(
      `Preflight falló: ${failed.map(item => item.check).join(', ')}`
    );
  }

  console.log('✓ Preflight de producción aprobado');
} finally {
  await pool.end();
}

function assert(condition, check, detail) {
  checks.push({
    check,
    ok: Boolean(condition),
    detail: String(detail)
  });
}

function printChecks(items) {
  for (const item of items) {
    const icon = item.ok ? '✓' : '✕';
    console.log(
      `${icon} ${item.check}: ${item.detail}`
    );
  }
}
