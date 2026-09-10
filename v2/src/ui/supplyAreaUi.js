import { getCurrentSession } from '../admin/adminClient.js';
import { listAreas } from '../areas/areaService.js';
import {
  createAreaDeliveryIntent,
  completeAreaDelivery,
  failAreaDeliveryIntent,
  getLastAreaPattern,
  reconcilePendingAreaDeliveries,
  syncPendingAreaDeliveries
} from '../areas/supplyAreaDeliveryService.js';
import {
  createLiveSupplyDeliveryToken,
  dispatchLiveSupply
} from '../documents/liveSupplyService.js';

const appRoot = document.getElementById('app');
const EPSILON = 0.000001;
const drafts = new Map();
let activeAreas = [];
let lastAreaRefreshAt = 0;
let enhancing = false;
let deliveryRunning = false;

if (appRoot) {
  const observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(appRoot, { childList: true, subtree: true });

  appRoot.addEventListener('input', event => {
    const input = event.target.closest('[data-area-allocation-input]');
    if (!input) return;
    persistPanelDraft(input.closest('.v7-area-panel'));
    updatePanelState(input.closest('.v7-area-panel'));
  });

  appRoot.addEventListener('change', event => {
    const input = event.target.closest('[data-live-qty]');
    if (!input) return;
    const row = input.closest('.v5-live-row');
    const panel = row?.querySelector('.v7-area-panel');
    if (panel) updatePanelState(panel);
  });

  appRoot.addEventListener('click', event => {
    handleAreaClick(event).catch(error => showAreaToast(error.message || String(error), 'danger'));
  });

  // Interceptamos antes del listener V5-E solo cuando existen áreas activas.
  // Así la entrega física sigue usando dispatchLiveSupply EXACT-ONCE, mientras
  // la clasificación por área se registra como contexto separado y trazable.
  appRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-v5-live-action="deliver-selected"]');
    if (!button || activeAreas.length === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    deliverWithAreas(button).catch(error => {
      showAreaToast(error.message || String(error), 'danger');
    });
  }, true);

  window.addEventListener('online', () => {
    syncPendingAreaDeliveries().catch(() => null);
    scheduleEnhance(true);
  });

  scheduleEnhance(true);
}

function scheduleEnhance(forceRefresh = false) {
  queueMicrotask(() => enhanceSupplyAreas(forceRefresh).catch(error => {
    console.warn('VIGÍA áreas: no se pudo mejorar Surtido.', error);
  }));
}

async function enhanceSupplyAreas(forceRefresh = false) {
  if (!appRoot || enhancing) return;
  const panel = appRoot.querySelector('.v5-live-supply-panel');
  if (!panel) return;

  enhancing = true;
  try {
    const now = Date.now();
    const refresh = forceRefresh || now - lastAreaRefreshAt > 60000;
    activeAreas = await listAreas({ refresh });
    if (refresh) lastAreaRefreshAt = now;

    await reconcilePendingAreaDeliveries().catch(() => null);
    syncPendingAreaDeliveries().catch(() => null);

    panel.dataset.v7AreaTracking = activeAreas.length ? 'active' : 'inactive';
    panel.classList.toggle('v7-area-enabled', activeAreas.length > 0);

    injectAreaRule(panel);

    if (!activeAreas.length) return;

    panel.querySelectorAll('.v5-live-row').forEach(row => {
      decorateRow(panel, row);
    });
  } finally {
    enhancing = false;
  }
}

function injectAreaRule(panel) {
  if (panel.querySelector('.v7-area-rule')) return;

  const rule = document.createElement('div');
  rule.className = `v7-area-rule ${activeAreas.length ? 'ready' : 'empty'}`;
  rule.innerHTML = activeAreas.length
    ? `<strong>Consumo por áreas activo.</strong> Una entrega descuenta stock una sola vez; el reparto solo clasifica a dónde fue.`
    : `<strong>Consumo por áreas disponible.</strong> Agrega áreas en Configuración para activar la distribución sin cambiar el flujo de stock.`;

  const baseRule = panel.querySelector('.v5-live-rule');
  if (baseRule) baseRule.insertAdjacentElement('afterend', rule);
  else panel.prepend(rule);
}

