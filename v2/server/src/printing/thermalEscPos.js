const ESC = 0x1b;
const GS = 0x1d;

export const DEFAULT_THERMAL_CONFIG = Object.freeze({
  businessName: 'CLUB SOCIAL DEPORTIVO Y CAMPESTRE EL ESTABLO C.A',
  printerName: 'CAFETERIA · RC-8002',
  host: '192.168.1.165',
  port: 9100,
  charsPerLine: 44,
  leftMarginDots: 24,
  printWidthDots: 528,
  lineSpacingDots: 30,
  feedLines: 6,
  codePage: 0,
  cut: true
});

const CP437 = new Map([
  ['Ç', 0x80], ['ü', 0x81], ['é', 0x82], ['â', 0x83], ['ä', 0x84], ['à', 0x85],
  ['å', 0x86], ['ç', 0x87], ['ê', 0x88], ['ë', 0x89], ['è', 0x8a], ['ï', 0x8b],
  ['î', 0x8c], ['ì', 0x8d], ['Ä', 0x8e], ['Å', 0x8f], ['É', 0x90], ['æ', 0x91],
  ['Æ', 0x92], ['ô', 0x93], ['ö', 0x94], ['ò', 0x95], ['û', 0x96], ['ù', 0x97],
  ['ÿ', 0x98], ['Ö', 0x99], ['Ü', 0x9a], ['á', 0xa0], ['í', 0xa1], ['ó', 0xa2],
  ['ú', 0xa3], ['ñ', 0xa4], ['Ñ', 0xa5], ['ª', 0xa6], ['º', 0xa7], ['¿', 0xa8],
  ['¡', 0xad], ['°', 0xf8], ['·', 0xfa]
]);

const ASCII_FALLBACK = new Map([
  ['Á', 'A'], ['Í', 'I'], ['Ó', 'O'], ['Ú', 'U'], ['À', 'A'], ['È', 'E'], ['Ì', 'I'], ['Ò', 'O'], ['Ù', 'U'],
  ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"], ['–', '-'], ['—', '-'], ['…', '...'], ['•', '-']
]);

export function normalizeThermalConfig(input = {}) {
  const businessName = cleanText(input.businessName || DEFAULT_THERMAL_CONFIG.businessName, 80);
  const printerName = cleanText(input.printerName || DEFAULT_THERMAL_CONFIG.printerName, 80);
  const host = cleanText(input.host || DEFAULT_THERMAL_CONFIG.host, 64);
  const port = integerInRange(input.port, 1, 65535, DEFAULT_THERMAL_CONFIG.port);
  const charsPerLine = integerInRange(input.charsPerLine, 38, 48, DEFAULT_THERMAL_CONFIG.charsPerLine);
  const leftMarginDots = integerInRange(input.leftMarginDots, 0, 72, DEFAULT_THERMAL_CONFIG.leftMarginDots);
  const maxWidth = Math.max(400, 576 - leftMarginDots);
  const printWidthDots = integerInRange(
    input.printWidthDots,
    400,
    maxWidth,
    Math.min(DEFAULT_THERMAL_CONFIG.printWidthDots, maxWidth)
  );
  const lineSpacingDots = integerInRange(input.lineSpacingDots, 24, 40, DEFAULT_THERMAL_CONFIG.lineSpacingDots);
  const feedLines = integerInRange(input.feedLines, 3, 12, DEFAULT_THERMAL_CONFIG.feedLines);

  if (!businessName) throw configError('Nombre del negocio requerido');
  if (!isPrivateIpv4(host)) {
    throw configError('La impresora debe usar una IPv4 privada de la red local');
  }

  return {
    businessName,
    printerName,
    host,
    port,
    charsPerLine,
    leftMarginDots,
    printWidthDots,
    lineSpacingDots,
    feedLines,
    codePage: 0,
    cut: input.cut !== false
  };
}

