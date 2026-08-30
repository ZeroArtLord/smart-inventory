import { createLocalId } from '../core/ids.js';
import { evaluateNumericExpression } from '../core/mathExpression.js';
import { REPLENISHMENT_METHODS } from '../core/catalog.js';
import {
  seedDefaultUnits,
  createProduct,
  listProducts,
  searchProducts
} from '../catalog/catalogService.js';
import {
  STORES,
  openDatabase,
  getAll
} from '../storage/database.js';
import {
  createDocument,
  saveDocumentLine,
  listDocumentLines,
  listDraftDocuments,
  closeDocument
} from '../documents/documentService.js';
import {
  DOCUMENT_TYPES
} from '../documents/documentTypes.js';
import {
  getReplenishmentSuggestion
} from '../intelligence/replenishmentEngine.js';

const appRoot = document.getElementById('app');
const saveStatus = document.getElementById('saveStatus');

const state = {
  view: 'home',
  products: [],
  activeDocumentId: null,
  activeDocumentType: null,
  selectedProductId: null,
  searchResults: []
};

const ownerId = getLocalOwnerId();

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    await openDatabase();
    await seedDefaultUnits();
    await refreshProducts();
    bindGlobalEvents();
    registerServiceWorker();
    await render();
  } catch (error) {
    renderFatal(error);
  }
}

function bindGlobalEvents() {
  document.getElementById('homeButton').addEventListener('click', () => {
    state.view = 'home';
    state.activeDocumentId = null;
    state.activeDocumentType = null;
    state.selectedProductId = null;
    render();
  });

  document.querySelector('.bottom-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    state.view = button.dataset.view;
    state.activeDocumentId = null;
    state.activeDocumentType = null;
    state.selectedProductId = null;
    render();
  });

  appRoot.addEventListener('click', handleClick);
  appRoot.addEventListener('submit', handleSubmit);
  appRoot.addEventListener('input', handleInput);
  appRoot.addEventListener('keydown', handleKeydown);
}

async function render() {
  await refreshSaveStatus();

  switch (state.view) {
    case 'catalog':
      return renderCatalog();
    case 'count':
      return renderDocumentWorkspace(DOCUMENT_TYPES.COUNT);
    case 'entry':
      return renderDocumentWorkspace(DOCUMENT_TYPES.ENTRY);
    case 'supply':
      return renderDocumentWorkspace(DOCUMENT_TYPES.SUPPLY);
    default:
      return renderHome();
  }
}

async function renderHome() {
  const drafts = await listDraftDocuments({ ownerId });
  const pending = await getPendingSyncCount();

  appRoot.innerHTML = `
    <section class="hero">
      <h1>Almacén</h1>
      <p>Trabajo local-first. Cada operación se guarda antes de continuar.</p>
    </section>

    <section class="grid dashboard-grid">
      <div class="card">
        <strong>${state.products.length}</strong>
        <div class="product-meta">Productos activos</div>
      </div>
      <div class="card">
        <strong>${drafts.length}</strong>
        <div class="product-meta">Borradores recuperables</div>
      </div>
      <div class="card">
        <strong>${pending}</strong>
        <div class="product-meta">Cambios pendientes de servidor</div>
      </div>
    </section>

    <section class="grid dashboard-grid" style="margin-top:16px">
      ${actionCard('count', 'Conteo físico', 'Número + Enter. Ajustes trazables.')}
      ${actionCard('supply', 'Surtido', 'Carrito de salida con validación de stock.')}
      ${actionCard('entry', 'Entrada', 'Recepción, costo, lote y vencimiento opcionales.')}
      ${actionCard('catalog', 'Catálogo', 'Productos, mínimos, máximos y reposición.')}
    </section>
  `;
}

