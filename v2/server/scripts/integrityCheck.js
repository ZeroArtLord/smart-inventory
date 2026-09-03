import 'dotenv/config';
import { pool } from '../src/db.js';

const checks = [
  {
    code: 'NEGATIVE_STOCK',
    label: 'Stock negativo',
    sql: `SELECT COUNT(*)::int AS total
          FROM inventory_stock
          WHERE stock < -0.000001`
  },
  {
    code: 'INVALID_PRODUCT_LIMITS',
    label: 'Mínimos/máximos inválidos',
    sql: `SELECT COUNT(*)::int AS total
          FROM products
          WHERE min_stock < 0
             OR max_stock < 0
             OR (
               max_stock > 0
               AND min_stock > max_stock
             )`
  },
  {
    code: 'INVALID_LOT_QUANTITIES',
    label: 'Cantidades de lote inválidas',
    sql: `SELECT COUNT(*)::int AS total
          FROM lots
          WHERE original_quantity < 0
             OR remaining_quantity < -0.000001
             OR remaining_quantity >
                original_quantity + 0.000001`
  },
  {
    code: 'ORPHAN_DOCUMENT_LINES',
    label: 'Líneas huérfanas',
    sql: `SELECT COUNT(*)::int AS total
          FROM document_lines dl
          LEFT JOIN documents d
            ON d.workspace_id = dl.workspace_id
           AND d.id = dl.document_id
          LEFT JOIN products p
            ON p.workspace_id = dl.workspace_id
           AND p.id = dl.product_id
          WHERE d.id IS NULL
             OR p.id IS NULL`
  },
  {
    code: 'ORPHAN_MOVEMENT_PRODUCT',
    label: 'Movimientos sin producto',
    sql: `SELECT COUNT(*)::int AS total
          FROM movements m
          LEFT JOIN products p
            ON p.workspace_id = m.workspace_id
           AND p.id = m.product_id
          WHERE p.id IS NULL`
  },
  {
    code: 'ORPHAN_MOVEMENT_DOCUMENT',
    label: 'Movimientos con documento inexistente',
    sql: `SELECT COUNT(*)::int AS total
          FROM movements m
          LEFT JOIN documents d
            ON d.workspace_id = m.workspace_id
           AND d.id = m.document_id
          WHERE m.document_id IS NOT NULL
            AND d.id IS NULL`
  },
  {
    code: 'ORPHAN_MOVEMENT_LOT',
    label: 'Movimientos con lote inexistente',
    sql: `SELECT COUNT(*)::int AS total
          FROM movements m
          LEFT JOIN lots l
            ON l.workspace_id = m.workspace_id
           AND l.id = m.lot_id
          WHERE m.lot_id IS NOT NULL
            AND l.id IS NULL`
  },
  {
    code: 'DUPLICATE_REVERSALS',
    label: 'Movimientos reversados más de una vez',
    sql: `SELECT COUNT(*)::int AS total
          FROM (
            SELECT workspace_id, reversed_movement_id
            FROM movements
            WHERE reversed_movement_id IS NOT NULL
            GROUP BY workspace_id, reversed_movement_id
            HAVING COUNT(*) > 1
          ) q`
  },
  {
    code: 'REVERSAL_TARGET_MISSING',
    label: 'Reversos sin movimiento original',
    sql: `SELECT COUNT(*)::int AS total
          FROM movements r
          LEFT JOIN movements o
            ON o.workspace_id = r.workspace_id
           AND o.id = r.reversed_movement_id
          WHERE r.type = 'REVERSAL'
            AND (
              r.reversed_movement_id IS NULL
              OR o.id IS NULL
            )`
  },
  {
    code: 'REVERSAL_DELTA_MISMATCH',
    label: 'Reversos que no compensan exactamente',
    sql: `SELECT COUNT(*)::int AS total
          FROM movements r
          JOIN movements o
            ON o.workspace_id = r.workspace_id
           AND o.id = r.reversed_movement_id
          WHERE r.type = 'REVERSAL'
            AND ABS(
              COALESCE(r.delta, 0) +
              CASE
                WHEN o.type = 'ENTRY'
                  THEN o.quantity
                WHEN o.type = 'SUPPLY'
                  THEN -o.quantity
                WHEN o.type IN (
                  'ADJUSTMENT',
                  'REVERSAL'
                )
                  THEN COALESCE(o.delta, 0)
                ELSE 0
              END
            ) > 0.000001`
  },
  {
    code: 'DOCUMENT_MOVEMENT_TYPE_MISMATCH',
    label: 'Movimiento incompatible con documento',
    sql: `SELECT COUNT(*)::int AS total
          FROM movements m
          JOIN documents d
            ON d.workspace_id = m.workspace_id
           AND d.id = m.document_id
          WHERE
            (m.type = 'ENTRY' AND d.type <> 'ENTRY')
            OR
            (m.type = 'SUPPLY' AND d.type <> 'SUPPLY')
            OR
            (
              m.type = 'ADJUSTMENT'
              AND d.type NOT IN (
                'COUNT',
                'ADJUSTMENT'
              )
            )`
  },
  {
    code: 'INITIAL_LOAD_ORPHAN_DOCUMENT',
    label: 'Carga inicial SAINT sin documento válido',
    sql: `SELECT COUNT(*)::int AS total
          FROM workspace_initial_loads w
          LEFT JOIN documents d
            ON d.workspace_id = w.workspace_id
           AND d.id = w.document_id
          WHERE d.id IS NULL
             OR d.type <> 'ADJUSTMENT'
             OR d.status <> 'CLOSED'
             OR d.metadata->>'kind' <> 'SAINT_INITIAL_LOAD'`
  },
  {
    code: 'INITIAL_LOAD_MOVEMENT_MISMATCH',
    label: 'Carga inicial SAINT con movimientos inconsistentes',
    sql: `SELECT COUNT(*)::int AS total
          FROM workspace_initial_loads w
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS total
            FROM movements m
            WHERE m.workspace_id = w.workspace_id
              AND m.metadata->>'kind' = 'SAINT_INITIAL_LOAD'
              AND m.metadata->>'initialLoadId' = w.run_id
          ) q ON true
          WHERE COALESCE(q.total, 0) <> w.positive_stock_count`
  },
  {
    code: 'CLOSED_EMPTY_DOCUMENT',
    label: 'Documentos cerrados sin líneas',
    sql: `SELECT COUNT(*)::int AS total
          FROM documents d
          LEFT JOIN document_lines dl
            ON dl.workspace_id = d.workspace_id
           AND dl.document_id = d.id
          WHERE d.status IN (
            'CLOSED',
            'VERIFIED',
            'READY_FOR_SAINT',
            'SENT_TO_SAINT',
            'SAINT_PENDING',
            'POSTED'
          )
          GROUP BY d.workspace_id, d.id
          HAVING COUNT(dl.id) = 0`,
    aggregateRows: true
  }
];

