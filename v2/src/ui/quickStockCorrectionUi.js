import { evaluateNumericExpression } from '../core/mathExpression.js';
import { getCurrentSession } from '../admin/adminClient.js';
import { STORES, get } from '../storage/database.js';
import { syncNow } from '../sync/syncEngine.js';
import {
  catalogQuantityDisplay,
  catalogUnitCode
} from '../catalog/catalogUi.js';
import {
  applyQuickStockCorrection,
  previewQuickStockCorrection
} from '../inventory/quickStockCorrectionService.js';
import { getCurrentStock } from '../inventory/movementService.js';

const app = document.getElementById('app');
let decorating = false;
let actionRunning = false;
let modalState = null;

if (app) {
  const observer = new MutationObserver(() => {
    queueMicrotask(() => decorateQuickStockActions().catch(reportError));
  });

  observer.observe(app, { childList: true, subtree: true });

  app.addEventListener('click', event => {
    const button = event.target.closest('[data-quick-stock-open]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    openCorrectionFromButton(button).catch(error => {
      reportError(error);
      toast(error.message || String(error), 'danger');
    });
  });

  app.addEventListener('input', event => {
    if (!event.target.matches('[data-live-qty]')) return;
    const row = event.target.closest('.v5-live-row');
    if (!row) return;
    refreshSupplyRow(row).catch(reportError);
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-quick-stock-close]')) {
      event.preventDefault();
      closeModal();
      return;
    }

    const applyButton = event.target.closest('[data-quick-stock-apply]');
    if (!applyButton) return;
    event.preventDefault();
    applyModalCorrection(applyButton).catch(error => {
      reportError(error);
      toast(error.message || String(error), 'danger');
    });
  });

  document.addEventListener('input', event => {
    if (!event.target.matches('[data-quick-stock-target]')) return;
    updateModalPreview().catch(reportError);
  });

  decorateQuickStockActions().catch(() => {});
}

async function decorateQuickStockActions() {
  if (!app || decorating || actionRunning) return;
  decorating = true;

  try {
    const session = await safeSession();
    if (!isGod(session)) {
      app.querySelectorAll('[data-quick-stock-injected]')
        .forEach(node => node.remove());
      return;
    }

    await Promise.all([
      decorateCatalog(session),
      decorateSupply(session)
    ]);
  } finally {
    decorating = false;
  }
}

async function decorateCatalog() {
  const editButtons = [...app.querySelectorAll(
    '[data-action="edit-product"][data-product-id]'
  )];

  for (const editButton of editButtons) {
    const productId = editButton.dataset.productId;
    if (!productId) continue;

    const host = editButton.parentElement;
    if (!host || host.querySelector(
      `[data-quick-stock-injected="catalog-${cssEscape(productId)}"]`
    )) continue;

    const product = await get(STORES.PRODUCTS, productId);
    if (!product || product.active === false || product.saintBridgeSource === true) {
      continue;
    }

    const button = document.createElement('button');
    button.className = 'catalog-edit-link quick-stock-catalog-link';
    button.type = 'button';
    button.dataset.quickStockOpen = 'catalog';
    button.dataset.productId = productId;
    button.dataset.quickStockInjected = `catalog-${productId}`;
    button.textContent = '👑 Corregir stock';
    editButton.insertAdjacentElement('afterend', button);
  }
}

async function decorateSupply() {
  const panel = app.querySelector('.v5-live-supply-panel[data-live-document-id]');
  if (!panel) return;

  const documentId = panel.dataset.liveDocumentId;
  const documentRecord = documentId
    ? await get(STORES.DOCUMENTS, documentId)
    : null;
  const locationId = documentRecord?.locationId || null;

  const rows = [...panel.querySelectorAll('.v5-live-row')];
  for (const row of rows) {
    row.dataset.quickStockLocationId = locationId || '';
    row.dataset.quickStockDocumentId = documentId || '';
    await refreshSupplyRow(row);
  }
}