export function buildCalibrationJob(configInput = {}) {
  const config = normalizeThermalConfig(configInput);
  const writer = new EscPosWriter(config);

  beginTicket(writer, config);
  header(writer, config, {
    title: 'PRUEBA DE IMPRESION 80MM',
    copyLabel: 'CALIBRACION'
  });

  writer.fontB();
  writer.left();
  writer.line(`Fecha: ${formatDateTime(new Date())}`);
  writer.line(`Impresora: ${config.printerName}`);
  writer.line(`Destino: ${config.host}:${config.port}`);
  writer.line(
    `Ajuste: ${config.charsPerLine} cols · ${config.leftMarginDots} margin · ${config.feedLines} feed`
  );
  writer.fontA();

  rule(writer);
  writer.fontB();
  writer.line(
    '12345678901234567890123456789012345678901234567890'.slice(
      0,
      smallWidth(config)
    )
  );
  writer.line('Acentos: a e i o u n N / - + ( ) [ ] # * % &');
  writer.fontA();
  rule(writer);
  legend(writer, config);

  renderCategory(writer, config, 'VIVERES', [
    { name: 'MAYONESA KRAFT SACHETS', quantityText: '1 CJ' },
    {
      name: 'PRODUCTO CON NOMBRE MUY LARGO PARA PROBAR SALTO DE LINEA',
      quantityText: '2 BUL'
    }
  ]);
  renderCategory(writer, config, 'HORTALIZAS', [
    {
      name: 'AGUACATE',
      quantityText: '30 KG',
      note: 'verdes para guasacaca'
    }
  ]);
  renderCategory(writer, config, 'BEBIDAS', [
    {
      name: 'REFRESCO DE LATA 355ML DIETA Y ZERO',
      quantityText: '4 CJ'
    }
  ]);
  renderCategory(writer, config, 'EXTRAS', [
    {
      name: 'TEIPE ELECTRICO NEGRO',
      quantityText: '3 UND',
      note: 'EXTRA - prueba de observacion',
      extra: true
    }
  ]);

  footer(writer, config, {
    title: 'PRUEBA VIGIA 80MM',
    copyLabel: 'CALIBRACION'
  });
  finishTicket(writer, config);
  return writer.buffer();
}

export function buildProcurementJob(configInput, listInput) {
  const config = normalizeThermalConfig(configInput);
  const list = normalizePrintList(listInput);
  const copies = list.kind === 'ORDER'
    ? ['COPIA PEDIDO / PROVEEDOR', 'COPIA DEPOSITO']
    : ['COPIA CHOFER', 'COPIA DEPOSITO'];
  const title = list.kind === 'ORDER'
    ? 'LISTA DE PEDIDOS'
    : 'LISTA DE COMPRAS';
  const writer = new EscPosWriter(config);

  for (const copyLabel of copies) {
    beginTicket(writer, config);
    header(writer, config, { title, copyLabel });

    writer.fontB();
    writer.left();
    writer.line(`Lista: ${list.code}`);
    writer.line(`Fecha: ${list.dateLabel || formatDateTime(new Date())}`);
    writer.line(`Almacenista: ${list.ownerLabel || 'Usuario VIGIA'}`);
    writer.fontA();

    rule(writer);
    legend(writer, config);

    for (const [category, items] of groupItems(list.items)) {
      renderCategory(writer, config, category, items);
    }

    footer(writer, config, { title, copyLabel });
    finishTicket(writer, config);
  }

  return {
    buffer: writer.buffer(),
    copies: copies.length,
    itemCount: list.items.length,
    kind: list.kind,
    listId: list.id,
    code: list.code
  };
}

export function normalizePrintList(input = {}) {
  const kind = String(input.kind || '').trim().toUpperCase();
  if (!['PURCHASE', 'ORDER'].includes(kind)) {
    throw validationError('Tipo de lista inválido');
  }

  const rawItems = Array.isArray(input.items) ? input.items : [];
  const items = rawItems
    .filter(item => String(item?.status || '').toUpperCase() !== 'CANCELLED')
    .slice(0, 250)
    .map((item, index) => normalizeItem(item, index));

  if (!items.length) {
    throw validationError('La lista no tiene renglones imprimibles');
  }

  return {
    id: cleanText(input.id || input.listId || 'lista', 100),
    code: cleanText(input.code || input.id || 'LISTA', 60),
    kind,
    dateLabel: cleanText(input.dateLabel || '', 60),
    ownerLabel: cleanText(input.ownerLabel || '', 80),
    items
  };
}