const warnings = [
  {
    code: 'DUPLICATE_SKU',
    label: 'SKU duplicado dentro de workspace',
    sql: `SELECT COUNT(*)::int AS total
          FROM (
            SELECT workspace_id, lower(sku)
            FROM products
            WHERE NULLIF(trim(sku), '') IS NOT NULL
            GROUP BY workspace_id, lower(sku)
            HAVING COUNT(*) > 1
          ) q`
  },
  {
    code: 'DUPLICATE_BARCODE',
    label: 'Código de barras duplicado dentro de workspace',
    sql: `SELECT COUNT(*)::int AS total
          FROM (
            SELECT workspace_id, barcode
            FROM products
            WHERE NULLIF(trim(barcode), '') IS NOT NULL
            GROUP BY workspace_id, barcode
            HAVING COUNT(*) > 1
          ) q`
  },
  {
    code: 'DRAFT_WITH_MOVEMENTS',
    label: 'Borradores que ya tienen movimientos',
    sql: `SELECT COUNT(*)::int AS total
          FROM (
            SELECT d.workspace_id, d.id
            FROM documents d
            JOIN movements m
              ON m.workspace_id = d.workspace_id
             AND m.document_id = d.id
            WHERE d.status = 'DRAFT'
            GROUP BY d.workspace_id, d.id
          ) q`
  }
];

try {
  const errors = await runChecks(
    checks,
    'ERROR'
  );

  const warningResults = await runChecks(
    warnings,
    'WARN'
  );

  console.log(
    JSON.stringify({
      ok: errors.every(item => item.total === 0),
      errors,
      warnings: warningResults
    }, null, 2)
  );

  const failed = errors.filter(
    item => item.total > 0
  );

  if (failed.length > 0) {
    const error = new Error(
      `Integridad fallida: ${failed
        .map(item =>
          `${item.code}=${item.total}`
        )
        .join(', ')}`
    );

    error.code = 'INTEGRITY_CHECK_FAILED';
    throw error;
  }

  console.log(
    '✓ Integridad PostgreSQL verificada'
  );
} finally {
  await pool.end();
}

async function runChecks(
  definitions,
  severity
) {
  const results = [];

  for (const definition of definitions) {
    const result = await pool.query(
      definition.sql
    );

    const total = definition.aggregateRows
      ? result.rowCount
      : Number(result.rows[0]?.total || 0);

    const item = {
      severity,
      code: definition.code,
      label: definition.label,
      total
    };

    results.push(item);

    const icon = total > 0
      ? severity === 'ERROR'
        ? '✕'
        : '⚠'
      : '✓';

    console.log(
      `${icon} [${severity}] ${definition.label}: ${total}`
    );
  }

  return results;
}
