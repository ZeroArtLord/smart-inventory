import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const workspaceKey = readArg('--workspace-key') || 'establo2026';
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error('Falta DATABASE_URL');

const BRIDGE_CODE = '344121';
const BRIDGE_NAME = 'REFRESCOS BOTELLA 350ML';

const variants = Object.freeze([
  {
    id: 'prd_bridge_refresco350_7up',
    saintCode: '80147',
    name: 'REFRESCO BOTELLA 7UP 350ML',
    box: 24,
    minStock: 48,
    maxStock: 96
  },
  {
    id: 'prd_bridge_refresco350_chinoto',
    saintCode: 'CHINOTO',
    name: 'REFRESCO BOTELLA CHINOTO 350ML',
    box: null,
    minStock: 0,
    maxStock: 0
  },
  {
    id: 'prd_bridge_refresco350_kola',
    saintCode: '1013161',
    name: 'REFRESCO BOTELLA KOLA 350ML',
    box: 24,
    minStock: 24,
    maxStock: 48
  },
  {
    id: 'prd_bridge_refresco350_naranja',
    saintCode: '1013165',
    name: 'REFRESCO BOTELLA NARANJA 350ML',
    box: 24,
    minStock: 24,
    maxStock: 48
  },
  {
    id: 'prd_bridge_refresco350_pepsi_max',
    saintCode: '1014761',
    name: 'REFRESCO BOTELLA PEPSI MAX 350ML',
    box: 24,
    minStock: 192,
    maxStock: 360
  },
  {
    id: 'prd_bridge_refresco350_uva',
    saintCode: '1013164',
    name: 'REFRESCO BOTELLA UVA 350ML',
    box: 24,
    minStock: 24,
    maxStock: 48
  },
  {
    id: 'prd_bridge_refresco350_cocacola',
    saintCode: 'COCA-COLA',
    name: 'REFRESCO COCA COLA 350CC',
    box: null,
    minStock: 0,
    maxStock: 0
  },
  {
    id: 'prd_bridge_refresco350_frescolita',
    saintCode: '50',
    name: 'REFRESCO FRESCOLITA 350CC',
    box: 24,
    minStock: 0,
    maxStock: 0
  },
  {
    id: 'prd_bridge_refresco350_golden_pina',
    saintCode: '1013162',
    name: 'REFRESCO GOLDEN PIÑA RET 350ML*24UNID',
    box: 24,
    minStock: 24,
    maxStock: 48
  }
]);

const client = new Client({ connectionString });
await client.connect();

