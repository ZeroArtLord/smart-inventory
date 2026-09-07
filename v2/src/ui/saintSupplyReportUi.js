import {
  STORES,
  get,
  getAll
} from '../storage/database.js';
import { listDocumentLines } from '../documents/documentService.js';
import { updateSupplyReportContext } from '../documents/supplyReportContextService.js';
import {
  buildSaintSupplyReportModel,
  printSaintSupplyReport,
  saintSupplyFilename
} from '../export/saintSupplyExport.js';
import { downloadXlsx } from '../export/exportService.js';

const LIVE_SUPPLY_CART_KIND = 'LIVE_SUPPLY_CART';
const app = document.getElementById('app');
let enhancing = false;

if (app) {
  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceSupplyView().catch(() => {}));
  });

  observer.observe(app, { childList: true, subtree: true });
  document.addEventListener('click', handleClick);
  enhanceSupplyView().catch(() => {});
}

async function enhanceSupplyView() {
  if (enhancing || !isSupplyView()) return;
  enhancing = true;

  try {
    await enhanceActiveSupplyContext();
    enhanceClosedSupplyExports();
  } finally {
    enhancing = false;
  }
}

function isSupplyView() {
  const heading = app?.querySelector('h2');
  return Boolean(
    heading && String(heading.textContent || '').trim().toLowerCase() === 'surtido'
  );
}

async function enhanceActiveSupplyContext() {
  const editor = app.querySelector('.document-editor-card');
  if (!editor || document.getElementById('v5SaintSupplyContext')) return;

  const documentId = readActiveDocumentId(editor);
  if (!documentId) return;

  const record = await get(STORES.DOCUMENTS, documentId);
  if (!record || record.type !== 'SUPPLY' || record.status !== 'DRAFT') return;

  const panel = document.createElement('div');
  panel.id = 'v5SaintSupplyContext';
  panel.className = 'v5-saint-context';
  panel.dataset.documentId = documentId;
  panel.innerHTML = `
    <div class="v5-saint-context-head">
      <div>
        <strong>Datos para descargo SAINT</strong>
        <small>Quedarán impresos en el reporte final del surtido.</small>
      </div>
      <span class="badge">V5-C</span>
    </div>

    <div class="v5-saint-context-grid">
      <label>
        Destino / área
        <input
          id="v5SaintDestination"
          autocomplete="off"
          placeholder="Ej. CAFETERÍA, COCINA, BARRA"
          value="${escapeHtml(record.metadata?.destinationName || '')}"
        >
      </label>
      <label>
        Responsable visible
        <input
          id="v5SaintResponsible"
          autocomplete="off"
          placeholder="Opcional; si queda vacío usa el usuario que cierra"
          value="${escapeHtml(record.metadata?.responsibleName || '')}"
        >
      </label>
      <label class="v5-saint-context-wide">
        Nota para SAINT / control
        <input
          id="v5SaintNotes"
          autocomplete="off"
          placeholder="Opcional"
          value="${escapeHtml(record.metadata?.saintNotes || '')}"
        >
      </label>
    </div>

    <button class="secondary" data-v5-saint-action="save-context" type="button">
      Guardar datos del surtido
    </button>
  `;

  const sectionHead = editor.querySelector('.section-head');
  if (sectionHead?.nextSibling) {
    editor.insertBefore(panel, sectionHead.nextSibling);
  } else {
    editor.prepend(panel);
  }
}

function enhanceClosedSupplyExports() {
  const history = app.querySelector('.document-history-card');
  if (!history) return;

  history.querySelectorAll('.closed-document-row').forEach(row => {
    if (row.dataset.v5SaintReady === '1') return;

    const existingExport = row.querySelector(
      '[data-action="export-document"][data-format="xlsx"]'
    );
    const documentId = existingExport?.dataset.id;
    const actions = row.querySelector('.document-export-actions');
    if (!documentId || !actions) return;

    row.dataset.v5SaintReady = '1';

    const separator = document.createElement('span');
    separator.className = 'v5-saint-separator';
    separator.textContent = 'SAINT';
    actions.appendChild(separator);

    actions.insertAdjacentHTML('beforeend', `
      <button
        class="secondary v5-saint-export-button"
        data-v5-saint-action="export-xlsx"
        data-id="${escapeHtml(documentId)}"
        type="button"
      >SAINT Excel</button>
      <button
        class="primary v5-saint-export-button"
        data-v5-saint-action="export-print"
        data-id="${escapeHtml(documentId)}"
        type="button"
      >SAINT PDF</button>
    `);
  });
}

async function handleClick(event) {
  const button = event.target.closest('[data-v5-saint-action]');
  if (!button) return;

  event.preventDefault();

  try {
    switch (button.dataset.v5SaintAction) {
      case 'save-context':
        await saveActiveContext();
        break;
      case 'export-xlsx':
        await exportSaintSupply(button.dataset.id, 'xlsx');
        break;
      case 'export-print':
        await exportSaintSupply(button.dataset.id, 'print');
        break;
    }
  } catch (error) {
    toast(error.message || String(error));
  }
}

async function saveActiveContext() {
  const panel = document.getElementById('v5SaintSupplyContext');
  const documentId = panel?.dataset.documentId;
  if (!documentId) throw new Error('Surtido activo no identificado');

  await updateSupplyReportContext(documentId, {
    destinationName: document.getElementById('v5SaintDestination')?.value,
    responsibleName: document.getElementById('v5SaintResponsible')?.value,
    saintNotes: document.getElementById('v5SaintNotes')?.value
  });

  toast('Datos SAINT guardados en el surtido');
}

async function exportSaintSupply(documentId, format) {
  if (!documentId) throw new Error('Documento no identificado');

  const [record, lines, products, locations] = await Promise.all([
    get(STORES.DOCUMENTS, documentId),
    listDocumentLines(documentId),
    getAll(STORES.PRODUCTS),
    getAll(STORES.LOCATIONS)
  ]);

  if (
    record?.metadata?.kind === LIVE_SUPPLY_CART_KIND ||
    record?.metadata?.closeMode === LIVE_SUPPLY_CART_KIND
  ) {
    throw new Error(
      'El carrito V5-E es un acumulador operativo. El descargo SAINT debe salir de cada entrega física cerrada, no de las cantidades planificadas del padre.'
    );
  }

  const model = buildSaintSupplyReportModel({
    document: record,
    lines,
    products,
    locations
  });

  if (!model.rows.length) {
    throw new Error('El surtido cerrado no tiene líneas para exportar');
  }

  if (model.missingSaintCount > 0) {
    const proceed = confirm(
      `Hay ${model.missingSaintCount} producto(s) sin Código SAINT. ` +
      'El reporte no está listo para descargo definitivo. ¿Generarlo solo para revisión?'
    );
    if (!proceed) return;
  }

  if (format === 'xlsx') {
    downloadXlsx(
      model.rows,
      saintSupplyFilename(model),
      { sheetName: 'Surtido SAINT' }
    );
    toast('Excel SAINT generado');
    return;
  }

  if (format === 'print') {
    printSaintSupplyReport(model);
    toast('Reporte SAINT abierto para imprimir / PDF');
    return;
  }

  throw new Error('Formato SAINT no soportado');
}

function readActiveDocumentId(editor) {
  const text = editor.querySelector('.section-head p')?.textContent || '';
  return String(text).trim();
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'v5-toast';
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);

  const status = document.getElementById('saveStatus');
  if (status) status.textContent = String(message || 'Listo');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
