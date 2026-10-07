import { getCurrentSession } from '../admin/adminClient.js';
import {
  STORES,
  get,
  getAllByIndex
} from '../storage/database.js';
import {
  RECONCILIATION_DECISION
} from '../documents/countReconciliationService.js';
import {
  adjustAllPendingReconciliationLines
} from '../documents/countReconciliationBulkService.js';
import {
  saintBridgeProtectedProductIds
} from '../catalog/saintBridge.js';

const app = document.getElementById('app');
let enhancing = false;

if (app) {
  document.addEventListener('click', handleBulkClick);

  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceBulkControls().catch(error =>
      console.error('V5-D bulk reconciliation UI:', error)
    ));
  });

  observer.observe(app, { childList: true, subtree: true });
  enhanceBulkControls().catch(() => {});
}

async function enhanceBulkControls() {
  if (!app || enhancing) return;

  const panel = document.getElementById('v5CountReconciliationPanel');
  if (!panel || !panel.querySelector('.v5-recon-back')) return;

  const finalize = panel.querySelector(
    '[data-v5-recon-action="finalize"][data-reconciliation-id]'
  );
  const reconciliationId = finalize?.dataset.reconciliationId;
  if (!reconciliationId) return;

  enhancing = true;
  try {
    const session = await safeSession();
    if (String(session?.roleCode || '').toUpperCase() !== 'GOD') return;

    const reconciliation = await get(STORES.DOCUMENTS, reconciliationId);
    if (!reconciliation || reconciliation.status !== 'DRAFT') return;

    const sourceCountId = reconciliation.metadata?.sourceCountDocumentId || null;
    const sourceCount = sourceCountId
      ? await get(STORES.DOCUMENTS, sourceCountId)
      : null;
    const bridgePlans = array(
      reconciliation.metadata?.saintBridgePlans?.length
        ? reconciliation.metadata.saintBridgePlans
        : sourceCount?.metadata?.saintBridgePlans
    );
    const pendingBridgePlans = bridgePlans.filter(plan =>
      plan && plan.status !== 'APPLIED'
    );
    const protectedIds = saintBridgeProtectedProductIds(pendingBridgePlans);

    const lines = await getAllByIndex(
      STORES.DOCUMENT_LINES,
      'documentId',
      reconciliationId
    );
    const pending = lines.filter(line =>
      !line.decision || line.decision === RECONCILIATION_DECISION.PENDING
    );
    const normalPending = pending.filter(line =>
      !protectedIds.has(line.productId)
    );

    const existing = panel.querySelector('.v5-recon-bulk');
    if (!pending.length && !pendingBridgePlans.length) {
      existing?.remove();
      return;
    }

    const netDelta = round(normalPending.reduce(
      (sum, line) => sum + Number(line.difference || 0),
      0
    ));
    const absoluteDelta = round(normalPending.reduce(
      (sum, line) => sum + Math.abs(Number(line.difference || 0)),
      0
    ));
    const shortages = normalPending.filter(line =>
      Number(line.difference || 0) < 0
    ).length;
    const surpluses = normalPending.filter(line =>
      Number(line.difference || 0) > 0
    ).length;
    const stateKey = [
      reconciliationId,
      pendingBridgePlans.length,
      normalPending.length,
      shortages,
      surpluses,
      netDelta,
      absoluteDelta
    ].join(':');

    if (existing?.dataset.stateKey === stateKey) return;

    const node = document.createElement('section');
    node.className = 'v5-recon-bulk';
    node.dataset.reconciliationId = reconciliationId;
    node.dataset.stateKey = stateKey;
    node.innerHTML = `
      <div class="v5-recon-bulk-head">
        <div>
          <div class="product-meta v5-recon-eyebrow">GOD 👑 · DECISIÓN MASIVA TRAZABLE</div>
          <h3>Ajustar todas las diferencias confirmadas</h3>
          <p>
            Si este primer conteo representa la realidad física, puedes convertir todas las
            diferencias normales pendientes en ajustes con una sola confirmación. Cada producto
            conservará su propio movimiento y auditoría.
          </p>
        </div>
        <span class="badge ${normalPending.length ? 'status-warning' : 'status-good'}">
          ${normalPending.length} normal(es) pendiente(s)
        </span>
      </div>

      <div class="v5-recon-bulk-stats">
        <div><small>A ajustar</small><strong>${normalPending.length}</strong></div>
        <div><small>Faltantes</small><strong>${shortages}</strong></div>
        <div><small>Sobrantes</small><strong>${surpluses}</strong></div>
        <div><small>Neto</small><strong>${signed(netDelta)}</strong></div>
        <div><small>Variación absoluta</small><strong>${formatNumber(absoluteDelta)}</strong></div>
      </div>

      ${pendingBridgePlans.length ? `
        <div class="v5-recon-bulk-blocked">
          <strong>Puente SAINT protegido.</strong>
          Primero aplica ${pendingBridgePlans.length} reclasificación(es) SAINT desde el panel de arriba.
          Después este botón se habilitará automáticamente y ajustará de golpe únicamente las diferencias normales restantes.
        </div>
      ` : ''}

      <label class="v5-recon-bulk-reason">
        Motivo general
        <input
          data-v5-recon-bulk-reason
          value="Primer conteo físico confirmado"
          autocomplete="off"
        >
      </label>

      <div class="v5-recon-bulk-actions">
        <button
          class="danger"
          data-v5-recon-bulk-action="adjust-all"
          data-reconciliation-id="${escapeHtml(reconciliationId)}"
          data-pending-count="${normalPending.length}"
          data-net-delta="${netDelta}"
          type="button"
          ${pendingBridgePlans.length || !normalPending.length ? 'disabled' : ''}
        >👑 Ajustar TODAS · ${normalPending.length}</button>
        <span>
          No cierra la conciliación automáticamente: primero podrás revisar el resultado.
        </span>
      </div>
    `;

    if (existing) {
      existing.replaceWith(node);
      return;
    }

    const linesHost = panel.querySelector('.v5-recon-lines');
    if (linesHost) linesHost.before(node);
    else panel.appendChild(node);
  } finally {
    enhancing = false;
  }
}

