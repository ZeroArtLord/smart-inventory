import { getCurrentSession } from '../admin/adminClient.js';
import { STORES, get } from '../storage/database.js';
import {
  enableLiveSupplyCart,
  getLiveSupplyCartSummary,
  dispatchLiveSupply,
  cancelLiveSupplyRemaining,
  restoreLiveSupplyRemaining,
  finalizeLiveSupplyCart,
  createLiveSupplyDeliveryToken,
  LIVE_SUPPLY_CART_KIND,
  LIVE_SUPPLY_DELIVERY_KIND
} from '../documents/liveSupplyService.js';

const appRoot = document.getElementById('app');
let enhancing = false;
let actionRunning = false;

if (appRoot) {
  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceSupplyView().catch(reportError));
  });

  observer.observe(appRoot, {
    childList: true,
    subtree: true
  });

  appRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-v5-live-action]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    handleLiveAction(button).catch(error => {
      reportError(error);
      showLiveToast(error.message || String(error), 'danger');
    });
  });

  // Fail-closed: ningún cierre de la pantalla Surtido puede atravesar el
  // closeDocument legacy mientras todavía estamos decidiendo si se trata de
  // un carrito V5-E. Una corrección hija recibe su aviso y luego continúa por
  // el flujo legacy de corrección; el padre siempre usa finalizeLiveSupplyCart.
  appRoot.addEventListener('click', event => {
    const closeButton = event.target.closest(
      '.document-close-button[data-action="close-document"]'
    );
    if (!closeButton) return;

    const workspace = closeButton.closest('.document-workspace-v2');
    const heading = workspace?.querySelector('.document-editor-card h3');
    if (!workspace || heading?.textContent.trim() !== 'Surtido') return;

    if (workspace.querySelector('.v5-live-correction-notice')) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const documentId = activeSupplyDocumentId();
    if (!documentId) {
      showLiveToast('No se pudo identificar el surtido activo.', 'danger');
      return;
    }

    const continueSafely = async () => {
      if (!workspace.querySelector('.v5-live-supply-panel')) {
        await enhanceSupplyView();
      }

      if (workspace.querySelector('.v5-live-correction-notice')) {
        // Ya sabemos que es una entrega hija en corrección. El segundo click
        // programático atraviesa este listener gracias al aviso presente.
        closeButton.click();
        return;
      }

      if (!workspace.querySelector('.v5-live-supply-panel')) {
        throw new Error(
          'V5-E no pudo confirmar el modo seguro del surtido. No se cerró nada.'
        );
      }

      await finishLiveCart(documentId);
    };

    continueSafely().catch(error => {
      reportError(error);
      showLiveToast(error.message || String(error), 'danger');
    });
  }, true);
}

async function enhanceSupplyView() {
  if (!appRoot || enhancing || actionRunning) return;
  const workspace = appRoot.querySelector('.document-workspace-v2');
  if (!workspace) return;

  const heading = workspace.querySelector('.document-editor-card h3');
  if (!heading || heading.textContent.trim() !== 'Surtido') return;
  if (
    workspace.querySelector('.v5-live-supply-panel') ||
    workspace.querySelector('.v5-live-correction-notice')
  ) {
    return;
  }

  const documentId = activeSupplyDocumentId();
  if (!documentId) return;

  const closeButton = workspace.querySelector(
    '.document-close-button[data-action="close-document"]'
  );
  if (closeButton) {
    closeButton.disabled = true;
    closeButton.dataset.v5LiveGuard = 'pending';
  }

  enhancing = true;

  try {
    const documentRecord = await get(STORES.DOCUMENTS, documentId);
    if (!documentRecord || documentRecord.type !== 'SUPPLY') {
      releaseLegacyClose(closeButton);
      return;
    }

    // Los borradores de corrección de una entrega hija siguen el flujo
    // explícito de corrección. Nunca se convierten silenciosamente en padre.
    if (documentRecord.metadata?.kind === LIVE_SUPPLY_DELIVERY_KIND) {
      injectCorrectionNotice(workspace, documentRecord);
      releaseLegacyClose(closeButton);
      return;
    }

    if (documentRecord.status !== 'DRAFT') {
      releaseLegacyClose(closeButton);
      return;
    }

    const session = await safeSession();
    let liveDocument = documentRecord;

    if (documentRecord.metadata?.kind !== LIVE_SUPPLY_CART_KIND) {
      liveDocument = await enableLiveSupplyCart(documentId, {
        userId: session?.userId || documentRecord.ownerId || null
      });
    }

    const summary = await getLiveSupplyCartSummary(liveDocument.id);
    renderLivePanel(workspace, summary);

    if (closeButton) {
      closeButton.textContent = 'Finalizar carrito V5-E';
      closeButton.classList.add('v5-live-finalize-button');
      closeButton.disabled = false;
      closeButton.dataset.v5LiveGuard = 'ready';
    }
  } catch (error) {
    // Ante un fallo de clasificación del padre dejamos el botón bloqueado:
    // es preferible no cerrar a aplicar por accidente las líneas planificadas.
    if (closeButton) {
      closeButton.disabled = true;
      closeButton.dataset.v5LiveGuard = 'failed';
      closeButton.title = 'V5-E bloqueó el cierre hasta confirmar el modo seguro';
    }
    throw error;
  } finally {
    enhancing = false;
  }
}