export function encodeCp437(value) {
  const bytes = [];

  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0);

    if (code === 0x0a || code === 0x0d) {
      bytes.push(code);
      continue;
    }

    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
      continue;
    }

    if (CP437.has(char)) {
      bytes.push(CP437.get(char));
      continue;
    }

    const fallback = ASCII_FALLBACK.get(char) || stripAccent(char);
    for (const fallbackChar of fallback) {
      const fallbackCode = fallbackChar.codePointAt(0);
      bytes.push(
        fallbackCode >= 0x20 && fallbackCode <= 0x7e
          ? fallbackCode
          : 0x3f
      );
    }
  }

  return Buffer.from(bytes);
}

function normalizeItem(item = {}, index = 0) {
  const name = cleanText(
    item.name || item.productName || `Producto ${index + 1}`,
    140
  );
  const quantityText = cleanText(
    item.quantityText || item.quantity || '',
    24
  ).toUpperCase();
  const category = cleanText(
    item.category ||
      item.categoryName ||
      (item.extra ? 'EXTRAS' : 'SIN CATEGORIA'),
    60
  ).toUpperCase();
  const note = cleanText(item.note || item.notes || '', 180);

  if (!name) {
    throw validationError(`Producto inválido en renglón ${index + 1}`);
  }
  if (!quantityText) {
    throw validationError(`Cantidad inválida en renglón ${index + 1}`);
  }

  return {
    name,
    quantityText,
    category,
    note,
    extra: item.extra === true
  };
}

function beginTicket(writer, config) {
  writer.raw(ESC, 0x40);
  writer.raw(ESC, 0x74, config.codePage);
  writer.raw(
    GS,
    0x4c,
    config.leftMarginDots & 0xff,
    (config.leftMarginDots >> 8) & 0xff
  );
  writer.raw(
    GS,
    0x57,
    config.printWidthDots & 0xff,
    (config.printWidthDots >> 8) & 0xff
  );
  writer.raw(ESC, 0x33, config.lineSpacingDots);
  writer.fontA();
  writer.bold(false);
  writer.left();
}

function finishTicket(writer, config) {
  writer.bold(false);
  writer.fontA();
  writer.left();
  writer.feed(config.feedLines);
  if (config.cut) writer.raw(GS, 0x56, 0x00);
}

function header(writer, config, { title, copyLabel }) {
  writer.center();
  writer.fontB();
  writer.bold(false);
  writer.line('VIGIA - Inventory Intelligence');
  writer.fontA();
  writer.bold(true);

  for (const line of wrapWords(
    config.businessName.toUpperCase(),
    Math.min(34, config.charsPerLine)
  )) {
    writer.line(line);
  }

  writer.line();
  writer.line(title);
  writer.fontB();
  writer.line(`[ ${copyLabel} ]`);
  writer.bold(false);
  writer.line();
  writer.fontA();
}

function legend(writer, config) {
  const width = config.charsPerLine;
  const check = 'OK';
  const qty = 'CANT.';
  const nameWidth = width - 1 - 8 - 1 - 3;

  writer.bold(true);
  writer.line(
    'PRODUCTO'.padEnd(nameWidth) +
      ' ' +
      qty.padStart(8) +
      ' ' +
      check.padStart(3)
  );
  writer.bold(false);
}

function renderCategory(writer, config, category, items) {
  rule(writer);
  writer.center();
  writer.bold(true);
  writer.line(cleanText(category, config.charsPerLine).toUpperCase());
  writer.bold(false);
  writer.left();
  rule(writer);

  for (const item of items) {
    renderItem(writer, config, item);
  }
}

