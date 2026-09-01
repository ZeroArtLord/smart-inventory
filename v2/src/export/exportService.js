export function rowsToCsv(rows = [], columns = null) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = normalizeColumns(columns, list);

  if (keys.length === 0) return '';

  const header = keys
    .map(column => csvCell(column.label))
    .join(',');

  const body = list.map(row =>
    keys.map(column =>
      csvCell(resolveValue(row, column.key))
    ).join(',')
  );

  return [header, ...body].join('\r\n');
}

export function buildDocumentExportRows(document, lines = []) {
  const type = document?.type;

  if (type === 'COUNT') {
    return lines.map(line => ({
      Producto: line.productName || line.productId || '',
      Esperado: numericOrBlank(line.expectedStock),
      Contado: numericOrBlank(line.countedStock),
      Diferencia: numericOrBlank(line.difference),
      'Fecha conteo': line.countedAt || ''
    }));
  }

  return lines.map(line => ({
    Producto: line.productName || line.productId || '',
    Cantidad: numericOrBlank(line.quantity),
    Lote: line.lotNumber || '',
    Vencimiento: line.expiresAt || '',
    'Costo unitario': numericOrBlank(line.unitCost),
    Notas: line.notes || ''
  }));
}

export function downloadCsv(rows, filename, columns = null) {
  const csv = '\ufeff' + rowsToCsv(rows, columns);
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    ensureExtension(filename, '.csv')
  );
}

export function downloadXlsx(
  rows,
  filename,
  {
    sheetName = 'Datos'
  } = {}
) {
  const xlsx = globalThis.XLSX;
  if (!xlsx?.utils || !xlsx?.writeFile) {
    throw new Error('El motor Excel no está disponible');
  }

  const worksheet = xlsx.utils.json_to_sheet(
    Array.isArray(rows) ? rows : []
  );
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(
    workbook,
    worksheet,
    sanitizeSheetName(sheetName)
  );
  xlsx.writeFile(
    workbook,
    ensureExtension(filename, '.xlsx')
  );
}

export function printRows({
  title,
  subtitle = '',
  rows = [],
  columns = null,
  meta = []
} = {}) {
  if (typeof window === 'undefined' || !window.open) {
    throw new Error('La impresión requiere un navegador');
  }

  const normalizedColumns = normalizeColumns(columns, rows);
  const popup = window.open('', '_blank', 'noopener,noreferrer');

  if (!popup) {
    throw new Error('El navegador bloqueó la ventana de impresión');
  }

  const metaHtml = (Array.isArray(meta) ? meta : [])
    .filter(item => item?.label)
    .map(item =>
      `<div><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value ?? '')}</div>`
    )
    .join('');

  const headHtml = normalizedColumns
    .map(column => `<th>${escapeHtml(column.label)}</th>`)
    .join('');

  const bodyHtml = (Array.isArray(rows) ? rows : [])
    .map(row => `
      <tr>
        ${normalizedColumns.map(column =>
          `<td>${escapeHtml(resolveValue(row, column.key))}</td>`
        ).join('')}
      </tr>
    `)
    .join('');

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || 'Smart Inventory')}</title>
<style>
  body{font-family:Arial,sans-serif;color:#111827;margin:28px}
  h1{font-size:22px;margin:0 0 4px}
  .subtitle{color:#6b7280;margin-bottom:14px}
  .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 18px;font-size:12px;margin:12px 0 18px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}
  th{background:#f3f4f6}
  .footer{margin-top:16px;color:#6b7280;font-size:10px}
  @media print{body{margin:12mm}.no-print{display:none}}
</style>
</head>
<body>
  <h1>${escapeHtml(title || 'Smart Inventory')}</h1>
  <div class="subtitle">${escapeHtml(subtitle)}</div>
  <div class="meta">${metaHtml}</div>
  <table>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  <div class="footer">Smart Inventory V2 · Documento generado para revisión humana.</div>
  <script>window.addEventListener('load',()=>{window.print();});<\/script>
</body>
</html>`);
  popup.document.close();

  return popup;
}

function normalizeColumns(columns, rows) {
  if (Array.isArray(columns) && columns.length) {
    return columns.map(column => {
      if (typeof column === 'string') {
        return { key: column, label: column };
      }

      return {
        key: column.key,
        label: column.label || column.key
      };
    });
  }

  const first = (Array.isArray(rows) ? rows : [])
    .find(row => row && typeof row === 'object');

  return first
    ? Object.keys(first).map(key => ({ key, label: key }))
    : [];
}

function resolveValue(row, key) {
  const value = row?.[key];

  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function numericOrBlank(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function ensureExtension(filename, extension) {
  const base = String(filename || 'smart-inventory').trim() ||
    'smart-inventory';

  return base.toLowerCase().endsWith(extension)
    ? base
    : base + extension;
}

function sanitizeSheetName(value) {
  const cleaned = String(value || 'Datos')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .trim()
    .slice(0, 31);

  return cleaned || 'Datos';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