function releaseLegacyClose(button) {
  if (!button) return;
  button.disabled = false;
  button.dataset.v5LiveGuard = 'legacy';
}

function renderLivePanel(workspace, summary) {
  workspace.querySelector('.v5-live-supply-panel')?.remove();

  const panel = document.createElement('article');
  panel.className = 'card v5-live-supply-panel';
  panel.dataset.liveDocumentId = summary.document.id;
  panel.innerHTML = `
    <div class="v5-live-head">
      <div>
        <div class="v5-live-eyebrow">V5-E · SURTIDO VIVO · EXACT-ONCE</div>
        <h3>Carrito abierto durante el turno</h3>
        <p>Cada <strong>Entregar</strong> crea un surtido hijo cerrado. Solo esa entrega física descuenta stock.</p>
      </div>
      <div class="v5-live-head-badges">
        <span class="badge status-good">${summary.closedDeliveryCount} entrega(s)</span>
        <span class="badge ${summary.remainingTotal > 0 ? 'status-warning' : 'status-good'}">
          ${format(summary.remainingTotal)} pendiente
        </span>
      </div>
    </div>

    <div class="v5-live-rule">
      <strong>Regla de seguridad:</strong>
      editar el carrito cambia lo planificado, pero jamás reescribe una entrega hecha. Repetir el mismo token tampoco duplica stock.
    </div>

    <div class="v5-live-kpis">
      <div><small>Planificado</small><strong>${format(summary.plannedTotal)}</strong></div>
      <div><small>Entregado neto</small><strong>${format(summary.deliveredTotal)}</strong></div>
      <div><small>Pendiente activo</small><strong>${format(summary.remainingTotal)}</strong></div>
      <div><small>Cancelado pendiente</small><strong>${format(summary.cancelledRemainingTotal)}</strong></div>
    </div>

    ${summary.overDeliveredCount ? `
      <div class="status-warning v5-live-warning">
        ⚠ ${summary.overDeliveredCount} línea(s) tienen plan actual menor que lo ya entregado. La entrega histórica no se toca; corrige el plan o usa una corrección trazable.
      </div>
    ` : ''}

    <div class="v5-live-lines">
      ${summary.rows.length
        ? summary.rows.map(renderLiveRow).join('')
        : '<div class="empty compact-empty">Agrega productos al surtido para preparar una entrega.</div>'}
    </div>

    ${summary.rows.some(row => row.actionableRemaining > 0) ? `
      <div class="v5-live-batch-actions">
        <button class="primary" data-v5-live-action="deliver-selected" type="button">
          ✓ Entregar selección ahora
        </button>
        <button class="secondary" data-v5-live-action="select-all" type="button">
          Seleccionar todo pendiente
        </button>
      </div>
    ` : ''}

    <details class="v5-live-history">
      <summary>Historial de entregas · ${summary.deliveries.length}</summary>
      <div class="v5-live-history-list">
        ${summary.deliveries.length
          ? summary.deliveries.slice().reverse().map(delivery => `
              <div class="v5-live-history-row">
                <div>
                  <strong>${escapeHtml(delivery.document.id)}</strong>
                  <small>${formatDate(delivery.document.closedAt || delivery.document.updatedAt)}</small>
                </div>
                <div>
                  <span class="badge ${delivery.document.status === 'CLOSED' ? 'status-good' : 'status-warning'}">
                    ${escapeHtml(delivery.document.status)}
                  </span>
                  <small>${delivery.netDelivered.map(item => format(item.quantity)).join(' + ') || '0 neto'}</small>
                </div>
              </div>
            `).join('')
          : '<div class="empty compact-empty">Todavía no hay entregas físicas registradas.</div>'}
      </div>
    </details>
  `;

  const editor = workspace.querySelector('.document-editor-card');
  if (editor) editor.insertAdjacentElement('afterend', panel);
  else workspace.prepend(panel);
}

