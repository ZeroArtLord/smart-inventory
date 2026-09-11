const UNIT_CODE_BY_ID = Object.freeze({
  unit_und: 'UND',
  unit_kg: 'KG',
  unit_lt: 'LT',
  unit_box: 'CJ',
  unit_bulto: 'BUL'
});

export function buildSupplyThermalPayload({
  document,
  lines = [],
  products = [],
  categories = [],
  ownerLabel = 'Usuario VIGÍA'
} = {}) {
  const type = String(document?.type || '').trim().toUpperCase();
  const status = String(document?.status || '').trim().toUpperCase();

  if (type !== 'SUPPLY') {
    throw new Error('La impresión 80mm solo admite documentos de surtido');
  }
  if (status !== 'CLOSED') {
    throw new Error('El surtido debe estar cerrado antes de imprimir');
  }

  const sourceLines = Array.isArray(lines) ? lines : [];
  if (!sourceLines.length) {
    throw new Error('El surtido cerrado no tiene renglones para imprimir');
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

  const items = sourceLines.map((line, index) => {
    const quantity = Number(line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Cantidad inválida en renglón ${index + 1}`);
    }

    const product = productById.get(String(line?.productId || '')) || {};
    const category = categoryById.get(String(product.categoryId || ''));
    const unit = UNIT_CODE_BY_ID[product.inventoryUnitId] || 'UND';

    return {
      name: String(line?.productName || product.name || line?.productId || 'Producto'),
      quantityText: `${formatNumber(quantity)} ${unit}`,
      category: String(category?.name || 'SIN CATEGORÍA'),
      note: String(line?.notes || '')
    };
  });

  return {
    id: String(document.id || ''),
    code: supplyCode(document),
    dateLabel: formatDate(document.closedAt || document.updatedAt || document.createdAt),
    ownerLabel: String(ownerLabel || 'Usuario VIGÍA'),
    items
  };
}

function supplyCode(document = {}) {
  const raw = String(document.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase() || '000001';
  return `SUR-${raw}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';

  return Number.isInteger(number)
    ? String(number)
    : new Intl.NumberFormat('es-VE', {
        maximumFractionDigits: 3
      }).format(number);
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
