import {
  STORES,
  get,
  put,
  remove
} from '../storage/database.js';

const KEY_PREFIX = 'supplyChecklist:';
const EPSILON = 1e-9;

const UNIT_CODE_BY_ID = Object.freeze({
  unit_und: 'UND',
  unit_kg: 'KG',
  unit_lt: 'LT',
  unit_box: 'CJ',
  unit_bulto: 'BUL'
});

export function buildSupplyChecklistModel({
  summary,
  products = [],
  categories = [],
  checkedState = {}
} = {}) {
  const parentCartId = String(summary?.document?.id || '').trim();
  if (!parentCartId) {
    throw new Error('La Hoja de surtido requiere un carrito válido');
  }

  const productById = new Map(
    (Array.isArray(products) ? products : []).map(product => [
      String(product?.id || ''),
      product
    ])
  );
  const categoryById = new Map(
    (Array.isArray(categories) ? categories : []).map(category => [
      String(category?.id || ''),
      category
    ])
  );

  const groups = new Map();

  for (const row of Array.isArray(summary?.rows) ? summary.rows : []) {
    const quantity = Number(row?.actionableRemaining || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const productId = String(row?.productId || '').trim();
    if (!productId) continue;

    const product = productById.get(productId) || {};
    const category = categoryById.get(String(product.categoryId || ''));
    const categoryName = String(category?.name || 'SIN CATEGORÍA').trim() || 'SIN CATEGORÍA';
    const unit = UNIT_CODE_BY_ID[product.inventoryUnitId] || 'UND';
    const saved = checkedState?.[productId] || null;
    const checked = Boolean(
      saved?.checked === true &&
      sameQuantity(saved.quantity, quantity)
    );

    const item = {
      productId,
      productName: String(row?.productName || product.name || productId),
      quantity,
      quantityText: `${formatExactQuantity(quantity)} ${unit}`,
      unit,
      category: categoryName,
      checked
    };

    if (!groups.has(categoryName)) groups.set(categoryName, []);
    groups.get(categoryName).push(item);
  }

  const grouped = [...groups.entries()]
    .map(([category, rows]) => ({
      category,
      rows: rows.sort((a, b) =>
        a.productName.localeCompare(b.productName, 'es')
      )
    }))
    .sort((a, b) => a.category.localeCompare(b.category, 'es'));

  const flat = grouped.flatMap(group => group.rows);

  return {
    parentCartId,
    groups: grouped,
    pendingCount: flat.length,
    checkedCount: flat.filter(row => row.checked).length,
    complete: flat.length > 0 && flat.every(row => row.checked)
  };
}

export async function loadSupplyChecklistState(parentCartId) {
  const id = cleanId(parentCartId);
  if (!id) return {};

  const record = await get(STORES.SETTINGS, settingsKey(id));
  const items = record?.items;
  return items && typeof items === 'object' && !Array.isArray(items)
    ? items
    : {};
}

export async function setSupplyChecklistItemChecked(
  parentCartId,
  productId,
  quantity,
  checked
) {
  const cartId = cleanId(parentCartId);
  const itemId = cleanId(productId);
  const numericQuantity = Number(quantity);

  if (!cartId || !itemId) {
    throw new Error('Producto de Hoja de surtido no identificado');
  }
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    throw new Error('Cantidad de Hoja de surtido inválida');
  }

  const key = settingsKey(cartId);
  const current = await get(STORES.SETTINGS, key);
  const items = {
    ...(current?.items && typeof current.items === 'object'
      ? current.items
      : {})
  };

  items[itemId] = {
    checked: checked === true,
    quantity: numericQuantity,
    updatedAt: new Date().toISOString()
  };

  const record = {
    key,
    kind: 'SUPPLY_CHECKLIST',
    parentCartId: cartId,
    items,
    updatedAt: new Date().toISOString()
  };

  await put(STORES.SETTINGS, record);
  return record;
}

export async function clearSupplyChecklistState(parentCartId) {
  const id = cleanId(parentCartId);
  if (!id) return false;
  await remove(STORES.SETTINGS, settingsKey(id));
  return true;
}

function settingsKey(parentCartId) {
  return `${KEY_PREFIX}${parentCartId}`;
}

function cleanId(value) {
  return String(value ?? '').trim();
}

function sameQuantity(a, b) {
  const first = Number(a);
  const second = Number(b);
  return Number.isFinite(first) &&
    Number.isFinite(second) &&
    Math.abs(first - second) <= EPSILON;
}

function formatExactQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';

  return number.toLocaleString('es-VE', {
    useGrouping: true,
    maximumFractionDigits: 20
  });
}