async function refreshSupplyRow(row) {
  const qtyInput = row.querySelector('[data-live-qty][data-product-id]');
  if (!qtyInput) return;

  const productId = qtyInput.dataset.productId;
  const locationId = row.dataset.quickStockLocationId || null;
  const currentStock = await getCurrentStock(productId, { locationId });
  const requested = safeExpression(qtyInput.value);
  const shortage = Math.max(0, round(requested - currentStock));

  let status = row.querySelector('.quick-stock-supply-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'quick-stock-supply-status';
    status.dataset.quickStockInjected = `supply-${productId}`;
    const productHost = row.querySelector('.v5-live-product');
    productHost?.appendChild(status);
  }

  status.innerHTML = `
    <span>Stock VIGÍA <strong>${escapeHtml(format(currentStock))}</strong></span>
    ${shortage > 0
      ? `<span class="status-danger">Faltan <strong>${escapeHtml(format(shortage))}</strong></span>`
      : '<span class="status-good">Disponible</span>'}
  `;

  let button = row.querySelector('[data-quick-stock-open="supply"]');
  if (shortage > 0) {
    if (!button) {
      button = document.createElement('button');
      button.className = 'danger quick-stock-supply-button';
      button.type = 'button';
      button.dataset.quickStockOpen = 'supply';
      button.dataset.productId = productId;
      button.dataset.quickStockInjected = `supply-button-${productId}`;
      const actions = row.querySelector('.v5-live-row-actions');
      actions?.prepend(button);
    }

    if (button) {
      button.dataset.requiredStock = String(requested);
      button.dataset.locationId = locationId || '';
      button.dataset.documentId = row.dataset.quickStockDocumentId || '';
      button.textContent = currentStock <= 0
        ? '👑 Stock 0 · corregir y continuar'
        : `👑 Corregir stock · faltan ${format(shortage)}`;
    }
  } else {
    button?.remove();
  }
}

async function openCorrectionFromButton(button) {
  const session = await safeSession();
  if (!isGod(session)) {
    throw new Error('Solo el rol DIOS puede corregir stock directamente');
  }

  const productId = button.dataset.productId;
  const product = await get(STORES.PRODUCTS, productId);
  if (!product) throw new Error('Producto no encontrado');

  const source = button.dataset.quickStockOpen === 'supply'
    ? 'SUPPLY'
    : 'CATALOG';
  const locationId = button.dataset.locationId || null;
  const requiredStock = source === 'SUPPLY'
    ? Number(button.dataset.requiredStock || 0)
    : 0;
  const documentId = button.dataset.documentId || null;
  const currentStock = await getCurrentStock(productId, { locationId });

  modalState = {
    product,
    productId,
    source,
    locationId,
    documentId,
    requiredStock,
    currentStock,
    session,
    opener: button
  };

  renderModal();
}