async function renderCatalog() {
  await refreshProducts();

  appRoot.innerHTML = `
    <section class="hero">
      <h2>Catálogo</h2>
      <p>Base maestra del inventario. El importador Excel será el siguiente módulo.</p>
    </section>

    <div class="operation-layout">
      <form id="productForm" class="card stack">
        <h3 style="margin:0">Nuevo producto</h3>

        <label>
          Nombre
          <input name="name" autocomplete="off" required>
        </label>

        <div class="row">
          <label>
            SKU / Código interno
            <input name="sku" autocomplete="off">
          </label>
          <label>
            Código de barras
            <input name="barcode" inputmode="numeric" autocomplete="off">
          </label>
        </div>

        <div class="row">
          <label>
            Mínimo semanal
            <input name="minStock" value="0" inputmode="decimal">
          </label>
          <label>
            Máximo semanal
            <input name="maxStock" value="0" inputmode="decimal">
          </label>
        </div>

        <label>
          Reposición
          <select name="replenishmentMethod">
            <option value="${REPLENISHMENT_METHODS.BOTH}">Compra o pedido</option>
            <option value="${REPLENISHMENT_METHODS.PURCHASE}">Compra</option>
            <option value="${REPLENISHMENT_METHODS.ORDER}">Pedido</option>
            <option value="${REPLENISHMENT_METHODS.NONE}">Sin reposición automática</option>
          </select>
        </label>

        <button class="primary" type="submit">Agregar producto</button>
      </form>

      <section class="card">
        <div class="row">
          <h3 style="margin:0">Productos</h3>
          <span class="badge">${state.products.length}</span>
        </div>
        <div class="stack" style="margin-top:12px">
          ${state.products.length
            ? state.products.map(product => `
              <div>
                <strong>${escapeHtml(product.name)}</strong>
                <div class="product-meta">
                  Min ${product.minStock} · Max ${product.maxStock || '—'} · ${escapeHtml(product.replenishmentMethod)}
                </div>
              </div>
            `).join('')
            : '<div class="empty">Todavía no hay productos.</div>'}
        </div>
      </section>
    </div>
  `;
}

async function renderDocumentWorkspace(type) {
  if (!state.activeDocumentId || state.activeDocumentType !== type) {
    const drafts = await listDraftDocuments({ ownerId, type });

    appRoot.innerHTML = `
      <section class="hero">
        <h2>${documentTitle(type)}</h2>
        <p>${documentSubtitle(type)}</p>
      </section>

      <section class="card stack">
        <button class="primary" data-action="new-document" data-type="${type}" type="button">
          Nuevo ${documentTitle(type).toLowerCase()}
        </button>

        ${drafts.length
          ? `
            <div>
              <strong>Continuar trabajo</strong>
              <div class="stack" style="margin-top:8px">
                ${drafts.map(document => `
                  <button class="secondary" data-action="open-document" data-id="${escapeHtml(document.id)}" data-type="${type}" type="button">
                    ${escapeHtml(document.id)} · ${formatDate(document.updatedAt)}
                  </button>
                `).join('')}
              </div>
            </div>
          `
          : '<div class="empty">No hay borradores pendientes.</div>'}
      </section>
    `;
    return;
  }

  if (type === DOCUMENT_TYPES.COUNT) {
    return renderCountWorkspace();
  }

  return renderCartWorkspace(type);
}

