import { catalogUnitCode } from '../catalog/catalogUi.js';
import {
  effectiveSaintCode,
  effectiveSaintName,
  isSaintBridgeVariant
} from '../catalog/saintBridge.js';

export const SAINT_SUPPLY_COLUMNS = Object.freeze([
  { key: 'Código SAINT', label: 'Código SAINT' },
  { key: 'Producto', label: 'Producto' },
  { key: 'Cantidad', label: 'Cantidad' },
  { key: 'Unidad', label: 'Unidad' },
  { key: 'Destino', label: 'Destino' },
  { key: 'Responsable', label: 'Responsable' },
  { key: 'Fecha', label: 'Fecha' },
  { key: 'Documento', label: 'Documento' },
  { key: 'Notas', label: 'Notas' }
]);

/**
 * Construye un reporte para SAINT sin perder el detalle físico de VIGÍA.
 * Las variantes que pertenecen a un puente SAINT se agregan al código externo
 * común, pero la composición por sabor queda escrita en Notas.
 * Esta operación es puramente de lectura: nunca modifica stock.
 */
export function buildSaintSupplyReportModel({
  document,
  lines = [],
  products = [],
  locations = []
} = {}) {
  assertClosedSupply(document);

  const productById = new Map(
    (Array.isArray(products) ? products : []).map(product => [product.id, product])
  );
  const locationById = new Map(
    (Array.isArray(locations) ? locations : []).map(location => [location.id, location])
  );

  const destination = resolveDestination(document, locationById);
  const responsible = clean(
    document.metadata?.responsibleName ||
    document.closedBy ||
    document.ownerId ||
    ''
  );
  const effectiveAt =
    document.closedAt ||
    document.updatedAt ||
    document.createdAt ||
    '';
  const dateText = formatDateTime(effectiveAt);

  const warnings = [];
  const directRows = [];
  const bridgeRows = new Map();
  const sourceLines = Array.isArray(lines) ? lines : [];

  for (const [index, line] of sourceLines.entries()) {
    const product = productById.get(line.productId) || null;
    const quantity = finitePositiveOrZero(line.quantity);
    const saintCode = effectiveSaintCode(product);
    const unit = product ? catalogUnitCode(product) : clean(line.unitCode) || 'UND';
    const productName = clean(
      product?.name || line.productName || line.productId || 'Producto sin nombre'
    );

    if (!product) {
      warnings.push(
        `Producto no encontrado en catálogo para la línea ${clean(line.productId) || 'sin id'}.`
      );
    }
    if (!saintCode) {
      warnings.push(`Sin Código SAINT: ${productName}.`);
    }
    if (!(quantity > 0)) {
      warnings.push(`Cantidad no positiva en ${productName}.`);
    }

    if (product && isSaintBridgeVariant(product)) {
      const key = `${saintCode}::${unit}`;
      const row = bridgeRows.get(key) || {
        'Código SAINT': saintCode,
        Producto: effectiveSaintName(product) || productName,
        Cantidad: 0,
        Unidad: unit,
        Destino: destination,
        Responsable: responsible,
        Fecha: dateText,
        Documento: clean(document.id),
        Notas: '',
        _composition: new Map(),
        _notes: []
      };

      row.Cantidad = round(row.Cantidad + quantity);
      row._composition.set(
        productName,
        round((row._composition.get(productName) || 0) + quantity)
      );
      if (clean(line.notes)) row._notes.push(clean(line.notes));
      bridgeRows.set(key, row);
      continue;
    }

    directRows.push({
      _order: index,
      'Código SAINT': saintCode,
      Producto: productName,
      Cantidad: quantity,
      Unidad: unit,
      Destino: destination,
      Responsable: responsible,
      Fecha: dateText,
      Documento: clean(document.id),
      Notas: clean(line.notes)
    });
  }

  const aggregatedBridgeRows = [...bridgeRows.values()].map(row => {
    const composition = [...row._composition.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
      .map(([name, quantity]) => `${name}: ${formatNumber(quantity)}`)
      .join('; ');
    const extraNotes = [...new Set(row._notes)].join(' · ');

    return {
      'Código SAINT': row['Código SAINT'],
      Producto: row.Producto,
      Cantidad: round(row.Cantidad),
      Unidad: row.Unidad,
      Destino: row.Destino,
      Responsable: row.Responsable,
      Fecha: row.Fecha,
      Documento: row.Documento,
      Notas: [
        composition ? `VIGÍA detalle: ${composition}` : '',
        extraNotes
      ].filter(Boolean).join(' · ')
    };
  });

  const rows = [
    ...directRows.map(({ _order, ...row }) => row),
    ...aggregatedBridgeRows
  ];

  const totalsByUnit = new Map();
  let totalQuantityRaw = 0;
  for (const row of rows) {
    totalQuantityRaw += Number(row.Cantidad || 0);
    totalsByUnit.set(
      row.Unidad,
      round((totalsByUnit.get(row.Unidad) || 0) + Number(row.Cantidad || 0))
    );
  }

  const totals = [...totalsByUnit.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([unit, quantity]) => ({ unit, quantity }));
  const missingSaintCount = rows.filter(row => !row['Código SAINT']).length;

  return {
    documentId: clean(document.id),
    documentType: 'SUPPLY',
    status: clean(document.status),
    destination,
    responsible,
    effectiveAt,
    dateText,
    reference: clean(document.reference),
    documentNotes: clean(
      document.metadata?.saintNotes ||
      document.notes ||
      ''
    ),
    rows,
    columns: SAINT_SUPPLY_COLUMNS,
    lineCount: rows.length,
    sourceLineCount: sourceLines.length,
    bridgeAggregatedLineCount: aggregatedBridgeRows.length,
    productCount: new Set(
      sourceLines
        .map(line => clean(line.productId))
        .filter(Boolean)
    ).size,
    totalQuantityRaw: round(totalQuantityRaw),
    totalsByUnit: totals,
    totalsText: totals.length
      ? totals.map(item => `${formatNumber(item.quantity)} ${item.unit}`).join(' · ')
      : '—',
    missingSaintCount,
    readyForManualSaint: rows.length > 0 && missingSaintCount === 0,
    warnings: [...new Set(warnings)]
  };
}

export function saintSupplyFilename(model, extension = '') {
  const safeId = clean(model?.documentId || 'surtido')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'surtido';
  return `vigia_saint_surtido_${safeId}${extension}`;
}

export function printSaintSupplyReport(model) {
  if (typeof window === 'undefined' || !window.open) {
    throw new Error('La impresión requiere un navegador');
  }

  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) {
    throw new Error('El navegador bloqueó la ventana de impresión');
  }

  const rowsHtml = model.rows.map((row, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td class="code">${escapeHtml(row['Código SAINT'] || '—')}</td>
      <td class="product">${escapeHtml(row.Producto)}</td>
      <td class="qty">${escapeHtml(formatNumber(row.Cantidad))}</td>
      <td class="unit">${escapeHtml(row.Unidad)}</td>
      <td>${escapeHtml(row.Notas || '')}</td>
    </tr>
  `).join('');

  const warningHtml = model.warnings.length
    ? `<div class="warning"><strong>REVISAR:</strong> ${escapeHtml(model.warnings.join(' · '))}</div>`
    : '';

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>VIGÍA · Surtido ${escapeHtml(model.documentId)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;background:#fff}
  .page{padding:18mm 14mm 14mm;max-width:1100px;margin:auto}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #1f4e78;padding-bottom:12px}
  .brand{font-size:12px;font-weight:900;letter-spacing:.14em;color:#1f4e78}
  h1{font-size:24px;margin:4px 0 2px}
  .sub{color:#667085;font-size:12px}
  .docbox{text-align:right;border:1px solid #d8dee8;border-radius:10px;padding:10px 12px;min-width:230px}
  .docbox small{display:block;color:#667085;font-size:10px;text-transform:uppercase}
  .docbox strong{display:block;font-size:15px;margin-top:2px}
  .meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 0}
  .meta div{border:1px solid #d8dee8;border-radius:9px;padding:9px 10px;min-height:52px}
  .meta small{display:block;color:#667085;font-size:9px;text-transform:uppercase;font-weight:800;letter-spacing:.04em}
  .meta strong{display:block;font-size:12px;margin-top:4px;word-break:break-word}
  .summary{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 13px}
  .pill{border-radius:999px;background:#eef4fb;color:#1f4e78;padding:6px 10px;font-size:10px;font-weight:800}
  .pill.good{background:#e9f7ef;color:#197347}
  .pill.warn{background:#fff4dd;color:#9a6100}
  .warning{border:1px solid #e5b94b;background:#fff8e8;color:#815500;border-radius:8px;padding:8px 10px;font-size:10px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  thead{display:table-header-group}
  th{background:#1f4e78;color:white;border:1px solid #1f4e78;padding:7px 6px;text-align:left}
  td{border:1px solid #d8dee8;padding:6px;vertical-align:top}
  tr:nth-child(even) td{background:#f8fafc}
  .num{width:30px;text-align:center}.code{width:112px;font-weight:700}.qty{width:72px;text-align:right;font-weight:800}.unit{width:58px;text-align:center}.product{font-weight:700}
  .totals{margin-top:12px;border:1px solid #d8dee8;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;gap:14px;font-size:11px}
  .notes{margin-top:10px;border-left:3px solid #1f4e78;padding:7px 10px;background:#f8fafc;font-size:10px}
  .signatures{display:grid;grid-template-columns:1fr 1fr;gap:80px;margin-top:34px}
  .signature{border-top:1px solid #667085;padding-top:5px;text-align:center;color:#667085;font-size:10px}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #e4e7ec;color:#98a2b3;font-size:9px;display:flex;justify-content:space-between}
  @page{size:A4 landscape;margin:8mm}
  @media print{.page{padding:0;max-width:none}.warning,.notes,.signatures{break-inside:avoid}}
</style>
</head>
<body>
<div class="page">
  <header class="head">
    <div>
      <div class="brand">VIGÍA · INVENTORY INTELLIGENCE</div>
      <h1>Surtido / Descargo SAINT</h1>
      <div class="sub">Documento operativo para transcripción manual y control de inventario.</div>
    </div>
    <div class="docbox">
      <small>Documento VIGÍA</small>
      <strong>${escapeHtml(model.documentId)}</strong>
      <small style="margin-top:6px">Estado</small>
      <strong>${escapeHtml(model.status || 'CERRADO')}</strong>
    </div>
  </header>

  <section class="meta">
    <div><small>Fecha / cierre</small><strong>${escapeHtml(model.dateText || '—')}</strong></div>
    <div><small>Responsable</small><strong>${escapeHtml(model.responsible || '—')}</strong></div>
    <div><small>Destino</small><strong>${escapeHtml(model.destination || '—')}</strong></div>
    <div><small>Referencia</small><strong>${escapeHtml(model.reference || '—')}</strong></div>
  </section>

  <div class="summary">
    <span class="pill">${model.lineCount} línea(s) SAINT</span>
    <span class="pill">${model.productCount} producto(s) VIGÍA</span>
    <span class="pill">Totales: ${escapeHtml(model.totalsText)}</span>
    <span class="pill ${model.readyForManualSaint ? 'good' : 'warn'}">
      ${model.readyForManualSaint ? '✓ Códigos SAINT completos' : `⚠ ${model.missingSaintCount} sin Código SAINT`}
    </span>
  </div>

  ${warningHtml}

  <table>
    <thead><tr><th>#</th><th>Código SAINT</th><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Notas</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals">
    <div><strong>Total por unidad:</strong> ${escapeHtml(model.totalsText)}</div>
    <div><strong>Líneas SAINT:</strong> ${model.lineCount}</div>
  </div>

  ${model.documentNotes
    ? `<div class="notes"><strong>Nota del surtido:</strong> ${escapeHtml(model.documentNotes)}</div>`
    : ''}

  <div class="signatures">
    <div class="signature">Entregado / Almacén</div>
    <div class="signature">Recibido / Destino</div>
  </div>

  <footer class="footer">
    <span>VIGÍA · Documento trazable generado desde un surtido cerrado.</span>
    <span>Los grupos puente se agregan al código SAINT sin perder el detalle VIGÍA.</span>
  </footer>
</div>
<script>window.addEventListener('load',()=>window.print());<\/script>
</body>
</html>`);
  popup.document.close();
  return popup;
}

function assertClosedSupply(document) {
  if (!document || document.type !== 'SUPPLY') {
    throw new Error('El reporte SAINT solo admite documentos de Surtido');
  }
  if (document.status === 'DRAFT') {
    throw new Error('Cierra el surtido antes de generar el reporte SAINT');
  }
}

function resolveDestination(document, locationById) {
  const explicit = clean(
    document.metadata?.destinationName ||
    document.metadata?.destination ||
    ''
  );
  if (explicit) return explicit;

  const id = clean(document.destinationId);
  if (!id) return '—';

  const location = locationById.get(id);
  return clean(location?.name) || id;
}

function finitePositiveOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? round(number) : 0;
}

function clean(value) {
  return String(value ?? '').trim();
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 3
  }).format(number);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