function renderModal() {
  closeModal({ preserveState: true });
  if (!modalState) return;

  const { product, currentStock, source, requiredStock } = modalState;
  const unitCode = catalogUnitCode(product);
  const overlay = document.createElement('div');
  overlay.className = 'quick-stock-modal-backdrop';
  overlay.id = 'quickStockCorrectionModal';
  overlay.innerHTML = `
    <section class="quick-stock-modal" role="dialog" aria-modal="true" aria-labelledby="quickStockTitle">
      <div class="quick-stock-modal-head">
        <div>
          <div class="product-meta quick-stock-eyebrow">GOD 👑 · CORRECCIÓN TRAZABLE</div>
          <h3 id="quickStockTitle">Corregir existencia física</h3>
          <p>${escapeHtml(product.name)}</p>
        </div>
        <button class="icon-button" data-quick-stock-close type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="quick-stock-current-grid">
        <div><small>Stock VIGÍA actual</small><strong>${escapeHtml(format(currentStock))} ${escapeHtml(unitCode)}</strong></div>
        ${source === 'SUPPLY' ? `
          <div><small>Entrega que intentas hacer</small><strong>${escapeHtml(format(requiredStock))} ${escapeHtml(unitCode)}</strong></div>
        ` : `
          <div><small>Origen</small><strong>Catálogo</strong></div>
        `}
      </div>

      ${source === 'SUPPLY' ? `
        <div class="quick-stock-context-note">
          Declara la <strong>existencia física real que hay ahora</strong>, no solamente la cantidad que quieres surtir.
          Debe ser al menos ${escapeHtml(format(requiredStock))} ${escapeHtml(unitCode)} para continuar esa entrega.
        </div>
      ` : ''}

      <label>
        Existencia física real
        <input
          data-quick-stock-target
          inputmode="decimal"
          autocomplete="off"
          placeholder="Ej. 12 o 24+6"
          autofocus
        >
      </label>

      <div class="math-pad quick-stock-math-pad" aria-label="Operaciones matemáticas">
        ${mathButton('+', '+')}
        ${mathButton('-', '−')}
        ${mathButton('*', '×')}
        ${mathButton('/', '÷')}
        ${mathButton('(', '(')}
        ${mathButton(')', ')')}
      </div>

      <label>
        Motivo obligatorio
        <input
          data-quick-stock-reason
          autocomplete="off"
          value="${source === 'SUPPLY'
            ? 'Existencia física no registrada al surtir'
            : 'Corrección física confirmada por GOD'}"
        >
      </label>

      <div class="quick-stock-preview" data-quick-stock-preview>
        Escribe la existencia física para calcular el ajuste.
      </div>

      <div class="quick-stock-rule">
        <strong>VIGÍA no edita stock.</strong>
        Creará un movimiento ADJUSTMENT con usuario, motivo, stock anterior y objetivo. El stock negativo sigue prohibido.
      </div>

      <div class="quick-stock-modal-actions">
        <button class="secondary" data-quick-stock-close type="button">Cancelar</button>
        <button class="danger" data-quick-stock-apply type="button" disabled>👑 Aplicar corrección</button>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);
  bindMathPad(overlay);
  requestAnimationFrame(() =>
    overlay.querySelector('[data-quick-stock-target]')?.focus()
  );
}

function bindMathPad(overlay) {
  overlay.querySelectorAll('[data-quick-stock-symbol]').forEach(button => {
    button.addEventListener('click', () => {
      const input = overlay.querySelector('[data-quick-stock-target]');
      if (!input) return;
      const symbol = button.dataset.quickStockSymbol || '';
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = `${input.value.slice(0, start)}${symbol}${input.value.slice(end)}`;
      const next = start + symbol.length;
      input.setSelectionRange(next, next);
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

function mathButton(symbol, label) {
  return `<button data-quick-stock-symbol="${escapeHtml(symbol)}" type="button">${escapeHtml(label)}</button>`;
}

async function updateModalPreview() {
  const overlay = document.getElementById('quickStockCorrectionModal');
  if (!overlay || !modalState) return;

  const input = overlay.querySelector('[data-quick-stock-target]');
  const previewHost = overlay.querySelector('[data-quick-stock-preview]');
  const applyButton = overlay.querySelector('[data-quick-stock-apply]');
  const raw = String(input?.value || '').trim();

  if (!raw) {
    previewHost.textContent = 'Escribe la existencia física para calcular el ajuste.';
    applyButton.disabled = true;
    return;
  }

  try {
    const target = evaluateNumericExpression(raw);
    const preview = await previewQuickStockCorrection(modalState.productId, {
      targetStock: target,
      locationId: modalState.locationId
    });
    const unit = catalogUnitCode(modalState.product);
    const supplyBlocked =
      modalState.source === 'SUPPLY' &&
      target + 0.000001 < modalState.requiredStock;
    const large = preview.changeRatio >= 0.5 && Math.abs(preview.delta) > 0.000001;

    previewHost.className = `quick-stock-preview ${supplyBlocked ? 'blocked' : large ? 'warning' : 'ready'}`;
    previewHost.innerHTML = `
      <div><small>Antes</small><strong>${escapeHtml(format(preview.currentStock))} ${escapeHtml(unit)}</strong></div>
      <div><small>Nuevo físico</small><strong>${escapeHtml(format(preview.targetStock))} ${escapeHtml(unit)}</strong></div>
      <div><small>ADJUSTMENT</small><strong>${escapeHtml(signed(preview.delta))} ${escapeHtml(unit)}</strong></div>
      ${supplyBlocked
        ? `<p>⚠ Con ${escapeHtml(format(target))} todavía no alcanza para entregar ${escapeHtml(format(modalState.requiredStock))}.</p>`
        : large
          ? '<p>⚠ Cambio grande: revisa el físico antes de confirmar.</p>'
          : ''}
    `;

    applyButton.disabled = supplyBlocked || Math.abs(preview.delta) <= 0.000001;
    applyButton.dataset.previewDelta = String(preview.delta);
    applyButton.dataset.previewRatio = String(preview.changeRatio);
  } catch (error) {
    previewHost.className = 'quick-stock-preview blocked';
    previewHost.textContent = error.message || String(error);
    applyButton.disabled = true;
  }
}

async function applyModalCorrection(button) {
  if (actionRunning || !modalState) return;
  const overlay = document.getElementById('quickStockCorrectionModal');
  if (!overlay) return;

  const targetInput = overlay.querySelector('[data-quick-stock-target]');
  const reasonInput = overlay.querySelector('[data-quick-stock-reason]');
  const targetStock = evaluateNumericExpression(targetInput?.value || '');
  const reason = String(reasonInput?.value || '').trim();
  const ratio = Number(button.dataset.previewRatio || 0);
  const delta = Number(button.dataset.previewDelta || 0);

  if (modalState.source === 'SUPPLY' && targetStock + 0.000001 < modalState.requiredStock) {
    throw new Error('La existencia declarada todavía no cubre la entrega seleccionada');
  }

  const confirmation = ratio >= 0.5
    ? `AJUSTE GRANDE\n\n${modalState.product.name}\nCambio: ${signed(delta)} ${catalogUnitCode(modalState.product)}\n\n¿Confirmas que verificaste físicamente esta existencia?`
    : `${modalState.product.name}\nAjuste: ${signed(delta)} ${catalogUnitCode(modalState.product)}\n\n¿Aplicar corrección trazable?`;

  if (!window.confirm(confirmation)) return;

  actionRunning = true;
  button.disabled = true;
  button.textContent = '👑 Aplicando…';

  try {
    const result = await applyQuickStockCorrection(modalState.productId, {
      targetStock,
      reason,
      userId: modalState.session?.userId || null,
      roleCode: modalState.session?.roleCode || null,
      locationId: modalState.locationId,
      context: {
        source: modalState.source,
        documentId: modalState.documentId,
        documentType: modalState.source === 'SUPPLY' ? 'SUPPLY' : null
      }
    });

    try {
      await syncNow();
    } catch (syncError) {
      console.warn('Quick stock correction quedó en outbox:', syncError);
    }

    updateCatalogStockDom(result.product, result.targetStock);
    const source = modalState.source;
    closeModal();
    await decorateQuickStockActions();

    toast(
      source === 'SUPPLY'
        ? `Stock corregido a ${format(result.targetStock)}. Ya puedes continuar el surtido.`
        : `Stock corregido a ${format(result.targetStock)} mediante ADJUSTMENT trazable.`,
      'success'
    );

    document.dispatchEvent(new CustomEvent('vigia:quick-stock-corrected', {
      detail: result
    }));
  } finally {
    actionRunning = false;
  }
}

function updateCatalogStockDom(product, targetStock) {
  const display = catalogQuantityDisplay(product, targetStock);
  const html = `
    <strong>${escapeHtml(display.baseText)}</strong>
    ${display.humanText ? `<small>${escapeHtml(display.humanText)}</small>` : ''}
  `;

  document.querySelectorAll(
    `[data-action="edit-product"][data-product-id="${cssEscape(product.id)}"]`
  ).forEach(editButton => {
    const row = editButton.closest('tr');
    row?.querySelector('.catalog-stock-value') &&
      (row.querySelector('.catalog-stock-value').innerHTML = html);

    const card = editButton.closest('.catalog-mobile-card');
    const stockHost = card?.querySelector('.catalog-mobile-stats > div:first-child');
    if (stockHost) stockHost.innerHTML = `<small>Stock</small>${html}`;
  });
}

function closeModal({ preserveState = false } = {}) {
  document.getElementById('quickStockCorrectionModal')?.remove();
  if (!preserveState) modalState = null;
}

async function safeSession() {
  try {
    return await getCurrentSession();
  } catch (_) {
    return null;
  }
}

function isGod(session) {
  return String(session?.roleCode || '').trim().toUpperCase() === 'GOD';
}

function safeExpression(raw) {
  try {
    return Math.max(0, evaluateNumericExpression(String(raw || '0')));
  } catch (_) {
    return 0;
  }
}

function signed(value) {
  const number = round(value);
  return `${number > 0 ? '+' : ''}${format(number)}`;
}

function format(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 3
  }).format(number);
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}

function toast(message, tone = '') {
  const node = document.createElement('div');
  node.className = `v5-toast ${tone ? `v5-toast-${tone}` : ''}`;
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4600);

  const status = document.getElementById('saveStatus');
  if (status) status.textContent = String(message || 'Listo');
}

function reportError(error) {
  console.error('V5 quick stock correction:', error);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value || ''));
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