async function renderCountWorkspace() {
  await refreshProducts();

  const lines = await listDocumentLines(state.activeDocumentId);
  const countedIds = new Set(lines.map(line => line.productId));
  const nextProduct = state.products.find(product => !countedIds.has(product.id));
  const percent = state.products.length
    ? Math.round((lines.length / state.products.length) * 100)
    : 0;

  appRoot.innerHTML = `
    <section class="hero">
      <h2>Conteo físico</h2>
      <p>${lines.length} de ${state.products.length} productos.</p>
    </section>

    <div class="card stack">
      <div class="progress-track"><div style="width:${percent}%"></div></div>
      <div class="row">
        <span class="badge">${percent}%</span>
        <span class="product-meta">${escapeHtml(state.activeDocumentId)}</span>
      </div>
    </div>

    ${nextProduct ? renderCountProduct(nextProduct) : `
      <section class="card stack" style="margin-top:16px">
        <h3 style="margin:0">Conteo completo</h3>
        <p class="product-meta">Todas las líneas están guardadas. Al cerrar se generarán únicamente los ajustes necesarios.</p>
        <button class="success" data-action="close-document" type="button">Cerrar conteo</button>
      </section>
    `}

    ${lines.length ? `
      <section class="card" style="margin-top:16px">
        <strong>Últimos contados</strong>
        <div class="stack" style="margin-top:10px">
          ${lines.slice(-8).reverse().map(line => `
            <div class="cart-line">
              <div>
                <strong>${escapeHtml(line.productName)}</strong>
                <div class="product-meta">Esperado ${line.expectedStock} · Contado ${line.countedStock}</div>
              </div>
              <span class="badge">${formatSigned(line.difference)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    ` : ''}
  `;

  requestAnimationFrame(() => {
    document.getElementById('countValue')?.focus();
  });
}

function renderCountProduct(product) {
  return `
    <section class="card stack" style="margin-top:16px">
      <div>
        <h3 class="product-title">${escapeHtml(product.name)}</h3>
        <div class="product-meta">
          Mínimo ${product.minStock} · Máximo ${product.maxStock || '—'}
        </div>
      </div>

      <label>
        Existencia física
        <input
          id="countValue"
          class="numeric-input"
          inputmode="decimal"
          autocomplete="off"
          data-product-id="${escapeHtml(product.id)}"
          placeholder="0"
        >
      </label>

      ${mathPad('countValue')}

      <button
        class="primary"
        data-action="save-count"
        data-product-id="${escapeHtml(product.id)}"
        type="button"
      >
        Guardar y siguiente
      </button>

      <small class="product-meta">Puedes escribir 12+4-2 y presionar Enter.</small>
    </section>
  `;
}

async function renderCartWorkspace(type) {
  const lines = await listDocumentLines(state.activeDocumentId);
  const selected = state.products.find(product => product.id === state.selectedProductId);

  appRoot.innerHTML = `
    <section class="hero">
      <h2>${documentTitle(type)}</h2>
      <p>${escapeHtml(state.activeDocumentId)}</p>
    </section>

    <div class="operation-layout">
      <section class="card stack">
        <label>
          Buscar producto
          <input id="productSearch" autocomplete="off" placeholder="Nombre, alias, SKU o código">
        </label>

        <div id="searchResults" class="search-results"></div>

        ${selected ? `
          <div class="card" style="box-shadow:none">
            <strong>${escapeHtml(selected.name)}</strong>
            <div class="product-meta">
              Min ${selected.minStock} · Max ${selected.maxStock || '—'}
            </div>
          </div>

          <label>
            Cantidad
            <input id="operationQuantity" class="numeric-input" inputmode="decimal" autocomplete="off" placeholder="0">
          </label>

          ${mathPad('operationQuantity')}

          ${type === DOCUMENT_TYPES.ENTRY ? `
            <div class="row">
              <label>
                Costo unitario opcional
                <input id="unitCost" inputmode="decimal" autocomplete="off">
              </label>
              <label>
                Lote opcional
                <input id="lotNumber" autocomplete="off">
              </label>
            </div>
            <label>
              Vencimiento opcional
              <input id="expiresAt" type="date">
            </label>
          ` : ''}

          <button class="primary" data-action="add-line" data-type="${type}" type="button">
            Agregar
          </button>
        ` : '<div class="empty">Busca y selecciona un producto.</div>'}
      </section>

      <section class="card stack">
        <div class="row">
          <h3 style="margin:0">${type === DOCUMENT_TYPES.SUPPLY ? 'Surtido' : 'Entrada'}</h3>
          <span class="badge">${lines.length} líneas</span>
        </div>

        <div>
          ${lines.length
            ? lines.map(line => `
              <div class="cart-line">
                <div>
                  <strong>${escapeHtml(line.productName)}</strong>
                  <div class="product-meta">
                    ${line.lotNumber ? 'Lote ' + escapeHtml(line.lotNumber) : ''}
                    ${line.expiresAt ? ' · Vence ' + formatDate(line.expiresAt) : ''}
                  </div>
                </div>
                <strong>${line.quantity}</strong>
              </div>
            `).join('')
            : '<div class="empty">Carrito vacío.</div>'}
        </div>

        ${lines.length
          ? '<button class="success" data-action="close-document" type="button">Cerrar documento</button>'
          : ''}
      </section>
    </div>
  `;

  requestAnimationFrame(() => {
    if (selected) document.getElementById('operationQuantity')?.focus();
    else document.getElementById('productSearch')?.focus();
  });
}

async function handleClick(event) {
  const viewButton = event.target.closest('[data-open-view]');
  if (viewButton) {
    state.view = viewButton.dataset.openView;
    return render();
  }

  const mathButton = event.target.closest('[data-math-target]');
  if (mathButton) {
    insertMathSymbol(mathButton.dataset.mathTarget, mathButton.dataset.symbol);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;

  try {
    switch (button.dataset.action) {
      case 'new-document':
        return startDocument(button.dataset.type);
      case 'open-document':
        state.activeDocumentId = button.dataset.id;
        state.activeDocumentType = button.dataset.type;
        state.selectedProductId = null;
        return render();
      case 'save-count':
        return saveCount(button.dataset.productId);
      case 'select-product':
        state.selectedProductId = button.dataset.productId;
        state.searchResults = [];
        return render();
      case 'add-line':
        return addOperationLine(button.dataset.type);
      case 'close-document':
        return finishDocument();
    }
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function handleSubmit(event) {
  if (event.target.id !== 'productForm') return;
  event.preventDefault();

  try {
    const form = new FormData(event.target);
    const minStock = evaluateNumericExpression(form.get('minStock'));
    const maxStock = evaluateNumericExpression(form.get('maxStock'));

    await createProduct({
      name: form.get('name'),
      sku: form.get('sku'),
      barcode: form.get('barcode'),
      minStock,
      maxStock,
      replenishmentMethod: form.get('replenishmentMethod')
    });

    await refreshProducts();
    showToast('Producto guardado');
    await render();
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function handleInput(event) {
  if (event.target.id !== 'productSearch') return;

  const query = event.target.value;
  state.searchResults = query.trim()
    ? await searchProducts(query, { limit: 8 })
    : [];

  const container = document.getElementById('searchResults');
  if (!container) return;

  container.innerHTML = state.searchResults.map(product => `
    <button
      class="search-result"
      data-action="select-product"
      data-product-id="${escapeHtml(product.id)}"
      type="button"
    >
      <strong>${escapeHtml(product.name)}</strong>
      <div class="product-meta">${escapeHtml(product.sku || product.barcode || '')}</div>
    </button>
  `).join('');
}

async function handleKeydown(event) {
  if (event.key !== 'Enter') return;

  if (event.target.id === 'countValue') {
    event.preventDefault();
    return saveCount(event.target.dataset.productId);
  }

  if (event.target.id === 'operationQuantity') {
    event.preventDefault();
    return addOperationLine(state.activeDocumentType);
  }

  if (event.target.id === 'productSearch' && state.searchResults.length) {
    event.preventDefault();
    state.selectedProductId = state.searchResults[0].id;
    state.searchResults = [];
    return render();
  }
}

async function startDocument(type) {
  if (state.products.length === 0) {
    state.view = 'catalog';
    showToast('Primero agrega o importa productos');
    return render();
  }

  const document = await createDocument({
    type,
    ownerId
  });

  state.activeDocumentId = document.id;
  state.activeDocumentType = type;
  state.selectedProductId = null;
  showToast('Borrador creado');
  await render();
}

async function saveCount(productId) {
  const input = document.getElementById('countValue');
  if (!input) return;

  const countedStock = evaluateNumericExpression(input.value);

  const line = await saveDocumentLine({
    documentId: state.activeDocumentId,
    productId,
    countedStock
  });

  const product = state.products.find(item => item.id === productId);
  const suggestion = getReplenishmentSuggestion(product, {
    stock: countedStock,
    dailyConsumption: 0
  });

  if (suggestion.suggestedQuantity > 0) {
    showToast(`Guardado · sugerencia mínima: ${suggestion.suggestedQuantity}`);
  } else {
    showToast('Guardado');
  }

  await render();
}

async function addOperationLine(type) {
  if (!state.selectedProductId) throw new Error('Selecciona un producto');

  const quantityInput = document.getElementById('operationQuantity');
  const quantity = evaluateNumericExpression(quantityInput?.value);

  if (!(quantity > 0)) throw new Error('La cantidad debe ser mayor que cero');

  const lines = await listDocumentLines(state.activeDocumentId);
  const lotNumber = type === DOCUMENT_TYPES.ENTRY
    ? document.getElementById('lotNumber')?.value?.trim() || ''
    : '';

  const existing = lines.find(line =>
    line.productId === state.selectedProductId &&
    (type !== DOCUMENT_TYPES.ENTRY || (line.lotNumber || '') === lotNumber)
  );

  const accumulatedQuantity = Number(existing?.quantity || 0) + quantity;

  const data = {
    id: existing?.id,
    documentId: state.activeDocumentId,
    productId: state.selectedProductId,
    quantity: accumulatedQuantity
  };

  if (type === DOCUMENT_TYPES.ENTRY) {
    const unitCostRaw = document.getElementById('unitCost')?.value?.trim();
    data.unitCost = unitCostRaw
      ? evaluateNumericExpression(unitCostRaw)
      : null;
    data.lotNumber = lotNumber;
    data.expiresAt = document.getElementById('expiresAt')?.value || null;
  }

  await saveDocumentLine(data);

  state.selectedProductId = null;
  showToast('Línea guardada');
  await render();
}

async function finishDocument() {
  const label = documentTitle(state.activeDocumentType).toLowerCase();
  if (!confirm(`¿Cerrar ${label}? Después del cierre ya afecta el inventario.`)) {
    return;
  }

  const result = await closeDocument(state.activeDocumentId, { userId: ownerId });

  state.activeDocumentId = null;
  state.activeDocumentType = null;
  state.selectedProductId = null;

  showToast(`Cerrado · ${result.movements?.length || 0} movimientos generados`);
  await render();
}

function mathPad(targetId) {
  return `
    <div class="math-pad" aria-label="Operaciones matemáticas">
      ${mathButton(targetId, '+', '+')}
      ${mathButton(targetId, '-', '−')}
      ${mathButton(targetId, '*', '×')}
      ${mathButton(targetId, '/', '÷')}
      ${mathButton(targetId, '(', '(')}
      ${mathButton(targetId, ')', ')')}
    </div>
  `;
}

function mathButton(target, symbol, label) {
  return `
    <button
      data-math-target="${target}"
      data-symbol="${symbol}"
      type="button"
      aria-label="${label}"
    >${label}</button>
  `;
}

function insertMathSymbol(targetId, symbol) {
  const input = document.getElementById(targetId);
  if (!input) return;

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + symbol + input.value.slice(end);
  input.focus();
  const cursor = start + symbol.length;
  input.setSelectionRange(cursor, cursor);
}

function actionCard(view, title, subtitle) {
  return `
    <button class="card action-card" data-open-view="${view}" type="button">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </button>
  `;
}

async function refreshProducts() {
  state.products = await listProducts();
}

async function refreshSaveStatus() {
  const pending = await getPendingSyncCount();
  saveStatus.textContent = pending
    ? `✓ Local · ${pending} pendientes de servidor`
    : '✓ Guardado local';
}

async function getPendingSyncCount() {
  const items = await getAll(STORES.SYNC_QUEUE);
  return items.filter(item =>
    item.status === 'PENDING' || item.status === 'FAILED'
  ).length;
}

function getLocalOwnerId() {
  const key = 'smart_inventory_v2_local_owner';
  let id = localStorage.getItem(key);

  if (!id) {
    id = createLocalId('usr_local');
    localStorage.setItem(key, id);
  }

  return id;
}

function documentTitle(type) {
  switch (type) {
    case DOCUMENT_TYPES.COUNT:
      return 'Conteo';
    case DOCUMENT_TYPES.ENTRY:
      return 'Entrada';
    case DOCUMENT_TYPES.SUPPLY:
      return 'Surtido';
    default:
      return 'Documento';
  }
}

function documentSubtitle(type) {
  switch (type) {
    case DOCUMENT_TYPES.COUNT:
      return 'Cuenta producto por producto. Cada Enter se guarda inmediatamente.';
    case DOCUMENT_TYPES.ENTRY:
      return 'Registra mercancía recibida con costo, lote y vencimiento opcionales.';
    case DOCUMENT_TYPES.SUPPLY:
      return 'Prepara la salida interna como un carrito y ciérrala cuando esté lista.';
    default:
      return '';
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es');
}

function formatSigned(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
  refreshSaveStatus().catch(() => {});
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  navigator.serviceWorker.register('./sw.js').catch(error => {
    console.warn('Service Worker no disponible:', error);
  });
}

function renderFatal(error) {
  console.error(error);
  saveStatus.textContent = 'Error de inicio';
  appRoot.innerHTML = `
    <section class="card">
      <h2>No se pudo iniciar Smart Inventory V2</h2>
      <p>${escapeHtml(error?.message || String(error))}</p>
    </section>
  `;
}