function renderItem(writer, config, item) {
  const width = config.charsPerLine;
  const qtyWidth = 8;
  const checkText = '[ ]';
  const nameWidth = width - 1 - qtyWidth - 1 - checkText.length;
  const nameLines = wrapWords(
    cleanText(item.name, 140).toUpperCase(),
    nameWidth
  );
  const quantity = cleanText(item.quantityText, qtyWidth)
    .toUpperCase()
    .slice(0, qtyWidth);

  writer.bold(true);
  writer.line(
    (nameLines[0] || '').padEnd(nameWidth) +
      ' ' +
      quantity.padStart(qtyWidth) +
      ' ' +
      checkText
  );
  writer.bold(false);

  for (const continuation of nameLines.slice(1)) {
    writer.line(continuation);
  }

  if (item.note) {
    writer.fontB();
    const noteWidth = Math.max(20, smallWidth(config) - 4);
    for (const noteLine of wrapWords(
      `(${cleanText(item.note, 180)})`,
      noteWidth
    )) {
      writer.line(`  ${noteLine}`);
    }
    writer.fontA();
  }

  writer.line('.'.repeat(width));
}

function footer(writer, config, { title, copyLabel }) {
  rule(writer);
  writer.bold(true);
  writer.line('Observaciones:');
  writer.bold(false);
  writer.line('_'.repeat(config.charsPerLine));
  writer.line('_'.repeat(config.charsPerLine));
  writer.line('_'.repeat(config.charsPerLine));
  writer.line();
  writer.fontB();
  writer.center();
  writer.line(`${title} · ${copyLabel}`);
  writer.fontA();
  writer.left();
  writer.line('Firma: ____________________________');
}

function rule(writer, character = '-') {
  writer.line(character.repeat(writer.config.charsPerLine));
}

function groupItems(items) {
  const groups = new Map();

  for (const item of items) {
    const category = item.extra
      ? 'EXTRAS'
      : item.category || 'SIN CATEGORIA';

    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  return [...groups.entries()].sort((a, b) => {
    if (a[0] === 'EXTRAS') return 1;
    if (b[0] === 'EXTRAS') return -1;
    return a[0].localeCompare(b[0], 'es');
  });
}

function wrapWords(value, width) {
  const text = cleanText(value, 500);
  if (!text) return [''];

  const result = [];
  let current = '';

  for (const rawWord of text.split(/\s+/)) {
    let word = rawWord;

    while (word.length > width) {
      if (current) {
        result.push(current);
        current = '';
      }
      result.push(word.slice(0, width));
      word = word.slice(width);
    }

    if (!word) continue;

    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      result.push(current);
      current = word;
    }
  }

  if (current) result.push(current);
  return result.length ? result : [''];
}

function cleanText(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function stripAccent(char) {
  const stripped = String(char)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return stripped || '?';
}

function smallWidth(config) {
  return Math.max(
    config.charsPerLine,
    Math.floor(config.printWidthDots / 9) - 2
  );
}

function integerInRange(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function isPrivateIpv4(value) {
  const parts = String(value || '').split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      part =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255
    )
  ) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'THERMAL_PRINT_INVALID';
  error.statusCode = 400;
  return error;
}

function configError(message) {
  const error = new Error(message);
  error.code = 'THERMAL_PRINTER_CONFIG_INVALID';
  error.statusCode = 400;
  return error;
}

class EscPosWriter {
  constructor(config) {
    this.config = config;
    this.bytes = [];
  }

  raw(...values) {
    for (const value of values) {
      this.bytes.push(Number(value) & 0xff);
    }
  }

  text(value) {
    this.bytes.push(...encodeCp437(value));
  }

  line(value = '') {
    this.text(String(value));
    this.raw(0x0d, 0x0a);
  }

  left() {
    this.raw(ESC, 0x61, 0x00);
  }

  center() {
    this.raw(ESC, 0x61, 0x01);
  }

  bold(enabled = true) {
    this.raw(ESC, 0x45, enabled ? 0x01 : 0x00);
  }

  fontA() {
    this.raw(ESC, 0x4d, 0x00);
  }

  fontB() {
    this.raw(ESC, 0x4d, 0x01);
  }

  feed(lines) {
    this.raw(
      ESC,
      0x64,
      Math.max(0, Math.min(255, Number(lines) || 0))
    );
  }

  buffer() {
    return Buffer.from(this.bytes);
  }
}
