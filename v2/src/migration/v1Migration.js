import {
  DEFAULT_UNITS,
  REPLENISHMENT_METHODS,
  normalizeText,
  normalizeSearchText
} from '../core/catalog.js';
import {
  createCategory,
  createSupplier,
  createProduct,
  updateProduct,
  listProducts
} from '../catalog/catalogService.js';
import {
  STORES,
  get,
  getAll,
  put
} from '../storage/database.js';
import {
  createMovement,
  getCurrentStock
} from '../inventory/movementService.js';
import { MOVEMENT_TYPES } from '../core/movementTypes.js';
import { getSyncConfig } from '../sync/syncSettings.js';

const V1_KEYS = Object.freeze({
  PRODUCTS: 'smart_inventory_products',
  HISTORY: 'smart_inventory_history',
  DAILY: 'smart_inventory_daily',
  AUDIT: 'smart_inventory_audit_logs'
});

const MIGRATION_MARKER_KEY = 'migration.v1.completed';
const MIGRATION_ARCHIVE_KEY = 'migration.v1.archive';

export function readV1Snapshot(storage = globalThis.localStorage) {
  if (!storage) {
    return emptySnapshot();
  }

  return {
    products: parseArray(storage.getItem(V1_KEYS.PRODUCTS)),
    history: parseArray(storage.getItem(V1_KEYS.HISTORY)),
    daily: parseArray(storage.getItem(V1_KEYS.DAILY)),
    audit: parseArray(storage.getItem(V1_KEYS.AUDIT))
  };
}

export async function readV1SnapshotWithIndexedDb({
  storage = globalThis.localStorage,
  indexedDb = globalThis.indexedDB
} = {}) {
  const snapshot = readV1Snapshot(storage);

  if (snapshot.products.length > 0 || !indexedDb) {
    return snapshot;
  }

  if (typeof indexedDb.databases === 'function') {
    const databases = await indexedDb.databases();
    const exists = databases.some(
      database => database?.name === 'smart_inventory_db'
    );

    if (!exists) {
      return snapshot;
    }
  } else {
    // Sin forma segura de consultar existencia, no creamos por accidente
    // una base V1 vacía solamente para buscar un respaldo.
    return snapshot;
  }

  const products = await readLegacyProductsFromIndexedDb(
    indexedDb
  );

  return {
    ...snapshot,
    products
  };
}

async function readLegacyProductsFromIndexedDb(indexedDb) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(
      'smart_inventory_db'
    );

    request.onerror = () => reject(
      request.error ||
      new Error('No se pudo abrir IndexedDB V1')
    );

    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('products')) {
        db.close();
        resolve([]);
        return;
      }

      const tx = db.transaction(
        'products',
        'readonly'
      );
      const getAllRequest = tx
        .objectStore('products')
        .getAll();

      getAllRequest.onsuccess = () => {
        const rows = Array.isArray(
          getAllRequest.result
        )
          ? getAllRequest.result
          : [];

        db.close();
        resolve(rows);
      };

      getAllRequest.onerror = () => {
        const error =
          getAllRequest.error ||
          new Error('No se pudo leer products de V1');

        db.close();
        reject(error);
      };
    };
  });
}

export function parseV1ArchiveText(text) {
  let parsed;

  try {
    parsed = JSON.parse(String(text || ''));
  } catch (_) {
    throw new Error('El archivo V1 no contiene JSON válido');
  }

  const snapshot = parsed?.schema === 'smart-inventory-v1-archive'
    ? parsed.snapshot
    : parsed?.snapshot || parsed;

  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('El archivo V1 no contiene un snapshot válido');
  }

  return {
    products: Array.isArray(snapshot.products)
      ? snapshot.products
      : [],
    history: Array.isArray(snapshot.history)
      ? snapshot.history
      : [],
    daily: Array.isArray(snapshot.daily)
      ? snapshot.daily
      : [],
    audit: Array.isArray(snapshot.audit)
      ? snapshot.audit
      : []
  };
}