async function handleBulkClick(event) {
  const button = event.target.closest('[data-v5-recon-bulk-action="adjust-all"]');
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const session = await safeSession();
  if (String(session?.roleCode || '').toUpperCase() !== 'GOD') {
    toast('Solo el rol DIOS puede aplicar ajustes masivos', 'danger');
    return;
  }

  const count = Number(button.dataset.pendingCount || 0);
  const netDelta = Number(button.dataset.netDelta || 0);
  const card = button.closest('.v5-recon-bulk');
  const reason = String(
    card?.querySelector('[data-v5-recon-bulk-reason]')?.value || ''
  ).trim() || 'Primer conteo físico confirmado · ajuste masivo';

  if (!count) {
    toast('No quedan diferencias normales pendientes', 'warning');
    return;
  }

  const confirmed = confirm(
    `VIGÍA ajustará ${count} diferencia(s) de una sola vez.\n\n` +
    `Variación neta: ${signed(netDelta)}\n\n` +
    'Cada producto generará un ADJUSTMENT trazable. Si una sola línea no es segura, ' +
    'el lote completo se bloqueará antes de escribir movimientos.\n\n' +
    '¿Confirmas que el conteo físico es la realidad que debe quedar registrada?'
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = '👑 Validando y ajustando…';

  try {
    const result = await adjustAllPendingReconciliationLines(
      button.dataset.reconciliationId,
      {
        userId: session.userId,
        roleCode: session.roleCode,
        reason
      }
    );

    toast(
      `${result.adjustedCount} diferencia(s) ajustadas · lote ${result.bulkAdjustmentId}.`,
      'success'
    );

    // El módulo base conserva activeCountId. Al retirar el panel su observer
    // lo reconstruye con el resumen real, ya sin botones pendientes.
    document.getElementById('v5CountReconciliationPanel')?.remove();
  } catch (error) {
    button.disabled = false;
    button.textContent = `👑 Ajustar TODAS · ${count}`;
    toast(error.message || String(error), 'danger');
  }
}

async function safeSession() {
  try {
    return await getCurrentSession();
  } catch (_) {
    return null;
  }
}

function toast(message, tone = '') {
  const node = document.createElement('div');
  node.className = `v5-toast ${tone ? `v5-toast-${tone}` : ''}`;
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4200);

  const status = document.getElementById('saveStatus');
  if (status) status.textContent = String(message || 'Listo');
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function signed(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return `${number > 0 ? '+' : ''}${formatNumber(number)}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 3
  }).format(number);
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
