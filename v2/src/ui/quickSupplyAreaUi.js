import { evaluateNumericExpression } from '../core/mathExpression.js';
import { listAreas } from '../areas/areaService.js';
import {
  loadAreaAllocationDrafts,
  saveAreaAllocationDraft
} from '../areas/supplyAreaDeliveryService.js';
import { mergeQuickAreaAllocation } from '../areas/quickSupplyAreaService.js';

const appRoot = document.getElementById('app');
const EPSILON = 0.000001;
const recentDrafts = new Map();
let activeAreas = [];
let areasLoadedAt = 0;
let areasLoading = null;
let selectedSupplyAreaId = null;
let selectedProductKey = '';
let enhancing = false;

if (appRoot) {
  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceQuickSupplyArea().catch(reportError));
  });
  observer.observe(appRoot, { childList: true, subtree: true });

  appRoot.addEventListener('click', event => {
    const areaButton = event.target.closest('[data-action="select-quick-supply-area"]');
    if (areaButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleQuickArea(areaButton.dataset.quickSupplyArea);
      return;
    }

    const addButton = event.target.closest('[data-action="add-line"][data-type="SUPPLY"]');
    if (!addButton) return;
    scheduleQuickAllocationCapture();
  }, true);

  appRoot.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target?.id !== 'operationQuantity') return;
    if (!isSupplyEditor()) return;
    scheduleQuickAllocationCapture();
  }, true);

  window.addEventListener('online', () => {
    areasLoadedAt = 0;
    queueMicrotask(() => enhanceQuickSupplyArea().catch(reportError));
  });

  queueMicrotask(() => enhanceQuickSupplyArea().catch(reportError));
}

async function enhanceQuickSupplyArea() {
  if (!appRoot || enhancing) return;
  enhancing = true;
  try {
    syncRecentDraftsToVisibleRows();

    if (!isSupplyEditor()) {
      selectedSupplyAreaId = null;
      selectedProductKey = '';
      return;
    }

    const selectedCard = appRoot.querySelector('.document-editor-card .selected-product-v2');
    const quantityInput = document.getElementById('operationQuantity');
    const addButton = appRoot.querySelector(
      '.document-editor-card [data-action="add-line"][data-type="SUPPLY"]'
    );
    if (!selectedCard || !quantityInput || !addButton) return;

    const productKey = selectedCard.textContent.replace(/\s+/g, ' ').trim();
    if (productKey !== selectedProductKey) {
      selectedProductKey = productKey;
      selectedSupplyAreaId = null;
    }

    await ensureAreas();
    if (!activeAreas.length) return;

    let quickPanel = appRoot.querySelector('.v86-quick-area-panel');
    if (!quickPanel) {
      quickPanel = document.createElement('section');
      quickPanel.className = 'v86-quick-area-panel';
      quickPanel.innerHTML = `
        <div class="v86-quick-area-head">
          <div>
            <strong>Destino opcional</strong>
            <small>Un toque asigna esta cantidad. Sin marcar, puedes repartirla después.</small>
          </div>
          <span data-quick-area-state>Sin área</span>
        </div>
        <div class="v86-quick-area-grid" role="group" aria-label="Destino rápido del surtido">
          ${activeAreas.map(area => `
            <button
              class="v86-quick-area-button"
              data-action="select-quick-supply-area"
              data-quick-supply-area="${escapeHtml(area.id)}"
              type="button"
              aria-pressed="false"
            >${escapeHtml(area.name)}</button>
          `).join('')}
        </div>
      `;
      addButton.insertAdjacentElement('beforebegin', quickPanel);
    }

    paintQuickAreaSelection();
  } finally {
    enhancing = false;
  }
}

async function ensureAreas() {
  if (activeAreas.length && Date.now() - areasLoadedAt < 60000) return activeAreas;
  if (areasLoading) return areasLoading;

  areasLoading = (async () => {
    try {
      activeAreas = await listAreas({ refresh: navigator.onLine !== false });
    } catch (error) {
      activeAreas = await listAreas({ refresh: false }).catch(() => []);
    }
    activeAreas = activeAreas.filter(area => area?.active !== false);
    areasLoadedAt = Date.now();
    return activeAreas;
  })().finally(() => {
    areasLoading = null;
  });

  return areasLoading;
}