export function buildV1MigrationPreview(snapshot = emptySnapshot()) {
  const warnings = [];
  const errors = [];
  const rows = [];

  const products = Array.isArray(snapshot.products)
    ? snapshot.products
    : [];

  products.forEach((raw, index) => {
    const excelRow = index + 1;
    const name = normalizeText(raw?.name);

    if (!name) {
      errors.push(`Producto V1 #${excelRow}: nombre vacío`);
      return;
    }

    const currentStock = toNonNegative(
      raw?.currentStock,
      'existencia',
      excelRow,
      errors
    );
    const minStock = toNonNegative(
      raw?.minStock,
      'mínimo',
      excelRow,
      errors
    );
    const maxStock = toNonNegative(
      raw?.maxStock,
      'máximo',
      excelRow,
      errors
    );

    if (
      currentStock === null ||
      minStock === null ||
      maxStock === null
    ) {
      return;
    }

    if (maxStock > 0 && minStock > maxStock) {
      errors.push(
        `${name}: mínimo ${minStock} supera máximo ${maxStock}`
      );
      return;
    }

    const unit = resolveLegacyUnit(raw?.unit);
    if (unit.fallback) {
      warnings.push(
        `${name}: unidad V1 "${normalizeText(raw?.unit) || 'vacía'}" no reconocida; se usará UND.`
      );
    }

    rows.push({
      legacyId: raw?.id ? String(raw.id) : null,
      name,
      nameNormalized: normalizeSearchText(name),
      currentStock,
      minStock,
      maxStock,
      unitId: unit.id,
      unitCode: unit.code,
      categoryName: normalizeText(raw?.category),
      supplierName: normalizeText(raw?.supplier),
      replenishmentMethod: REPLENISHMENT_METHODS.BOTH,
      sourceUpdatedAt: raw?.updatedAt || null
    });
  });

  return {
    rows,
    warnings,
    errors,
    sourceCounts: {
      products: products.length,
      history: Array.isArray(snapshot.history)
        ? snapshot.history.length
        : 0,
      daily: Array.isArray(snapshot.daily)
        ? snapshot.daily.length
        : 0,
      audit: Array.isArray(snapshot.audit)
        ? snapshot.audit.length
        : 0
    },
    snapshot
  };
}

export async function getV1MigrationStatus({
  workspaceId = null
} = {}) {
  const scope = await resolveMigrationScope(
    workspaceId
  );

  const marker = await get(
    STORES.SETTINGS,
    scopedMigrationKey(
      MIGRATION_MARKER_KEY,
      scope
    )
  );

  return marker?.value || null;
}

export async function applyV1Migration(
  preview,
  {
    ownerId,
    workspaceId = null,
    allowAlreadyCompleted = false
  } = {}
) {
  if (!preview?.rows?.length) {
    throw new Error('No hay productos V1 válidos para migrar');
  }

  if (preview.errors?.length) {
    throw new Error(
      'La migración contiene errores; corrígelos antes de aplicar'
    );
  }

  const scope = await resolveMigrationScope(
    workspaceId
  );

  const previous = await getV1MigrationStatus({
    workspaceId: scope
  });
  if (previous && !allowAlreadyCompleted) {
    throw new Error(
      'La migración V1 ya fue completada en este dispositivo'
    );
  }

  const categories = await getAll(STORES.CATEGORIES);
  const suppliers = await getAll(STORES.SUPPLIERS);
  const categoryMap = new Map(
    categories.map(item => [
      normalizeSearchText(item.name),
      item
    ])
  );
  const supplierMap = new Map(
    suppliers.map(item => [
      normalizeSearchText(item.name),
      item
    ])
  );

  let products = await listProducts({
    includeInactive: true
  });
  const productMap = new Map(
    products.map(item => [
      normalizeSearchText(item.name),
      item
    ])
  );

  const result = {
    created: 0,
    updated: 0,
    stockAdjustments: 0,
    categoriesCreated: 0,
    suppliersCreated: 0,
    migratedProducts: []
  };

  for (const row of preview.rows) {
    const categoryId = await ensureCategory(
      row.categoryName,
      categoryMap,
      result
    );
    const supplierId = await ensureSupplier(
      row.supplierName,
      supplierMap,
      result
    );

    let product = productMap.get(row.nameNormalized);

    const patch = {
      name: row.name,
      categoryId,
      inventoryUnitId: row.unitId,
      purchaseUnitId: row.unitId,
      minStock: row.minStock,
      maxStock: row.maxStock,
      replenishmentMethod: row.replenishmentMethod,
      supplierId,
      active: true
    };

    if (product) {
      product = await updateProduct(
        product.id,
        patch
      );
      result.updated += 1;
    } else {
      product = await createProduct(patch);
      productMap.set(row.nameNormalized, product);
      result.created += 1;
    }

    const currentStock = await getCurrentStock(
      product.id
    );
    const delta = roundQuantity(
      row.currentStock - currentStock
    );

    if (Math.abs(delta) > 0.000001) {
      await createMovement({
        id: migrationMovementId(row),
        productId: product.id,
        type: MOVEMENT_TYPES.ADJUSTMENT,
        quantity: 0,
        delta,
        userId: ownerId || null,
        effectiveAt: new Date().toISOString(),
        metadata: {
          reason: 'Migración Smart Inventory V1',
          source: 'SMART_INVENTORY_V1',
          legacyProductId: row.legacyId,
          targetStock: row.currentStock
        }
      });
      result.stockAdjustments += 1;
    }

    result.migratedProducts.push({
      legacyId: row.legacyId,
      productId: product.id,
      name: product.name,
      targetStock: row.currentStock
    });
  }

  const migratedAt = new Date().toISOString();

  await put(STORES.SETTINGS, {
    key: scopedMigrationKey(
      MIGRATION_ARCHIVE_KEY,
      scope
    ),
    value: {
      migratedAt,
      sourceCounts: preview.sourceCounts,
      snapshot: preview.snapshot
    },
    updatedAt: migratedAt
  });

  await put(STORES.SETTINGS, {
    key: scopedMigrationKey(
      MIGRATION_MARKER_KEY,
      scope
    ),
    value: {
      migratedAt,
      ...result,
      sourceCounts: preview.sourceCounts
    },
    updatedAt: migratedAt
  });

  return {
    migratedAt,
    ...result,
    sourceCounts: preview.sourceCounts
  };
}