function decorateRow(parentPanel, row) {
  if (row.dataset.v7AreaEnhanced === '1') return;

  const select = row.querySelector('[data-live-select]');
  const productId = select?.dataset.productId;
  const quantityInput = row.querySelector('[data-live-qty]');
  if (!productId || !quantityInput || quantityInput.disabled) return;

  row.dataset.v7AreaEnhanced = '1';
  row.dataset.v7ProductId = productId;

  const actions = row.querySelector('.v5-live-row-actions');
  if (!actions) return;

  const areaButton = document.createElement('button');
  areaButton.className = 'secondary v7-area-toggle';
  areaButton.type = 'button';
  areaButton.dataset.areaAction = 'toggle';
  areaButton.innerHTML = `▦ Distribuir por áreas <span data-area-button-state>· pendiente</span>`;
  actions.prepend(areaButton);

  const allocationPanel = document.createElement('section');
  allocationPanel.className = 'v7-area-panel';
  allocationPanel.dataset.documentId = parentPanel.dataset.liveDocumentId || '';
  allocationPanel.dataset.productId = productId;
  allocationPanel.innerHTML = renderAllocationPanel(row);
  row.appendChild(allocationPanel);

  restorePanelDraft(allocationPanel);
  updatePanelState(allocationPanel);
}

function renderAllocationPanel(row) {
  const productName = row.querySelector('.v5-live-product strong')?.textContent?.trim() || 'Producto';
  const quantity = number(row.querySelector('[data-live-qty]')?.value);

  return `
    <div class="v7-area-panel-head">
      <div>
        <strong>Distribución de esta entrega</strong>
        <small>${escapeHtml(productName)} · ${format(quantity)} a repartir</small>
      </div>
      <span class="badge status-warning" data-area-badge>Pendiente</span>
    </div>

    <div class="v7-area-progress-row">
      <div class="v7-area-progress"><i data-area-progress></i></div>
      <strong data-area-total>0 / ${format(quantity)}</strong>
    </div>

    <div class="v7-area-quick-actions">
      <button class="secondary" data-area-action="repeat" type="button">↻ Repetir último reparto</button>
      <button class="secondary" data-area-action="equal" type="button">⇄ Distribuir igual</button>
      <label class="v7-area-all-to">
        <select data-area-target>
          ${activeAreas.map(area => `<option value="${escapeHtml(area.id)}">${escapeHtml(area.name)}</option>`).join('')}
        </select>
        <button class="secondary" data-area-action="all-to" type="button">→ Todo a un área</button>
      </label>
      <button class="secondary" data-area-action="clear" type="button">× Limpiar</button>
    </div>

    <div class="v7-area-grid">
      ${activeAreas.map(area => `
        <label class="v7-area-field">
          <span>${escapeHtml(area.name)}</span>
          <input
            data-area-allocation-input
            data-area-id="${escapeHtml(area.id)}"
            data-area-name="${escapeHtml(area.name)}"
            inputmode="decimal"
            autocomplete="off"
            value="0"
          >
        </label>
      `).join('')}
    </div>

    <div class="v7-area-panel-foot">
      <span class="v7-area-status" data-area-status>Distribuye toda la cantidad antes de entregar.</span>
      <small>Las áreas no crean movimientos extra.</small>
    </div>
  `;
}