function toggleQuickArea(areaId) {
  const id = String(areaId || '').trim();
  selectedSupplyAreaId = selectedSupplyAreaId === id ? null : id;
  paintQuickAreaSelection();
  document.getElementById('operationQuantity')?.focus();
}

function paintQuickAreaSelection() {
  const panel = appRoot?.querySelector('.v86-quick-area-panel');
  if (!panel) return;

  panel.querySelectorAll('[data-quick-supply-area]').forEach(button => {
    const selected = button.dataset.quickSupplyArea === selectedSupplyAreaId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });

  const area = activeAreas.find(item => item.id === selectedSupplyAreaId);
  const state = panel.querySelector('[data-quick-area-state]');
  if (state) {
    const nextStateText = area ? `✓ ${area.name}` : 'Sin área';

    // V8.6.1: este módulo escucha childList con MutationObserver. Asignar
    // textContent aunque el texto no cambie reemplaza el nodo de texto y
    // vuelve a despertar el observer. Solo escribimos cuando hay un cambio
    // real para cortar la realimentación y mantener estable el hilo principal.
    if (state.textContent !== nextStateText) {
      state.textContent = nextStateText;
    }

    state.classList.toggle('selected', Boolean(area));
  }
}

function scheduleQuickAllocationCapture() {
  const snapshot = captureQuickAllocationContext();
  if (!snapshot) return;

  // app.js mantiene la autoridad sobre guardar la línea. Nosotros esperamos
  // el rerender exitoso y solo entonces anexamos la clasificación por área.
  setTimeout(() => {
    applyQuickAllocationAfterSave(snapshot).catch(reportError);
  }, 0);
}

function captureQuickAllocationContext() {
  const input = document.getElementById('operationQuantity');
  const card = appRoot?.querySelector('.document-editor-card .selected-product-v2');
  if (!input || !card || !isSupplyEditor()) return null;

  let addedQuantity;
  try {
    addedQuantity = evaluateNumericExpression(input.value);
  } catch (_) {
    return null;
  }
  if (!(addedQuantity > EPSILON)) return null;

  const documentId = activeSupplyDocumentId();
  if (!documentId) return null;

  const productName = card.querySelector('strong')?.textContent?.trim() || '';
  const baselineRows = visibleSupplyRows();
  const area = activeAreas.find(item => item.id === selectedSupplyAreaId) || null;

  return {
    documentId,
    productName,
    addedQuantity,
    baselineRows,
    area: area ? { id: area.id, name: area.name } : null
  };
}

async function applyQuickAllocationAfterSave(snapshot) {
  const row = await waitForChangedSupplyRow(snapshot);
  if (!row || !(row.pending > EPSILON)) return;

  const previous = snapshot.baselineRows.get(row.productId);
  const pendingIncrease = previous
    ? Math.max(0, round(row.pending - previous.pending))
    : Math.min(snapshot.addedQuantity, row.pending);
  const areaIncrement = snapshot.area
    ? Math.min(snapshot.addedQuantity, pendingIncrease)
    : 0;

  const drafts = await loadAreaAllocationDrafts(snapshot.documentId, {
    refresh: false
  });
  const existingDraft = drafts.find(item => item.productId === row.productId) || null;

  if (!snapshot.area && !existingDraft) {
    clearQuickAreaAfterSuccessfulAdd();
    return;
  }

  const merged = mergeQuickAreaAllocation({
    existingDraft,
    parentCartId: snapshot.documentId,
    productId: row.productId,
    productName: row.productName || snapshot.productName || row.productId,
    totalQuantity: row.pending,
    addedQuantity: areaIncrement,
    area: areaIncrement > EPSILON ? snapshot.area : null
  });

  const saved = await saveAreaAllocationDraft(merged, { sync: true });
  recentDrafts.set(draftKey(snapshot.documentId, row.productId), saved || merged);
  clearQuickAreaAfterSuccessfulAdd();
  syncRecentDraftsToVisibleRows();
}