function renderLiveRow(row) {
  const pending = row.actionableRemaining;
  const disabled = pending <= 0 || row.overDelivered > 0;

  return `
    <div class="v5-live-row ${row.cancelled ? 'cancelled' : ''} ${row.overDelivered > 0 ? 'warning' : ''}">
      <label class="v5-live-select">
        <input
          type="checkbox"
          data-live-select
          data-product-id="${escapeHtml(row.productId)}"
          ${disabled ? 'disabled' : 'checked'}
        >
      </label>

      <div class="v5-live-product">
        <strong>${escapeHtml(row.productName)}</strong>
        <small>
          Plan ${format(row.planned)} · Entregado ${format(row.delivered)} ·
          ${row.cancelled
            ? `Cancelado ${format(row.remaining)}`
            : `Pendiente ${format(row.remaining)}`}
        </small>
      </div>

      <label class="v5-live-qty">
        Entregar ahora
        <input
          data-live-qty
          data-product-id="${escapeHtml(row.productId)}"
          inputmode="decimal"
          value="${disabled ? '0' : escapeHtml(String(pending))}"
          ${disabled ? 'disabled' : ''}
        >
      </label>

      <div class="v5-live-row-actions">
        ${row.cancelled
          ? `<button class="secondary" data-v5-live-action="restore" data-product-id="${escapeHtml(row.productId)}" type="button">Restaurar pendiente</button>`
          : row.remaining > 0
            ? `<button class="ghost-button" data-v5-live-action="cancel-line" data-product-id="${escapeHtml(row.productId)}" type="button">Cancelar pendiente</button>`
            : '<span class="badge status-good">Completo</span>'}
      </div>
    </div>
  `;
}

async function handleLiveAction(button) {
  if (actionRunning) return;
  const documentId = button.closest('.v5-live-supply-panel')
    ?.dataset.liveDocumentId || activeSupplyDocumentId();
  if (!documentId) throw new Error('No se identificó el carrito activo');

  if (button.dataset.v5LiveAction === 'select-all') {
    appRoot.querySelectorAll('[data-live-select]:not(:disabled)')
      .forEach(input => { input.checked = true; });
    return;
  }

  actionRunning = true;
  setPanelBusy(true);

  try {
    const session = await safeSession();
    const userId = session?.userId || null;

    if (button.dataset.v5LiveAction === 'deliver-selected') {
      const quantities = selectedQuantities();
      if (!quantities.length) {
        throw new Error('Selecciona al menos un producto pendiente');
      }

      const result = await dispatchLiveSupply(documentId, {
        deliveryToken: createLiveSupplyDeliveryToken(),
        quantities,
        userId
      });

      showLiveToast(
        result.idempotent
          ? 'Entrega ya registrada: no se duplicó stock.'
          : `Entrega registrada · ${result.movements.length} movimiento(s).`,
        'success'
      );
    }

    if (button.dataset.v5LiveAction === 'cancel-line') {
      await cancelLiveSupplyRemaining(
        documentId,
        button.dataset.productId,
        {
          userId,
          reason: 'Pendiente cancelado desde surtido vivo'
        }
      );
      showLiveToast('Pendiente cancelado sin tocar entregas previas.', 'success');
    }

    if (button.dataset.v5LiveAction === 'restore') {
      await restoreLiveSupplyRemaining(
        documentId,
        button.dataset.productId,
        { userId }
      );
      showLiveToast('Pendiente restaurado.', 'success');
    }

    await rerenderLivePanel(documentId);
  } finally {
    actionRunning = false;
    setPanelBusy(false);
  }
}