async function handleAreaClick(event) {
  const button = event.target.closest('[data-area-action]');
  if (!button) return;

  const panel = button.closest('.v7-area-panel') ||
    button.closest('.v5-live-row')?.querySelector('.v7-area-panel');
  if (!panel) return;

  const action = button.dataset.areaAction;
  if (action === 'toggle') {
    panel.classList.toggle('open');
    return;
  }

  if (action === 'clear') {
    setAllocations(panel, []);
    return;
  }

  if (action === 'all-to') {
    const quantity = deliveryQuantity(panel);
    const areaId = panel.querySelector('[data-area-target]')?.value;
    setAllocations(panel, [{ areaId, quantity }]);
    return;
  }

  if (action === 'equal') {
    const quantity = deliveryQuantity(panel);
    if (!activeAreas.length || quantity <= 0) return;
    const base = Math.floor((quantity / activeAreas.length) * 1000000) / 1000000;
    let used = 0;
    const values = activeAreas.map((area, index) => {
      const value = index === activeAreas.length - 1
        ? round(quantity - used)
        : base;
      used = round(used + value);
      return { areaId: area.id, quantity: value };
    });
    setAllocations(panel, values);
    return;
  }

  if (action === 'repeat') {
    const productId = panel.dataset.productId;
    const pattern = await getLastAreaPattern(productId);
    if (!pattern.length) {
      throw new Error('Todavía no hay un reparto anterior para este producto');
    }
    const quantity = deliveryQuantity(panel);
    let used = 0;
    const usable = pattern.filter(item => activeAreas.some(area => area.id === item.areaId));
    if (!usable.length) throw new Error('Las áreas del último reparto ya no están activas');

    const values = usable.map((item, index) => {
      const value = index === usable.length - 1
        ? round(quantity - used)
        : round(quantity * item.ratio);
      used = round(used + value);
      return { areaId: item.areaId, quantity: Math.max(0, value) };
    });
    setAllocations(panel, values);
  }
}

async function deliverWithAreas(button) {
  if (deliveryRunning) return;
  const livePanel = button.closest('.v5-live-supply-panel');
  const documentId = livePanel?.dataset.liveDocumentId;
  if (!documentId) throw new Error('No se identificó el surtido activo');

  const selectedRows = [...livePanel.querySelectorAll('.v5-live-row')]
    .filter(row => row.querySelector('[data-live-select]:checked:not(:disabled)'));
  if (!selectedRows.length) throw new Error('Selecciona al menos un producto pendiente');

  const rows = selectedRows.map(row => allocationRowFromDom(row));
  const incomplete = rows.find(row => !row.complete);
  if (incomplete) {
    const panel = incomplete.element.querySelector('.v7-area-panel');
    panel?.classList.add('open');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    throw new Error(`Distribuye completamente ${incomplete.productName}`);
  }

  const session = await getCurrentSession().catch(() => null);
  const token = createLiveSupplyDeliveryToken();
  const payloadRows = rows.map(({ element, complete, ...row }) => row);

  deliveryRunning = true;
  setAreaDeliveryBusy(livePanel, true);

  try {
    await createAreaDeliveryIntent({
      deliveryToken: token,
      parentCartId: documentId,
      rows: payloadRows,
      userId: session?.userId || null
    });

    const result = await dispatchLiveSupply(documentId, {
      deliveryToken: token,
      quantities: payloadRows.map(row => ({
        productId: row.productId,
        quantity: row.quantity
      })),
      userId: session?.userId || null
    });

    await completeAreaDelivery({
      deliveryToken: token,
      deliveryId: result.deliveryId,
      closedAt: result.document?.closedAt || new Date().toISOString()
    });

    for (const row of payloadRows) {
      drafts.delete(draftKey(documentId, row.productId));
    }

    showAreaToast(
      `Entrega registrada · ${payloadRows.length} producto(s) · consumo por áreas guardado.`,
      'success'
    );

    livePanel.remove();
  } catch (error) {
    await failAreaDeliveryIntent(token, error).catch(() => null);
    throw error;
  } finally {
    deliveryRunning = false;
    setAreaDeliveryBusy(livePanel, false);
  }
}

function allocationRowFromDom(row) {
  const productId = row.dataset.v7ProductId || row.querySelector('[data-live-select]')?.dataset.productId;
  const productName = row.querySelector('.v5-live-product strong')?.textContent?.trim() || productId;
  const quantity = number(row.querySelector('[data-live-qty]')?.value);
  if (!(quantity > 0)) throw new Error(`Cantidad inválida para ${productName}`);

  const allocations = [...row.querySelectorAll('[data-area-allocation-input]')]
    .map(input => ({
      areaId: input.dataset.areaId,
      areaName: input.dataset.areaName,
      quantity: number(input.value)
    }))
    .filter(item => item.quantity > EPSILON);
  const total = round(allocations.reduce((sum, item) => sum + item.quantity, 0));

  return {
    element: row,
    productId,
    productName,
    quantity,
    allocations,
    complete: Math.abs(total - quantity) <= EPSILON
  };
}