try {
  const workspaceResult = await client.query(
    `SELECT id, workspace_key, name
     FROM workspaces
     WHERE workspace_key = $1
       AND active = true`,
    [workspaceKey]
  );
  if (workspaceResult.rowCount !== 1) {
    throw new Error(`Workspace activo no encontrado: ${workspaceKey}`);
  }

  const workspace = workspaceResult.rows[0];
  const categoryResult = await client.query(
    `SELECT id, name
     FROM categories
     WHERE workspace_id = $1
       AND active = true
       AND lower(name) = lower('BEBIDAS')
     LIMIT 2`,
    [workspace.id]
  );
  if (categoryResult.rowCount !== 1) {
    throw new Error('No existe una categoría BEBIDAS única y activa');
  }
  const category = categoryResult.rows[0];

  const sourceResult = await client.query(
    `SELECT *
     FROM products
     WHERE workspace_id = $1
       AND lower(saint_code) = lower($2)`,
    [workspace.id, BRIDGE_CODE]
  );
  if (sourceResult.rowCount !== 1) {
    throw new Error(
      `Se esperaba exactamente un producto fuente SAINT ${BRIDGE_CODE}; encontrados=${sourceResult.rowCount}`
    );
  }
  const source = sourceResult.rows[0];

  const sourceStockResult = await client.query(
    `SELECT COALESCE(SUM(stock), 0)::numeric AS stock
     FROM inventory_stock
     WHERE workspace_id = $1
       AND product_id = $2`,
    [workspace.id, source.id]
  );

  const existingVariants = await client.query(
    `SELECT *,
       (SELECT COUNT(*)::int FROM movements m
        WHERE m.workspace_id = p.workspace_id AND m.product_id = p.id) AS movement_count
     FROM products p
     WHERE workspace_id = $1
       AND lower(saint_code) = ANY($2::text[])`,
    [workspace.id, variants.map(item => item.saintCode.toLowerCase())]
  );
  const existingByCode = new Map(
    existingVariants.rows.map(row => [String(row.saint_code || '').toLowerCase(), row])
  );

  const conflicts = [];
  for (const variant of variants) {
    const existing = existingByCode.get(variant.saintCode.toLowerCase());
    if (!existing) continue;
    const alreadyOurs =
      String(existing.saint_bridge_source_product_id || '') === String(source.id) &&
      String(existing.saint_bridge_code || '') === BRIDGE_CODE;
    if (!alreadyOurs && Number(existing.movement_count || 0) > 0) {
      conflicts.push(
        `${variant.saintCode} ${existing.name}: ya existe con ${existing.movement_count} movimiento(s)`
      );
    } else if (!alreadyOurs) {
      conflicts.push(
        `${variant.saintCode} ${existing.name}: ya existe fuera del puente; requiere revisión manual`
      );
    }
  }

  const preview = {
    mode: apply ? 'APPLY' : 'PREVIEW',
    workspace: {
      id: workspace.id,
      key: workspace.workspace_key,
      name: workspace.name
    },
    category,
    source: {
      id: source.id,
      saintCode: source.saint_code,
      name: source.name,
      active: source.active,
      stock: Number(sourceStockResult.rows[0]?.stock || 0),
      alreadyBridgeSource: source.saint_bridge_source === true
    },
    bridge: {
      code: BRIDGE_CODE,
      name: BRIDGE_NAME,
      variants: variants.map(variant => ({
        ...variant,
        action: existingByCode.has(variant.saintCode.toLowerCase())
          ? 'KEEP/UPDATE BRIDGE'
          : 'CREATE'
      }))
    },
    conflicts
  };

  console.log(JSON.stringify(preview, null, 2));

  if (conflicts.length) {
    throw new Error(
      'Bootstrap bloqueado: existen productos de sabor fuera del puente. No se modificó nada.'
    );
  }

  if (!apply) {
    console.log('\nPREVIEW OK · vuelve a ejecutar con --apply solo después de revisar esta salida.');
    process.exitCode = 0;
  } else {
    await client.query('BEGIN');
    try {
      const now = new Date().toISOString();
      const emitted = [];

      const updatedSourceResult = await client.query(
        `UPDATE products
         SET active = false,
             saint_bridge_source = true,
             saint_bridge_source_product_id = NULL,
             saint_bridge_code = $3,
             saint_bridge_name = $4,
             version = version + 1,
             updated_at = $5
         WHERE workspace_id = $1
           AND id = $2
         RETURNING *`,
        [workspace.id, source.id, BRIDGE_CODE, BRIDGE_NAME, now]
      );
      const updatedSource = updatedSourceResult.rows[0];
      emitted.push({ operation: 'UPDATE', row: updatedSource });

      for (const variant of variants) {
        const existing = existingByCode.get(variant.saintCode.toLowerCase());
        let row;

        if (existing) {
          const result = await client.query(
            `UPDATE products
             SET name = $4,
                 name_normalized = $5,
                 category_id = $6,
                 inventory_unit_id = 'unit_und',
                 purchase_unit_id = $7,
                 purchase_conversion = $8,
                 presentations = $9::jsonb,
                 min_stock = $10,
                 max_stock = $11,
                 replenishment_method = 'BOTH',
                 active = true,
                 saint_bridge_source = false,
                 saint_bridge_source_product_id = $12,
                 saint_bridge_code = $13,
                 saint_bridge_name = $14,
                 version = version + 1,
                 updated_at = $15
             WHERE workspace_id = $1
               AND id = $2
               AND lower(saint_code) = lower($3)
             RETURNING *`,
            [
              workspace.id,
              existing.id,
              variant.saintCode,
              variant.name,
              normalizeSearch(variant.name),
              category.id,
              variant.box ? 'unit_box' : 'unit_und',
              variant.box || 1,
              JSON.stringify(presentationsFor(variant)),
              variant.minStock,
              variant.maxStock,
              source.id,
              BRIDGE_CODE,
              BRIDGE_NAME,
              now
            ]
          );
          row = result.rows[0];
          emitted.push({ operation: 'UPDATE', row });
        } else {
          const result = await client.query(
            `INSERT INTO products (
              workspace_id,id,saint_code,sku,name,name_normalized,aliases,barcode,
              category_id,inventory_unit_id,purchase_unit_id,purchase_conversion,
              presentations,min_stock,max_stock,replenishment_method,
              intelligence_mode,target_days,safety_days,supplier_id,active,
              version,created_at,updated_at,
              saint_bridge_source,saint_bridge_source_product_id,
              saint_bridge_code,saint_bridge_name
             ) VALUES (
              $1,$2,$3,$4,$5,$6,'[]'::jsonb,NULL,$7,'unit_und',$8,$9,$10::jsonb,
              $11,$12,'BOTH','SEED',7,0,NULL,true,1,$13,$13,
              false,$14,$15,$16
             )
             RETURNING *`,
            [
              workspace.id,
              variant.id,
              variant.saintCode,
              smartSku(variant.saintCode),
              variant.name,
              normalizeSearch(variant.name),
              category.id,
              variant.box ? 'unit_box' : 'unit_und',
              variant.box || 1,
              JSON.stringify(presentationsFor(variant)),
              variant.minStock,
              variant.maxStock,
              now,
              source.id,
              BRIDGE_CODE,
              BRIDGE_NAME
            ]
          );
          row = result.rows[0];
          emitted.push({ operation: 'CREATE', row });
        }
      }

      for (const item of emitted) {
        const payload = productPayload(item.row);
        await client.query(
          `INSERT INTO sync_events (
             workspace_id,client_event_id,entity_type,entity_id,operation,payload,user_id
           ) VALUES ($1,$2,'product',$3,$4,$5::jsonb,NULL)`,
          [
            workspace.id,
            `sys_refresco350_${Date.now()}_${item.row.id}_${item.operation.toLowerCase()}`,
            item.row.id,
            item.operation,
            JSON.stringify(payload)
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_events (
           workspace_id,user_id,action,entity_type,entity_id,metadata
         ) VALUES ($1,NULL,'SYSTEM_SAINT_BRIDGE_BOOTSTRAP','product',$2,$3::jsonb)`,
        [
          workspace.id,
          source.id,
          JSON.stringify({
            bridgeCode: BRIDGE_CODE,
            bridgeName: BRIDGE_NAME,
            sourceProductId: source.id,
            preservedSourceStock: Number(sourceStockResult.rows[0]?.stock || 0),
            variants: emitted
              .filter(item => item.row.id !== source.id)
              .map(item => ({
                id: item.row.id,
                saintCode: item.row.saint_code,
                name: item.row.name,
                operation: item.operation
              })),
            safety: 'CATALOG_ONLY_NO_STOCK_MOVEMENTS',
            appliedAt: now
          })
        ]
      );

      await client.query('COMMIT');
      console.log('\n✓ Puente REFRESCOS 350 configurado.');
      console.log('✓ El producto genérico quedó inactivo pero NO fue borrado.');
      console.log('✓ No se creó, modificó ni eliminó ningún movimiento de stock.');
      console.log(`✓ Eventos de sincronización emitidos: ${emitted.length}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}

function readArg(name) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function presentationsFor(variant) {
  if (!variant.box) return [];
  return [{
    id: 'presentation_primary',
    unitId: 'unit_box',
    code: 'CAJA',
    name: 'CAJA',
    conversion: variant.box,
    primary: true,
    active: true
  }];
}

function smartSku(saintCode) {
  return `SM-${String(saintCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function productPayload(row) {
  return {
    id: row.id,
    saintCode: row.saint_code || '',
    sku: row.sku || '',
    name: row.name,
    nameNormalized: row.name_normalized || normalizeSearch(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    barcode: row.barcode || '',
    categoryId: row.category_id || null,
    inventoryUnitId: row.inventory_unit_id || 'unit_und',
    purchaseUnitId: row.purchase_unit_id || row.inventory_unit_id || 'unit_und',
    purchaseConversion: Number(row.purchase_conversion || 1),
    presentations: Array.isArray(row.presentations) ? row.presentations : [],
    minStock: Number(row.min_stock || 0),
    maxStock: Number(row.max_stock || 0),
    replenishmentMethod: row.replenishment_method || 'BOTH',
    intelligenceMode: row.intelligence_mode || 'SEED',
    targetDays: Number(row.target_days || 7),
    safetyDays: Number(row.safety_days || 0),
    supplierId: row.supplier_id || null,
    active: row.active !== false,
    saintBridgeSource: row.saint_bridge_source === true,
    saintBridgeSourceProductId: row.saint_bridge_source_product_id || null,
    saintBridgeCode: row.saint_bridge_code || '',
    saintBridgeName: row.saint_bridge_name || '',
    version: Number(row.version || 1),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