async function finishLiveCart(documentId) {
  if (actionRunning) return;
  const documentRecord = await get(STORES.DOCUMENTS, documentId);
  if (documentRecord?.metadata?.kind !== LIVE_SUPPLY_CART_KIND) {
    throw new Error('El cierre seguro V5-E no encontró un carrito vivo');
  }

  actionRunning = true;
  setPanelBusy(true);

  try {
    const session = await safeSession();
    const summary = await getLiveSupplyCartSummary(documentId);
    let cancelRemaining = false;

    if (summary.remainingTotal > 0) {
      cancelRemaining = window.confirm(
        `Quedan ${format(summary.remainingTotal)} pendientes.\n\nAceptar = finalizar y cancelar lo que NO salió físicamente.\nCancelar = volver al carrito.`
      );
      if (!cancelRemaining) return;
    }

    const confirmed = window.confirm(
      '¿Finalizar el carrito vivo? Las entregas cerradas quedan inmutables y el carrito padre NO vuelve a descontar stock.'
    );
    if (!confirmed) return;

    await finalizeLiveSupplyCart(documentId, {
      userId: session?.userId || documentRecord.ownerId || null,
      cancelRemaining
    });

    showLiveToast('Carrito finalizado sin doble descuento.', 'success');
    reopenSupplyView();
  } finally {
    actionRunning = false;
    setPanelBusy(false);
  }
}

async function rerenderLivePanel(documentId) {
  const workspace = appRoot.querySelector('.document-workspace-v2');
  if (!workspace) return;
  const summary = await getLiveSupplyCartSummary(documentId);
  renderLivePanel(workspace, summary);
}

function selectedQuantities() {
  const rows = [];

  appRoot.querySelectorAll('[data-live-select]:checked')
    .forEach(check => {
      const productId = check.dataset.productId;
      const input = appRoot.querySelector(
        `[data-live-qty][data-product-id="${cssEscape(productId)}"]`
      );
      const raw = String(input?.value || '').trim().replace(',', '.');
      const quantity = Number(raw);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Cada cantidad seleccionada debe ser mayor que cero');
      }

      rows.push({ productId, quantity });
    });

  return rows;
}

function activeSupplyDocumentId() {
  const workspace = appRoot?.querySelector('.document-workspace-v2');
  const heading = workspace?.querySelector('.document-editor-card h3');
  if (!workspace || heading?.textContent.trim() !== 'Surtido') return '';
  return workspace.querySelector('.document-editor-card .section-head p')
    ?.textContent?.trim() || '';
}

function injectCorrectionNotice(workspace, documentRecord) {
  if (workspace.querySelector('.v5-live-correction-notice')) return;
  const notice = document.createElement('article');
  notice.className = 'card v5-live-correction-notice';
  notice.innerHTML = `
    <div class="status-warning">
      <strong>Corrección de entrega V5-E</strong><br>
      Este borrador proviene de una entrega ya compensada. Al cerrarlo se genera una nueva salida trazable y no se convierte en carrito padre.
    </div>
    <small>${escapeHtml(
      documentRecord.metadata?.correctionOfDocumentId ||
      documentRecord.metadata?.parentCartId ||
      documentRecord.id
    )}</small>
  `;
  workspace.prepend(notice);
}

async function safeSession() {
  try {
    return await getCurrentSession();
  } catch (_) {
    return null;
  }
}

function setPanelBusy(busy) {
  appRoot?.querySelectorAll('.v5-live-supply-panel button')
    .forEach(button => { button.disabled = busy; });
}

function reopenSupplyView() {
  const button = document.querySelector('.app-nav [data-view="supply"]');
  if (button) {
    button.click();
    return;
  }
  window.location.search = '?view=supply';
}

function showLiveToast(message, kind = '') {
  document.querySelector('.v5-live-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast v5-live-toast ${kind ? 'v5-live-toast-' + kind : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3400);
}

function reportError(error) {
  console.error('V5-E live supply:', error);
}

function format(value) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? number.toLocaleString('es', { maximumFractionDigits: 6 })
    : '0';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es');
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