async function waitForChangedSupplyRow(snapshot) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await delay(attempt === 0 ? 40 : 60);
    const rows = visibleSupplyRows();
    const candidates = [];

    for (const current of rows.values()) {
      const previous = snapshot.baselineRows.get(current.productId);
      const changed = !previous || Math.abs(current.pending - previous.pending) > EPSILON;
      if (changed) candidates.push(current);
    }

    const byName = candidates.find(item => item.productName === snapshot.productName);
    if (byName) return byName;
    if (candidates.length === 1) return candidates[0];

    // Si el producto estaba sobre-entregado, aumentar el plan puede no cambiar
    // todavía el pendiente accionable. En ese caso no hay cantidad nueva que
    // clasificar y evitamos inventar un reparto.
    const unchangedByName = [...rows.values()].find(
      item => item.productName === snapshot.productName
    );
    if (attempt > 8 && unchangedByName && !snapshot.area) {
      return unchangedByName;
    }
  }
  return null;
}

function visibleSupplyRows() {
  const rows = new Map();
  appRoot?.querySelectorAll('.v5-live-row').forEach(element => {
    const select = element.querySelector('[data-live-select]');
    const quantity = element.querySelector('[data-live-qty]');
    const productId = String(select?.dataset.productId || '').trim();
    if (!productId || !quantity) return;
    rows.set(productId, {
      productId,
      productName: element.querySelector('.v5-live-product strong')?.textContent?.trim() || productId,
      pending: number(quantity.value),
      element
    });
  });
  return rows;
}

function syncRecentDraftsToVisibleRows() {
  if (!appRoot || !recentDrafts.size) return;

  appRoot.querySelectorAll('.v7-area-panel').forEach(panel => {
    const key = draftKey(panel.dataset.documentId, panel.dataset.productId);
    const draft = recentDrafts.get(key);
    if (!draft) return;

    const signature = allocationSignature(draft);
    if (panel.dataset.v86QuickDraft === signature) return;

    const byArea = new Map(
      (draft.allocations || []).map(item => [item.areaId, Number(item.quantity || 0)])
    );
    const inputs = [...panel.querySelectorAll('[data-area-allocation-input]')];
    inputs.forEach(input => {
      input.value = formatInput(byArea.get(input.dataset.areaId) || 0);
    });
    panel.dataset.v86QuickDraft = signature;

    // Reutiliza el listener V8.5 para refrescar su mapa en memoria, estado
    // visual y autoguardado. No se crea una segunda lógica de reparto.
    inputs[0]?.dispatchEvent(new Event('input', { bubbles: true }));
    recentDrafts.delete(key);
  });
}

function clearQuickAreaAfterSuccessfulAdd() {
  selectedSupplyAreaId = null;
  selectedProductKey = '';
  paintQuickAreaSelection();
}

function activeSupplyDocumentId() {
  const liveId = appRoot?.querySelector('.v5-live-supply-panel')?.dataset.liveDocumentId;
  if (liveId) return String(liveId).trim();
  const editor = appRoot?.querySelector('.document-editor-card');
  const heading = editor?.querySelector('.section-head h3');
  if (heading?.textContent.trim() !== 'Surtido') return '';
  return String(editor.querySelector('.section-head p')?.textContent || '').trim();
}

function isSupplyEditor() {
  return appRoot?.querySelector('.document-editor-card .section-head h3')
    ?.textContent.trim() === 'Surtido';
}

function allocationSignature(draft) {
  return JSON.stringify({
    quantity: Number(draft.quantity || 0),
    allocations: (draft.allocations || []).map(item => [
      item.areaId,
      Number(item.quantity || 0)
    ])
  });
}

function draftKey(parentCartId, productId) {
  return `${String(parentCartId || '').trim()}::${String(productId || '').trim()}`;
}

function number(value) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
}

function formatInput(value) {
  const numberValue = round(value);
  return Number.isInteger(numberValue) ? String(numberValue) : String(numberValue);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function reportError(error) {
  console.warn('VIGÍA área rápida: no se pudo aplicar la asignación.', error);
}