export function serializeV1Archive(snapshot) {
  return JSON.stringify({
    schema: 'smart-inventory-v1-archive',
    exportedAt: new Date().toISOString(),
    snapshot: snapshot || emptySnapshot()
  }, null, 2);
}

async function resolveMigrationScope(
  workspaceId
) {
  const explicit = String(
    workspaceId || ''
  ).trim();

  if (explicit) return explicit;

  const config = await getSyncConfig();
  return String(
    config.workspaceId || 'unbound'
  ).trim() || 'unbound';
}

function scopedMigrationKey(
  baseKey,
  workspaceId
) {
  return `${baseKey}:${workspaceId}`;
}

function parseArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function emptySnapshot() {
  return {
    products: [],
    history: [],
    daily: [],
    audit: []
  };
}

function toNonNegative(
  value,
  label,
  row,
  errors
) {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number) || number < 0) {
    errors.push(
      `Producto V1 #${row}: ${label} inválido`
    );
    return null;
  }

  return roundQuantity(number);
}

function resolveLegacyUnit(value) {
  const normalized = normalizeSearchText(value);

  const aliases = new Map([
    ['und', 'UND'],
    ['unidad', 'UND'],
    ['unidades', 'UND'],
    ['u', 'UND'],
    ['kg', 'KG'],
    ['kilo', 'KG'],
    ['kilos', 'KG'],
    ['kilogramo', 'KG'],
    ['kilogramos', 'KG'],
    ['lt', 'LT'],
    ['l', 'LT'],
    ['litro', 'LT'],
    ['litros', 'LT'],
    ['caja', 'CAJA'],
    ['cajas', 'CAJA'],
    ['bulto', 'BULTO'],
    ['bultos', 'BULTO']
  ]);

  const code = aliases.get(normalized) || 'UND';
  const unit = DEFAULT_UNITS.find(
    item => item.code === code
  ) || DEFAULT_UNITS[0];

  return {
    ...unit,
    fallback:
      Boolean(normalized) &&
      !aliases.has(normalized)
  };
}

async function ensureCategory(
  name,
  map,
  result
) {
  const clean = normalizeText(name);
  if (!clean) return null;

  const key = normalizeSearchText(clean);
  const existing = map.get(key);
  if (existing) return existing.id;

  const created = await createCategory(clean);
  map.set(key, created);
  result.categoriesCreated += 1;
  return created.id;
}

async function ensureSupplier(
  name,
  map,
  result
) {
  const clean = normalizeText(name);
  if (!clean) return null;

  const key = normalizeSearchText(clean);
  const existing = map.get(key);
  if (existing) return existing.id;

  const created = await createSupplier({
    name: clean
  });
  map.set(key, created);
  result.suppliersCreated += 1;
  return created.id;
}

function roundQuantity(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 1000000
  ) / 1000000;
}


function migrationMovementId(row) {
  const source = [
    row.legacyId || '',
    row.nameNormalized || ''
  ].join('|');

  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `mov_v1_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
