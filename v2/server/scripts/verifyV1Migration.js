import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { pool } from '../src/db.js';

const args = parseArgs(
  process.argv.slice(2)
);

const workspaceKey = String(
  args['workspace-key'] ||
  process.env.WORKSPACE_KEY ||
  'establo2026'
).trim();

const outputFile = String(
  args.output ||
  process.env.MIGRATION_PILOT_REPORT ||
  ''
).trim();

if (!workspaceKey) {
  throw new Error('workspace-key requerido');
}

try {
  const workspaceResult = await pool.query(
    `SELECT id, name, workspace_key
     FROM workspaces
     WHERE workspace_key = $1
       AND active = true
     LIMIT 1`,
    [workspaceKey]
  );

  if (workspaceResult.rowCount === 0) {
    const error = new Error(
      `Workspace no encontrado: ${workspaceKey}`
    );
    error.code = 'WORKSPACE_NOT_FOUND';
    throw error;
  }

  const workspace = workspaceResult.rows[0];

  const result = await pool.query(
    `SELECT
       m.id AS movement_id,
       m.product_id,
       p.sku,
       p.name,
       m.delta,
       m.metadata ->> 'legacyProductId'
         AS legacy_product_id,
       NULLIF(
         m.metadata ->> 'targetStock',
         ''
       )::numeric AS target_stock,
       COALESCE(s.stock, 0) AS current_stock,
       m.created_at,
       EXISTS (
         SELECT 1
         FROM movements later
         WHERE later.workspace_id = m.workspace_id
           AND later.product_id = m.product_id
           AND later.location_id
             IS NOT DISTINCT FROM m.location_id
           AND (
             later.created_at > m.created_at
             OR (
               later.created_at = m.created_at
               AND later.id > m.id
             )
           )
       ) AS has_later_movements
     FROM movements m
     JOIN products p
       ON p.workspace_id = m.workspace_id
      AND p.id = m.product_id
     LEFT JOIN inventory_stock s
       ON s.workspace_id = m.workspace_id
      AND s.product_id = m.product_id
      AND s.location_id
        IS NOT DISTINCT FROM m.location_id
     WHERE m.workspace_id = $1
       AND m.type = 'ADJUSTMENT'
       AND m.metadata ->> 'source'
         = 'SMART_INVENTORY_V1'
     ORDER BY p.name, m.created_at`,
    [workspace.id]
  );

  if (result.rowCount === 0) {
    const error = new Error(
      'No se encontraron movimientos de migración V1 en este workspace.'
    );
    error.code = 'V1_MIGRATION_NOT_FOUND';
    throw error;
  }

  const duplicateLegacy = await pool.query(
    `SELECT
       metadata ->> 'legacyProductId'
         AS legacy_product_id,
       COUNT(*)::int AS total
     FROM movements
     WHERE workspace_id = $1
       AND type = 'ADJUSTMENT'
       AND metadata ->> 'source'
         = 'SMART_INVENTORY_V1'
       AND NULLIF(
         metadata ->> 'legacyProductId',
         ''
       ) IS NOT NULL
     GROUP BY metadata ->> 'legacyProductId'
     HAVING COUNT(*) > 1`,
    [workspace.id]
  );

  const errors = [];
  const warnings = [];

  for (const row of result.rows) {
    const target = row.target_stock === null
      ? null
      : Number(row.target_stock);
    const current = Number(
      row.current_stock || 0
    );

    if (
      target === null ||
      !Number.isFinite(target)
    ) {
      errors.push({
        code: 'TARGET_STOCK_MISSING',
        productId: row.product_id,
        name: row.name,
        movementId: row.movement_id
      });
      continue;
    }

    if (row.has_later_movements) {
      warnings.push({
        code: 'POST_MIGRATION_ACTIVITY',
        productId: row.product_id,
        name: row.name,
        targetStock: target,
        currentStock: current
      });
      continue;
    }

    if (
      Math.abs(current - target) >
      0.000001
    ) {
      errors.push({
        code: 'TARGET_STOCK_MISMATCH',
        productId: row.product_id,
        name: row.name,
        targetStock: target,
        currentStock: current
      });
    }
  }

  for (const row of duplicateLegacy.rows) {
    errors.push({
      code: 'DUPLICATE_LEGACY_PRODUCT',
      legacyProductId:
        row.legacy_product_id,
      total: Number(row.total)
    });
  }

  const summary = {
    ok: errors.length === 0,
    workspace: {
      id: workspace.id,
      key: workspace.workspace_key,
      name: workspace.name
    },
    migrationMovements: result.rowCount,
    exactTargetMatches:
      result.rows.filter(
        row => !row.has_later_movements
      ).length -
      errors.filter(
        error =>
          error.code ===
          'TARGET_STOCK_MISMATCH'
      ).length,
    productsWithLaterActivity:
      result.rows.filter(
        row => row.has_later_movements
      ).length,
    errors,
    warnings,
    rows: result.rows.map(row => ({
      movementId: row.movement_id,
      productId: row.product_id,
      sku: row.sku,
      name: row.name,
      legacyProductId:
        row.legacy_product_id,
      delta: Number(row.delta || 0),
      targetStock:
        row.target_stock === null
          ? null
          : Number(row.target_stock),
      currentStock: Number(
        row.current_stock || 0
      ),
      hasLaterMovements:
        Boolean(row.has_later_movements),
      createdAt: row.created_at
    }))
  };

  console.log(
    JSON.stringify(summary, null, 2)
  );

  if (outputFile) {
    await writeFile(
      outputFile,
      JSON.stringify(
        summary,
        null,
        2
      ),
      'utf8'
    );

    console.log(
      `Reporte guardado: ${outputFile}`
    );
  }

  if (!summary.ok) {
    const error = new Error(
      `Verificación de migración falló con ${errors.length} error(es).`
    );
    error.code =
      'V1_MIGRATION_VERIFY_FAILED';
    throw error;
  }

  console.log(
    '✓ Migración V1 verificada en PostgreSQL'
  );
} finally {
  await pool.end();
}

function parseArgs(values) {
  const result = {};

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    const raw = values[index];

    if (!raw.startsWith('--')) continue;

    const key = raw.slice(2);
    const next = values[index + 1];

    if (
      next !== undefined &&
      !next.startsWith('--')
    ) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }

  return result;
}
