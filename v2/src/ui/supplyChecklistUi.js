import { STORES, getAll } from '../storage/database.js';
import { getLiveSupplyCartSummary } from '../documents/liveSupplyService.js';
import {
  buildSupplyChecklistModel,
  loadSupplyChecklistState,
  setSupplyChecklistItemChecked,
  clearSupplyChecklistState
} from '../documents/supplyChecklistService.js';

const appRoot = document.getElementById('app');
let enhancing = false;
let openCartId = '';

if (appRoot) {
  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceChecklistButton().catch(reportError));
  });
  observer.observe(appRoot, { childList: true, subtree: true });

  appRoot.addEventListener('click', event => {
    const open = event.target.closest('[data-supply-checklist-open]');
    if (open) {
      event.preventDefault();
      openSupplyChecklist(open).catch(reportError);
    }
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-supply-checklist-close]')) {
      closeSupplyChecklist();
      return;
    }

    if (event.target.closest('[data-supply-checklist-clear]')) {
      clearChecklist().catch(reportError);
      return;
    }

    if (event.target.closest('[data-supply-checklist-all]')) {
      markAllChecklist().catch(reportError);
      return;
    }

    const overlay = event.target.closest('.v88-checklist-overlay');
    if (overlay && event.target === overlay) {
      closeSupplyChecklist();
    }
  });

  document.addEventListener('change', event => {
    const input = event.target.closest('[data-supply-checklist-item]');
    if (!input) return;
    saveChecklistItem(input).catch(reportError);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('.v88-checklist-overlay')) {
      closeSupplyChecklist();
    }
  });

  queueMicrotask(() => enhanceChecklistButton().catch(reportError));
}

async function enhanceChecklistButton() {
  if (enhancing) return;

  const panel = appRoot?.querySelector('.v5-live-supply-panel');
  if (!panel) return;
  if (panel.querySelector('[data-supply-checklist-open]')) return;

  enhancing = true;
  try {
    const button = document.createElement('button');
    button.className = 'secondary v88-checklist-open';
    button.type = 'button';
    button.dataset.supplyChecklistOpen = '1';
    button.innerHTML = '☑ Hoja de surtido';

    const actions = panel.querySelector('.v5-live-batch-actions');
    if (actions) {
      actions.appendChild(button);
    } else {
      const rule = panel.querySelector('.v5-live-rule');
      if (rule) rule.insertAdjacentElement('afterend', button);
      else panel.prepend(button);
    }
  } finally {
    enhancing = false;
  }
}

async function openSupplyChecklist(button) {
  const panel = button.closest('.v5-live-supply-panel');
  const parentCartId = String(panel?.dataset.liveDocumentId || '').trim();
  if (!parentCartId) throw new Error('No se identificó el Surtido');

  openCartId = parentCartId;
  await renderChecklist(parentCartId);
}

async function renderChecklist(parentCartId) {
  const [summary, products, categories, checkedState] = await Promise.all([
    getLiveSupplyCartSummary(parentCartId),
    getAll(STORES.PRODUCTS),
    getAll(STORES.CATEGORIES),
    loadSupplyChecklistState(parentCartId)
  ]);

  const model = buildSupplyChecklistModel({
    summary,
    products,
    categories,
    checkedState
  });

  document.querySelector('.v88-checklist-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'v88-checklist-overlay';
  overlay.innerHTML = `
    <section class="v88-checklist-dialog" role="dialog" aria-modal="true" aria-label="Hoja de surtido">
      <header class="v88-checklist-head">
        <div>
          <div class="v88-checklist-eyebrow">PREPARACIÓN · SIN MOVIMIENTOS</div>
          <h2>Hoja de surtido</h2>
          <p>Marca cada producto mientras preparas. Los checks no descuentan stock ni registran una entrega.</p>
        </div>
        <button class="danger" data-supply-checklist-close type="button">Cerrar</button>
      </header>

      <div class="v88-checklist-progress">
        <strong data-supply-checklist-progress>${model.checkedCount} / ${model.pendingCount} listos</strong>
        <div class="v88-checklist-progress-track">
          <i style="width:${progressPercent(model)}%" data-supply-checklist-progress-bar></i>
        </div>
      </div>

      <div class="v88-checklist-toolbar">
        <button class="secondary" data-supply-checklist-all type="button">✓ Marcar todo</button>
        <button class="secondary" data-supply-checklist-clear type="button">× Limpiar checks</button>
      </div>

      <div class="v88-checklist-body">
        ${model.groups.length
          ? model.groups.map(renderGroup).join('')
          : '<div class="empty compact-empty">No hay productos pendientes por preparar.</div>'}
      </div>
    </section>
  `;

  document.body.appendChild(overlay);
}

function renderGroup(group) {
  return `
    <section class="v88-checklist-group">
      <h3>${escapeHtml(group.category)}</h3>
      <div class="v88-checklist-columns" aria-hidden="true">
        <strong>PRODUCTO</strong>
        <strong>CANT.</strong>
        <strong>OK</strong>
      </div>
      <div class="v88-checklist-rows">
        ${group.rows.map(row => `
          <label class="v88-checklist-row ${row.checked ? 'checked' : ''}">
            <span class="v88-checklist-product">${escapeHtml(row.productName)}</span>
            <strong class="v88-checklist-quantity">${escapeHtml(row.quantityText)}</strong>
            <input
              type="checkbox"
              data-supply-checklist-item
              data-product-id="${escapeHtml(row.productId)}"
              data-quantity="${escapeHtml(String(row.quantity))}"
              ${row.checked ? 'checked' : ''}
              aria-label="Marcar ${escapeHtml(row.productName)}"
            >
          </label>
        `).join('')}
      </div>
    </section>
  `;
}

async function saveChecklistItem(input) {
  if (!openCartId) return;

  await setSupplyChecklistItemChecked(
    openCartId,
    input.dataset.productId,
    Number(input.dataset.quantity),
    input.checked
  );

  input.closest('.v88-checklist-row')?.classList.toggle('checked', input.checked);
  updateProgressFromDom();
}

async function markAllChecklist() {
  if (!openCartId) return;

  const inputs = [...document.querySelectorAll('[data-supply-checklist-item]')];
  for (const input of inputs) {
    input.checked = true;
    await setSupplyChecklistItemChecked(
      openCartId,
      input.dataset.productId,
      Number(input.dataset.quantity),
      true
    );
    input.closest('.v88-checklist-row')?.classList.add('checked');
  }

  updateProgressFromDom();
}

async function clearChecklist() {
  if (!openCartId) return;
  await clearSupplyChecklistState(openCartId);
  await renderChecklist(openCartId);
}

function updateProgressFromDom() {
  const inputs = [...document.querySelectorAll('[data-supply-checklist-item]')];
  const checked = inputs.filter(input => input.checked).length;
  const total = inputs.length;
  const label = document.querySelector('[data-supply-checklist-progress]');
  const bar = document.querySelector('[data-supply-checklist-progress-bar]');

  if (label) label.textContent = `${checked} / ${total} listos`;
  if (bar) bar.style.width = `${total ? Math.round((checked / total) * 100) : 0}%`;
}

function progressPercent(model) {
  return model.pendingCount
    ? Math.round((model.checkedCount / model.pendingCount) * 100)
    : 0;
}

function closeSupplyChecklist() {
  document.querySelector('.v88-checklist-overlay')?.remove();
  openCartId = '';
}

function reportError(error) {
  console.error('VIGÍA Hoja de surtido:', error);
  showToast(error?.message || String(error));
}

function showToast(message) {
  document.querySelector('.v88-checklist-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast v88-checklist-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
