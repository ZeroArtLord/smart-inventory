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

export function buildConsolidatedSupplyThermalPayload({
  parentDocument,
  deliveryDocuments = [],
  lines = [],
  products = [],
  categories = [],
  ownerLabel = 'Usuario VIGÍA'
} = {}) {
  const parentId = String(parentDocument?.id || '').trim();
  const parentType = String(parentDocument?.type || '').trim().toUpperCase();

  if (!parentId || parentType !== 'SUPPLY') {
    throw new Error('El consolidado 80mm requiere un Surtido padre válido');
  }

  const validDeliveries = (Array.isArray(deliveryDocuments) ? deliveryDocuments : [])
    .filter(delivery =>
      String(delivery?.type || '').trim().toUpperCase() === 'SUPPLY' &&
      String(delivery?.status || '').trim().toUpperCase() === 'CLOSED' &&
      String(delivery?.metadata?.kind || '').trim().toUpperCase() === 'LIVE_SUPPLY_DELIVERY' &&
      String(delivery?.metadata?.parentCartId || '').trim() === parentId
    );

  if (!validDeliveries.length) {
    throw new Error('El Surtido no tiene entregas físicas cerradas para imprimir');
  }

  const deliveryIds = new Set(validDeliveries.map(delivery => String(delivery.id || '')));
  const sourceLines = (Array.isArray(lines) ? lines : [])
    .filter(line => deliveryIds.has(String(line?.documentId || '')));

  if (!sourceLines.length) {
    throw new Error('Las entregas físicas no tienen renglones para imprimir');
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
  const grouped = new Map();

  sourceLines.forEach((line, index) => {
    const productId = String(line?.productId || '').trim();
    if (!productId) {
      throw new Error(`Producto inválido en renglón ${index + 1}`);
    }

    const quantity = decimalQuantity(line?.quantity, index);
    let entry = grouped.get(productId);
    if (!entry) {
      entry = {
        productId,
        name: String(line?.productName || productById.get(productId)?.name || productId || 'Producto'),
        quantities: [],
        notes: new Set()
      };
      grouped.set(productId, entry);
    }

    entry.quantities.push(quantity);
    const note = String(line?.notes || '').trim();
    if (note) entry.notes.add(note);
  });

  const items = [...grouped.values()].map(entry => {
    const product = productById.get(entry.productId) || {};
    const category = categoryById.get(String(product.categoryId || ''));
    const unit = UNIT_CODE_BY_ID[product.inventoryUnitId] || 'UND';
    const total = sumExactDecimals(entry.quantities);

    return {
      name: entry.name,
      quantityText: `${formatExactNumber(total)} ${unit}`,
      category: String(category?.name || 'SIN CATEGORÍA'),
      note: [...entry.notes].join(' · ')
    };
  });

  const latestDeliveryDate = validDeliveries
    .map(delivery => delivery?.closedAt || delivery?.updatedAt || delivery?.createdAt)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)))
    .at(-1);

  return {
    id: parentId,
    code: supplyCode(parentDocument),
    dateLabel: formatDate(
      latestDeliveryDate ||
      parentDocument?.updatedAt ||
      parentDocument?.createdAt
    ),
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

function decimalQuantity(value, index) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Cantidad inválida en renglón ${index + 1}`);
  }
  return toPlainDecimal(String(value));
}

function toPlainDecimal(value) {
  const raw = String(value || '').trim().replace(',', '.');
  const match = raw.match(/^([+]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) throw new Error(`Cantidad decimal inválida: ${value}`);

  const integer = match[2];
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;

  let plain;
  if (decimalPosition <= 0) {
    plain = `0.${'0'.repeat(Math.abs(decimalPosition))}${digits}`;
  } else if (decimalPosition >= digits.length) {
    plain = `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  } else {
    plain = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }

  const [rawInteger, rawFraction = ''] = plain.split('.');
  const cleanInteger = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const cleanFraction = rawFraction.replace(/0+$/, '');
  return cleanFraction ? `${cleanInteger}.${cleanFraction}` : cleanInteger;
}

function sumExactDecimals(values) {
  const normalized = values.map(toPlainDecimal);
  const scale = Math.max(
    0,
    ...normalized.map(value => (value.split('.')[1] || '').length)
  );

  const total = normalized.reduce((sum, value) => {
    const [integer, fraction = ''] = value.split('.');
    const scaled = `${integer}${fraction.padEnd(scale, '0')}`;
    return sum + BigInt(scaled || '0');
  }, 0n);

  let digits = total.toString();
  if (scale === 0) return digits;

  digits = digits.padStart(scale + 1, '0');
  const integer = digits.slice(0, -scale) || '0';
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
}

function formatExactNumber(value) {
  const plain = toPlainDecimal(value);
  const [integer, fraction = ''] = plain.split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction ? `${groupedInteger},${fraction}` : groupedInteger;
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
