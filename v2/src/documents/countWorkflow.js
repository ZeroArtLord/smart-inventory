const PENDING_MODE = 'PENDING';
const CATEGORY_MODE = 'CATEGORY';
const UNCATEGORIZED_ID = '__UNCATEGORIZED__';

export const COUNT_WORKFLOW_MODES = Object.freeze({
  CATEGORY: CATEGORY_MODE,
  PENDING: PENDING_MODE
});

export const COUNT_UNCATEGORIZED_ID = UNCATEGORIZED_ID;

export function normalizeCountWorkflowMetadata(metadata = {}) {
  const source = metadata && typeof metadata === 'object'
    ? metadata
    : {};

  const pendingProductIds = uniqueIds(
    source.countPendingProductIds
  );

  const mode = source.countWorkflowMode === PENDING_MODE
    ? PENDING_MODE
    : CATEGORY_MODE;

  const activeCategoryId = cleanId(
    source.countActiveCategoryId
  );

  return {
    mode,
    activeCategoryId,
    pendingProductIds
  };
}

export function buildCountWorkflowMetadataPatch(currentMetadata = {}, patch = {}) {
  const current = normalizeCountWorkflowMetadata(currentMetadata);
  const next = {
    ...current,
    ...(patch || {})
  };

  return {
    countWorkflowMode:
      next.mode === PENDING_MODE
        ? PENDING_MODE
        : CATEGORY_MODE,
    countActiveCategoryId:
      cleanId(next.activeCategoryId),
    countPendingProductIds:
      uniqueIds(next.pendingProductIds)
  };
}

export function markProductPending(metadata = {}, productId) {
  const workflow = normalizeCountWorkflowMetadata(metadata);
  const id = cleanId(productId);

  if (!id) return buildCountWorkflowMetadataPatch(metadata, workflow);

  return buildCountWorkflowMetadataPatch(metadata, {
    ...workflow,
    pendingProductIds: [
      ...workflow.pendingProductIds,
      id
    ]
  });
}

export function clearProductPending(metadata = {}, productId) {
  const workflow = normalizeCountWorkflowMetadata(metadata);
  const id = cleanId(productId);

  return buildCountWorkflowMetadataPatch(metadata, {
    ...workflow,
    pendingProductIds: workflow.pendingProductIds
      .filter(item => item !== id)
  });
}

export function buildCountCategoryProgress({
  products = [],
  categories = [],
  lines = [],
  metadata = {}
} = {}) {
  const countedIds = new Set(
    (Array.isArray(lines) ? lines : [])
      .map(line => cleanId(line?.productId))
      .filter(Boolean)
  );
  const workflow = normalizeCountWorkflowMetadata(metadata);
  const pendingIds = new Set(workflow.pendingProductIds);
  const categoryById = new Map(
    (Array.isArray(categories) ? categories : [])
      .filter(category => category?.active !== false)
      .map(category => [cleanId(category.id), category])
      .filter(([id]) => Boolean(id))
  );
  const groups = new Map();

  for (const product of activeProducts(products)) {
    const categoryId = cleanId(product?.categoryId) || UNCATEGORIZED_ID;
    const category = categoryById.get(categoryId);
    const group = groups.get(categoryId) || {
      categoryId,
      categoryName:
        category?.name ||
        (categoryId === UNCATEGORIZED_ID
          ? 'SIN CATEGORÍA'
          : 'CATEGORÍA DESCONOCIDA'),
      total: 0,
      counted: 0,
      pending: 0,
      remaining: 0,
      complete: false
    };

    group.total += 1;

    if (countedIds.has(product.id)) {
      group.counted += 1;
    } else if (pendingIds.has(product.id)) {
      group.pending += 1;
    } else {
      group.remaining += 1;
    }

    groups.set(categoryId, group);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      complete: group.total > 0 && group.counted === group.total
    }))
    .sort((a, b) =>
      String(a.categoryName).localeCompare(
        String(b.categoryName),
        'es',
        { sensitivity: 'base' }
      )
    );
}

export function buildCountOverallProgress({
  products = [],
  lines = [],
  metadata = {}
} = {}) {
  const eligible = activeProducts(products);
  const eligibleIds = new Set(
    eligible.map(product => product.id)
  );
  const countedIds = new Set(
    (Array.isArray(lines) ? lines : [])
      .map(line => cleanId(line?.productId))
      .filter(id => eligibleIds.has(id))
  );
  const workflow = normalizeCountWorkflowMetadata(metadata);
  const pending = workflow.pendingProductIds
    .filter(id => eligibleIds.has(id) && !countedIds.has(id));
  const total = eligible.length;
  const counted = countedIds.size;

  return {
    total,
    counted,
    pending: pending.length,
    remaining: Math.max(0, total - counted - pending.length),
    percent: total
      ? Math.round((counted / total) * 100)
      : 0,
    complete: total > 0 && counted === total
  };
}

export function selectNextCountProduct({
  products = [],
  lines = [],
  metadata = {},
  categoryId = null,
  pendingOnly = false
} = {}) {
  const countedIds = new Set(
    (Array.isArray(lines) ? lines : [])
      .map(line => cleanId(line?.productId))
      .filter(Boolean)
  );
  const workflow = normalizeCountWorkflowMetadata(metadata);
  const pendingIds = new Set(workflow.pendingProductIds);
  const targetCategory = cleanId(categoryId);

  return activeProducts(products).find(product => {
    if (countedIds.has(product.id)) return false;

    const productCategoryId =
      cleanId(product.categoryId) ||
      UNCATEGORIZED_ID;

    if (pendingOnly) {
      return pendingIds.has(product.id);
    }

    if (!targetCategory) return false;
    if (productCategoryId !== targetCategory) return false;

    return !pendingIds.has(product.id);
  }) || null;
}

export function countPendingProducts({
  products = [],
  lines = [],
  metadata = {}
} = {}) {
  const workflow = normalizeCountWorkflowMetadata(metadata);
  const countedIds = new Set(
    (Array.isArray(lines) ? lines : [])
      .map(line => cleanId(line?.productId))
      .filter(Boolean)
  );
  const productById = new Map(
    activeProducts(products)
      .map(product => [product.id, product])
  );

  return workflow.pendingProductIds
    .filter(id => !countedIds.has(id))
    .map(id => productById.get(id))
    .filter(Boolean);
}

function activeProducts(products) {
  return (Array.isArray(products) ? products : [])
    .filter(product => product && product.active !== false && cleanId(product.id));
}

function uniqueIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(cleanId)
      .filter(Boolean)
  )];
}

function cleanId(value) {
  return String(value ?? '').trim();
}
