export const SAINT_BRIDGE_RECLASSIFICATION_KIND =
  'SAINT_BRIDGE_RECLASSIFICATION';

export function isSaintBridgeSource(product) {
  return Boolean(
    product &&
    product.saintBridgeSource === true
  );
}

export function isSaintBridgeVariant(product) {
  return Boolean(
    product &&
    clean(product.saintBridgeSourceProductId) &&
    clean(product.saintBridgeCode)
  );
}

export function effectiveSaintCode(product) {
  return clean(product?.saintBridgeCode) || clean(product?.saintCode);
}

export function effectiveSaintName(product) {
  return clean(product?.saintBridgeName) || clean(product?.name);
}

export function buildSaintBridgeGroups(products = []) {
  const sourceById = new Map(
    source(products)
      .filter(isSaintBridgeSource)
      .map(product => [clean(product.id), product])
  );
  const groups = new Map();

  for (const product of source(products)) {
    if (!isSaintBridgeVariant(product)) continue;

    const sourceProductId = clean(product.saintBridgeSourceProductId);
    const bridgeCode = effectiveSaintCode(product);
    const key = `${sourceProductId}::${bridgeCode}`;
    const current = groups.get(key) || {
      key,
      sourceProductId,
      sourceProduct: sourceById.get(sourceProductId) || null,
      saintCode: bridgeCode,
      name:
        clean(product.saintBridgeName) ||
        clean(sourceById.get(sourceProductId)?.name) ||
        bridgeCode,
      variants: []
    };

    current.variants.push(product);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      variants: group.variants
        .slice()
        .sort((a, b) =>
          clean(a.name).localeCompare(clean(b.name), 'es', {
            sensitivity: 'base'
          })
        )
    }))
    .sort((a, b) =>
      clean(a.name).localeCompare(clean(b.name), 'es', {
        sensitivity: 'base'
      })
    );
}

/**
 * Construye la foto de transición de un grupo SAINT durante un conteo.
 * No modifica nada. La línea del producto fuente se conserva como referencia
 * histórica, pero las variantes son las que representan la realidad física.
 */
export function buildCountSaintBridgePlans({
  products = [],
  lines = [],
  stockByProductId = new Map()
} = {}) {
  const lineByProductId = new Map(
    source(lines)
      .filter(line => clean(line?.productId))
      .map(line => [clean(line.productId), line])
  );

  return buildSaintBridgeGroups(products)
    .map(group => {
      const sourceLine = lineByProductId.get(group.sourceProductId) || null;
      const variants = group.variants.map(product => {
        const line = lineByProductId.get(clean(product.id)) || null;
        return {
          productId: clean(product.id),
          productName: clean(product.name),
          countedStock: line ? finite(line.countedStock) : null,
          expectedStock: line ? finite(line.expectedStock) : null,
          countedAt: line?.countedAt || null,
          sourceCountLineId: line?.id || null
        };
      });
      const countedVariants = variants.filter(item => item.countedStock !== null);
      const variantCountedTotal = round(
        countedVariants.reduce((sum, item) => sum + item.countedStock, 0)
      );
      const sourceStockAtSubmit = round(
        valueFromMap(stockByProductId, group.sourceProductId)
      );
      const controlCountedStock = sourceLine
        ? finite(sourceLine.countedStock)
        : null;

      return {
        kind: SAINT_BRIDGE_RECLASSIFICATION_KIND,
        sourceProductId: group.sourceProductId,
        sourceProductName:
          clean(group.sourceProduct?.name) || group.name,
        saintCode: group.saintCode,
        bridgeName: group.name,
        sourceStockAtSubmit,
        controlCountedStock,
        controlCountLineId: sourceLine?.id || null,
        variantCountedTotal,
        variantCount: variants.length,
        countedVariantCount: countedVariants.length,
        controlDifference:
          controlCountedStock === null
            ? null
            : round(variantCountedTotal - controlCountedStock),
        variants,
        status: 'PENDING',
        appliedAt: null,
        appliedBy: null,
        movementIds: []
      };
    })
    .filter(plan =>
      plan.sourceStockAtSubmit !== 0 ||
      plan.controlCountedStock !== null
    );
}

export function saintBridgeProtectedProductIds(plans = []) {
  const ids = new Set();

  for (const plan of source(plans)) {
    if (!plan || plan.status === 'APPLIED') continue;
    if (clean(plan.sourceProductId)) ids.add(clean(plan.sourceProductId));
    for (const variant of source(plan.variants)) {
      if (clean(variant?.productId)) ids.add(clean(variant.productId));
    }
  }

  return ids;
}

function valueFromMap(map, key) {
  if (map instanceof Map) return finite(map.get(key));
  if (map && typeof map === 'object') return finite(map[key]);
  return 0;
}

function source(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? '').trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}