function updatePanelState(panel) {
  if (!panel) return;
  const row = panel.closest('.v5-live-row');
  const quantity = deliveryQuantity(panel);
  const allocations = readAllocations(panel);
  const assigned = round(allocations.reduce((sum, item) => sum + item.quantity, 0));
  const remaining = round(quantity - assigned);
  const ratio = quantity > EPSILON ? Math.min(1, Math.max(0, assigned / quantity)) : 0;

  const progress = panel.querySelector('[data-area-progress]');
  if (progress) progress.style.width = `${ratio * 100}%`;
  const total = panel.querySelector('[data-area-total]');
  if (total) total.textContent = `${format(assigned)} / ${format(quantity)}`;

  const badge = panel.querySelector('[data-area-badge]');
  const status = panel.querySelector('[data-area-status]');
  const buttonState = row?.querySelector('[data-area-button-state]');
  const usedAreas = allocations.filter(item => item.quantity > EPSILON).length;

  if (quantity > 0 && Math.abs(remaining) <= EPSILON) {
    badge.textContent = 'Completo';
    badge.className = 'badge status-good';
    status.textContent = '✓ Todo lo que sale está asignado a un área.';
    status.className = 'v7-area-status status-good';
    if (buttonState) buttonState.textContent = `· ${usedAreas}`;
  } else if (remaining > 0) {
    badge.textContent = 'Pendiente';
    badge.className = 'badge status-warning';
    status.textContent = `⚠ Faltan ${format(remaining)} por asignar.`;
    status.className = 'v7-area-status status-warning';
    if (buttonState) buttonState.textContent = '· pendiente';
  } else {
    badge.textContent = 'Exceso';
    badge.className = 'badge status-danger';
    status.textContent = `⚠ La distribución excede por ${format(Math.abs(remaining))}.`;
    status.className = 'v7-area-status status-danger';
    if (buttonState) buttonState.textContent = '· revisar';
  }
}

function persistPanelDraft(panel) {
  if (!panel) return;
  drafts.set(
    draftKey(panel.dataset.documentId, panel.dataset.productId),
    readAllocations(panel)
  );
}

function restorePanelDraft(panel) {
  const stored = drafts.get(draftKey(panel.dataset.documentId, panel.dataset.productId));
  if (stored?.length) setAllocations(panel, stored, { persist: false });
}

function setAllocations(panel, values, { persist = true } = {}) {
  const byArea = new Map((values || []).map(item => [item.areaId, number(item.quantity)]));
  panel.querySelectorAll('[data-area-allocation-input]').forEach(input => {
    input.value = formatInput(byArea.get(input.dataset.areaId) || 0);
  });
  if (persist) persistPanelDraft(panel);
  updatePanelState(panel);
}

function readAllocations(panel) {
  return [...panel.querySelectorAll('[data-area-allocation-input]')]
    .map(input => ({
      areaId: input.dataset.areaId,
      areaName: input.dataset.areaName,
      quantity: number(input.value)
    }))
    .filter(item => item.quantity > EPSILON);
}

function deliveryQuantity(panel) {
  return number(panel.closest('.v5-live-row')?.querySelector('[data-live-qty]')?.value);
}

function setAreaDeliveryBusy(panel, busy) {
  if (!panel) return;
  panel.classList.toggle('v7-area-busy', busy);
  panel.querySelectorAll('button,input,select').forEach(control => {
    if (busy) {
      control.dataset.v7WasDisabled = control.disabled ? '1' : '0';
      control.disabled = true;
    } else if (control.dataset.v7WasDisabled === '0') {
      control.disabled = false;
      delete control.dataset.v7WasDisabled;
    }
  });
}

function showAreaToast(message, tone = 'success') {
  document.querySelector('.v7-area-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast v7-area-toast v7-area-toast-${tone}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function draftKey(documentId, productId) {
  return `${documentId || ''}::${productId || ''}`;
}

function number(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function round(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000000) / 1000000;
}

function format(value) {
  return Number(value || 0).toLocaleString('es-VE', { maximumFractionDigits: 6 });
}

function formatInput(value) {
  return String(round(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
