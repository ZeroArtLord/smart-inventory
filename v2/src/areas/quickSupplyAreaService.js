const EPSILON = 0.000001;

export function mergeQuickAreaAllocation({
  existingDraft = null,
  parentCartId,
  productId,
  productName,
  totalQuantity,
  addedQuantity,
  area = null
} = {}) {
  const cartId = clean(parentCartId);
  const itemId = clean(productId);
  const name = clean(productName || existingDraft?.productName || itemId);
  const total = positive(totalQuantity, 'Cantidad total inválida');
  const added = nonNegative(addedQuantity, 'Cantidad agregada inválida');

  if (!cartId) throw new Error('Surtido requerido');
  if (!itemId) throw new Error('Producto requerido');
  if (!name) throw new Error('Nombre de producto requerido');

  const allocations = normalizeAllocations(existingDraft?.allocations || []);
  const areaId = clean(area?.id || area?.areaId);
  const areaName = clean(area?.name || area?.areaName || areaId);

  if (areaId && added > EPSILON) {
    const existing = allocations.find(item => item.areaId === areaId);
    if (existing) {
      existing.quantity = round(existing.quantity + added);
      if (areaName) existing.areaName = areaName;
    } else {
      allocations.push({
        areaId,
        areaName,
        quantity: round(added)
      });
    }
  }

  const assigned = round(
    allocations.reduce((sum, item) => sum + item.quantity, 0)
  );
  if (assigned - total > EPSILON) {
    throw new Error(
      `La distribución guardada (${assigned}) supera la cantidad pendiente (${total})`
    );
  }

  return {
    parentCartId: cartId,
    productId: itemId,
    productName: name,
    quantity: total,
    allocations
  };
}

function normalizeAllocations(source) {
  const byArea = new Map();
  for (const item of Array.isArray(source) ? source : []) {
    const areaId = clean(item?.areaId);
    const quantity = Number(item?.quantity);
    if (!areaId || !Number.isFinite(quantity) || quantity <= EPSILON) continue;
    const current = byArea.get(areaId);
    if (current) {
      current.quantity = round(current.quantity + quantity);
      if (!current.areaName && item?.areaName) {
        current.areaName = clean(item.areaName);
      }
    } else {
      byArea.set(areaId, {
        areaId,
        areaName: clean(item?.areaName || areaId),
        quantity: round(quantity)
      });
    }
  }
  return [...byArea.values()];
}

function positive(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= EPSILON) throw new Error(message);
  return number;
}

function nonNegative(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(message);
  return number;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
}

function clean(value) {
  return String(value ?? '').trim();
}
