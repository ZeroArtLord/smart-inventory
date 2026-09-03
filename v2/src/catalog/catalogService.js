import { createLocalId } from '../core/ids.js';
import {
  REPLENISHMENT_METHODS,
  DEFAULT_UNITS,
  buildSmartSkuFromSaintCode,
  normalizeText,
  normalizeSearchText,
  assertNonNegativeNumber
} from '../core/catalog.js';
import {
  STORES,
  get,
  getAll,
  getAllByIndex,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import {
  initialEntityVersion,
  nextEntityVersion
} from '../core/versioning.js';
import {
  deriveLegacyPurchaseFields,
  normalizePresentations
} from './presentationModel.js';

export async function seedDefaultUnits() {
  const existing = await getAll(STORES.UNITS);
  if (existing.length > 0) return existing;

  await runTransaction(STORES.UNITS, 'readwrite', store => {
    DEFAULT_UNITS.forEach(unit => store.put(unit));
  });

  return DEFAULT_UNITS;
}

export async function createCategory(name) {
  const cleanName = normalizeText(name);
  if (!cleanName) throw new Error('La categoría requiere nombre');

  const now = new Date().toISOString();
  const category = {
    id: createLocalId('cat'),
    name: cleanName,
    nameNormalized: normalizeSearchText(cleanName),
    active: true,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeEntityWithSync(STORES.CATEGORIES, 'category', category, 'CREATE');
  return category;
}

export async function createSupplier(data = {}) {
  const name = normalizeText(data.name);
  if (!name) throw new Error('El proveedor requiere nombre');

  const now = new Date().toISOString();
  const supplier = {
    id: createLocalId('sup'),
    name,
    nameNormalized: normalizeSearchText(name),
    phone: normalizeText(data.phone),
    email: normalizeText(data.email),
    notes: normalizeText(data.notes),
    active: true,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeEntityWithSync(STORES.SUPPLIERS, 'supplier', supplier, 'CREATE');
  return supplier;
}

export async function createLocation(name) {
  const cleanName = normalizeText(name);
  if (!cleanName) throw new Error('La ubicación requiere nombre');

  const now = new Date().toISOString();
  const location = {
    id: createLocalId('loc'),
    name: cleanName,
    nameNormalized: normalizeSearchText(cleanName),
    active: true,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeEntityWithSync(STORES.LOCATIONS, 'location', location, 'CREATE');
  return location;
}

export async function createProduct(data = {}) {
  const name = normalizeText(data.name);
  if (!name) throw new Error('El producto requiere nombre');

  const minStock = assertNonNegativeNumber(data.minStock ?? 0, 'Stock mínimo');
  const maxStock = assertNonNegativeNumber(data.maxStock ?? 0, 'Stock máximo');
  if (maxStock > 0 && minStock > maxStock) {
    throw new Error('El stock mínimo no puede superar el stock máximo');
  }

  const method = data.replenishmentMethod || REPLENISHMENT_METHODS.BOTH;
  if (!Object.values(REPLENISHMENT_METHODS).includes(method)) {
    throw new Error('Método de reposición inválido');
  }

  const saintCode =
    normalizeText(
      data.saintCode
    );
  const sku =
    normalizeText(data.sku) ||
    buildSmartSkuFromSaintCode(
      saintCode
    );

  const inventoryUnitId = data.inventoryUnitId || 'unit_und';
  const presentations = normalizePresentations(
    data.presentations,
    {
      inventoryUnitId,
      purchaseUnitId: data.purchaseUnitId,
      purchaseConversion: data.purchaseConversion
    }
  );
  const legacyPurchase = deriveLegacyPurchaseFields(
    presentations,
    inventoryUnitId
  );

  await assertProductIdentityAvailable({
    saintCode,
    sku
  });

  const now = new Date().toISOString();
  const product = {
    id: data.id || createLocalId('prd'),
    saintCode,
    sku,
    name,
    nameNormalized: normalizeSearchText(name),
    aliases: Array.isArray(data.aliases)
      ? data.aliases.map(normalizeText).filter(Boolean)
      : [],
    barcode: normalizeText(data.barcode),
    categoryId: data.categoryId || null,
    inventoryUnitId,
    purchaseUnitId: legacyPurchase.purchaseUnitId,
    purchaseConversion: legacyPurchase.purchaseConversion,
    presentations,
    minStock,
    maxStock,
    replenishmentMethod: method,
    supplierId: data.supplierId || null,
    active: data.active !== false,
    version: initialEntityVersion(),
    createdAt: now,
    updatedAt: now
  };

  await writeEntityWithSync(STORES.PRODUCTS, 'product', product, 'CREATE');
  return product;
}

export async function updateProduct(productId, patch = {}) {
  const current = await get(STORES.PRODUCTS, productId);
  if (!current) throw new Error('Producto no encontrado');

  if (
    patch.inventoryUnitId !== undefined &&
    patch.inventoryUnitId !== current.inventoryUnitId
  ) {
    const movements = await getAllByIndex(
      STORES.MOVEMENTS,
      'productId',
      productId
    );

    if (movements.length > 0) {
      const error = new Error(
        'La unidad base no puede cambiarse porque el producto ya tiene movimientos'
      );
      error.code = 'BASE_UNIT_LOCKED';
      throw error;
    }
  }

  const next = {
    ...current,
    ...patch,
    id: current.id,
    version: nextEntityVersion(current),
    updatedAt: new Date().toISOString()
  };

  if (patch.name !== undefined) {
    next.name = normalizeText(patch.name);
    if (!next.name) throw new Error('El producto requiere nombre');
    next.nameNormalized = normalizeSearchText(next.name);
  }

  if (patch.aliases !== undefined) {
    next.aliases = Array.isArray(patch.aliases)
      ? patch.aliases.map(normalizeText).filter(Boolean)
      : [];
  }

  if (patch.saintCode !== undefined) {
    next.saintCode =
      normalizeText(
        patch.saintCode
      );
  }
  if (patch.sku !== undefined) {
    next.sku = normalizeText(patch.sku);
  }
  if (
    !next.sku &&
    next.saintCode
  ) {
    next.sku =
      buildSmartSkuFromSaintCode(
        next.saintCode
      );
  }
  if (patch.barcode !== undefined) next.barcode = normalizeText(patch.barcode);

  if (patch.minStock !== undefined) {
    next.minStock = assertNonNegativeNumber(patch.minStock, 'Stock mínimo');
  }
  if (patch.maxStock !== undefined) {
    next.maxStock = assertNonNegativeNumber(patch.maxStock, 'Stock máximo');
  }
  if (next.maxStock > 0 && next.minStock > next.maxStock) {
    throw new Error('El stock mínimo no puede superar el stock máximo');
  }

  if (
    next.replenishmentMethod &&
    !Object.values(REPLENISHMENT_METHODS).includes(next.replenishmentMethod)
  ) {
    throw new Error('Método de reposición inválido');
  }

  if (
    patch.presentations !== undefined ||
    patch.inventoryUnitId !== undefined ||
    patch.purchaseUnitId !== undefined ||
    patch.purchaseConversion !== undefined
  ) {
    const inventoryUnitId = next.inventoryUnitId || 'unit_und';
    const legacyFieldsChanged =
      patch.purchaseUnitId !== undefined ||
      patch.purchaseConversion !== undefined;

    const presentationSource =
      patch.presentations !== undefined
        ? patch.presentations
        : legacyFieldsChanged
          ? []
          : current.presentations;

    next.presentations = normalizePresentations(
      presentationSource,
      {
        inventoryUnitId,
        purchaseUnitId: next.purchaseUnitId,
        purchaseConversion: next.purchaseConversion
      }
    );

    const legacyPurchase = deriveLegacyPurchaseFields(
      next.presentations,
      inventoryUnitId
    );

    next.purchaseUnitId = legacyPurchase.purchaseUnitId;
    next.purchaseConversion = legacyPurchase.purchaseConversion;
  } else if (!Array.isArray(next.presentations)) {
    next.presentations = normalizePresentations(
      [],
      {
        inventoryUnitId: next.inventoryUnitId,
        purchaseUnitId: next.purchaseUnitId,
        purchaseConversion: next.purchaseConversion
      }
    );
  }

  await assertProductIdentityAvailable({
    productId,
    saintCode: next.saintCode,
    sku: next.sku
  });

  await writeEntityWithSync(STORES.PRODUCTS, 'product', next, 'UPDATE');
  return next;
}

export async function listProducts({ includeInactive = false } = {}) {
  const products = await getAll(STORES.PRODUCTS);
  return products
    .filter(product => includeInactive || product.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function searchProducts(query, { limit = 30 } = {}) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  const products = await listProducts();

  if (terms.length === 0) return products.slice(0, limit);

  const matches = products.filter(product => {
    const haystack = [
      product.nameNormalized,
      normalizeSearchText(product.saintCode),
      normalizeSearchText(product.sku),
      normalizeSearchText(product.barcode),
      ...(product.aliases || []).map(normalizeSearchText)
    ].join(' ');

    return terms.every(term => haystack.includes(term));
  });

  return matches.slice(0, limit);
}

async function assertProductIdentityAvailable({
  productId = null,
  saintCode = '',
  sku = ''
} = {}) {
  const normalizedSaintCode =
    normalizeSearchText(saintCode);
  const normalizedSku =
    normalizeSearchText(sku);

  if (
    !normalizedSaintCode &&
    !normalizedSku
  ) {
    return;
  }

  const products =
    await getAll(STORES.PRODUCTS);

  for (const product of products) {
    if (
      productId &&
      product.id === productId
    ) {
      continue;
    }

    if (
      normalizedSaintCode &&
      normalizeSearchText(
        product.saintCode
      ) === normalizedSaintCode
    ) {
      const error = new Error(
        `El Código SAINT "${saintCode}" ya pertenece a otro producto`
      );
      error.code =
        'SAINT_CODE_DUPLICATE';
      throw error;
    }

    if (
      normalizedSku &&
      normalizeSearchText(
        product.sku
      ) === normalizedSku
    ) {
      const error = new Error(
        `El SKU Smart "${sku}" ya pertenece a otro producto`
      );
      error.code =
        'SMART_SKU_DUPLICATE';
      throw error;
    }
  }
}

async function writeEntityWithSync(storeName, entityType, entity, operation) {
  const now = new Date().toISOString();
  const syncItem = {
    id: createLocalId('sync'),
    entityType,
    entityId: entity.id,
    operation,
    payload: entity,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null
  };

  await runTransaction(
    [storeName, STORES.SYNC_QUEUE],
    'readwrite',
    async (entityStore, queueStore) => {
      await requestToPromise(entityStore.put(entity));
      await requestToPromise(queueStore.add(syncItem));
    }
  );
}

