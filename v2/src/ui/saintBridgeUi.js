import { getCurrentSession } from '../admin/adminClient.js';
import {
  STORES,
  getAll,
  getAllByIndex
} from '../storage/database.js';
import {
  buildSaintBridgeGroups
} from '../catalog/saintBridge.js';
import {
  submitCountWithSaintBridge,
  ensureSaintBridgeReconciliationDraft,
  getSaintBridgePlansForReconciliation,
  applySaintBridgeReclassification,
  finalizeBridgeOnlyReconciliation
} from '../documents/saintBridgeReclassificationService.js';

const app = document.getElementById('app');
let enhancing = false;

if (app) {
  // Debe cargarse ANTES de countReconciliationUi.js. Captura el cierre y
  // conserva el borrador actual; ningún conteo se borra ni se recrea.
  document.addEventListener('click', interceptBridgeActions, true);

  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceBridgeUi().catch(error =>
      console.error('V5 SAINT bridge UI:', error)
    ));
  });

  observer.observe(app, { childList: true, subtree: true });
  enhanceBridgeUi().catch(() => {});
}

async function interceptBridgeActions(event) {
  const countClose = event.target.closest(
    '.v5-count-shell [data-action="close-document"]'
  );

  if (countClose) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return closeCountSafely(countClose);
  }

  const actionButton = event.target.closest('[data-v5-recon-action]');
  if (!actionButton) return;

  const action = actionButton.dataset.v5ReconAction;

  if (action === 'open') {
    if (actionButton.dataset.bridgePrepared === '1') {
      delete actionButton.dataset.bridgePrepared;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    actionButton.disabled = true;

    try {
      const session = await safeSession();
      await ensureSaintBridgeReconciliationDraft(
        actionButton.dataset.countId,
        {
          userId: session?.userId || null,
          roleCode: session?.roleCode || null
        }
      );
      actionButton.dataset.bridgePrepared = '1';
      actionButton.disabled = false;
      actionButton.click();
    } catch (error) {
      actionButton.disabled = false;
      toast(error.message || String(error), 'danger');
    }
    return;
  }

  if (action === 'finalize') {
    if (actionButton.dataset.bridgeFinalizeReady === '1') {
      delete actionButton.dataset.bridgeFinalizeReady;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      const reconciliationId = actionButton.dataset.reconciliationId;
      const plans = await getSaintBridgePlansForReconciliation(reconciliationId);
      const pending = plans.filter(plan => plan.status !== 'APPLIED');
      if (pending.length) {
        throw new Error(
          `Primero aplica ${pending.length} reclasificación(es) de puente SAINT.`
        );
      }

      const session = await safeSession();
      const bridgeOnly = await finalizeBridgeOnlyReconciliation(
        reconciliationId,
        {
          userId: session?.userId || null,
          roleCode: session?.roleCode || null
        }
      );

      if (bridgeOnly) {
        toast(
          `Conciliación cerrada · ${bridgeOnly.summary.bridgeGroupsApplied} grupo(s) SAINT reclasificado(s).`,
          'success'
        );
        return navigateToReports();
      }

      actionButton.dataset.bridgeFinalizeReady = '1';
      actionButton.click();
    } catch (error) {
      toast(error.message || String(error), 'danger');
    }
    return;
  }

  const bridgeButton = event.target.closest('[data-v5-bridge-action="apply"]');
  if (!bridgeButton) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (!confirm(
    'VIGÍA reclasificará el stock genérico SAINT hacia los sabores contados. ' +
    'Es una operación atómica, trazable y solo de conciliación. ¿Continuar?'
  )) return;

  bridgeButton.disabled = true;
  bridgeButton.textContent = 'Reclasificando…';

  try {
    const session = await safeSession();
    const result = await applySaintBridgeReclassification(
      bridgeButton.dataset.reconciliationId,
      bridgeButton.dataset.sourceProductId,
      {
        userId: session?.userId || null,
        roleCode: session?.roleCode || null,
        reason: 'Separación inicial de REFRESCO BOT 350ML por sabor'
      }
    );

    toast(
      `Puente SAINT aplicado · ${result.movements.length} movimiento(s) trazable(s).`,
      'success'
    );
    markBridgeResolvedInDom(result.plan);
    await enhanceBridgeUi(true);
  } catch (error) {
    bridgeButton.disabled = false;
    bridgeButton.textContent = '👑 Aplicar reclasificación atómica';
    toast(error.message || String(error), 'danger');
  }
}

async function closeCountSafely(button) {
  const documentId = app.dataset.v5CountDocumentId;
  if (!documentId) {
    toast('No se pudo identificar el conteo activo', 'danger');
    return;
  }

  button.disabled = true;
  button.textContent = 'Protegiendo conteo…';

  try {
    const session = await safeSession();
    const result = await submitCountWithSaintBridge(documentId, {
      userId: session?.userId || null
    });

    delete app.dataset.v5CountDocumentId;

    const bridgeCount = result.bridgePlans?.length || 0;
    if (bridgeCount) {
      toast(
        `Conteo guardado íntegro. ${bridgeCount} grupo(s) SAINT esperan reclasificación DIOS 👑; el stock todavía no cambió.`,
        'warning'
      );
    } else if (result.differenceLines > 0) {
      toast(
        `${result.differenceLines} diferencia(s) guardadas. El stock NO cambió; esperan revisión DIOS 👑.`,
        'warning'
      );
    } else {
      toast('Conteo cerrado sin diferencias. No fue necesario ajustar stock.', 'success');
    }

    navigateToReports();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Cerrar conteo';
    toast(error.message || String(error), 'danger');
  }
}

async function enhanceBridgeUi(force = false) {
  if (!app || enhancing) return;
  enhancing = true;

  try {
    await enhanceCountNotice(force);
    await enhanceReconciliationPanel(force);
  } finally {
    enhancing = false;
  }
}

async function enhanceCountNotice(force) {
  const shell = app.querySelector('.v5-count-shell');
  const documentId = app.dataset.v5CountDocumentId;
  if (!shell || !documentId) return;

  if (force) shell.querySelector('.v5-bridge-count-notice')?.remove();
  if (shell.querySelector('.v5-bridge-count-notice')) return;

  const [products, lines] = await Promise.all([
    getAll(STORES.PRODUCTS),
    getAllByIndex(STORES.DOCUMENT_LINES, 'documentId', documentId)
  ]);
  const groups = buildSaintBridgeGroups(products);
  if (!groups.length) return;

  const lineByProduct = new Map(lines.map(line => [line.productId, line]));
  const cards = groups.map(group => {
    const control = lineByProduct.get(group.sourceProductId) || null;
    const countedVariants = group.variants
      .map(product => ({
        product,
        line: lineByProduct.get(product.id) || null
      }))
      .filter(item => item.line);
    const total = countedVariants.reduce(
      (sum, item) => sum + Number(item.line.countedStock || 0),
      0
    );

    return `
      <div class="v5-bridge-count-row">
        <div>
          <strong>${escapeHtml(group.name)}</strong>
          <small>
            SAINT ${escapeHtml(group.saintCode)} ·
            ${countedVariants.length}/${group.variants.length} sabores contados
          </small>
        </div>
        <div class="v5-bridge-count-values">
          <span>Sabores <strong>${format(total)}</strong></span>
          ${control
            ? `<span>Control anterior preservado <strong>${format(control.countedStock)}</strong></span>`
            : '<span>Sin línea genérica previa</span>'}
        </div>
      </div>
    `;
  }).join('');

  const notice = document.createElement('article');
  notice.className = 'card v5-bridge-count-notice';
  notice.innerHTML = `
    <div class="v5-bridge-count-head">
      <div>
        <div class="product-meta">PUENTE SAINT · CONTEO POR REALIDAD FÍSICA</div>
        <h3>Los sabores sustituyen al genérico en el conteo</h3>
        <p>
          La línea vieja de REFRESCO BOT 350ML no se borró: queda como control histórico oculto.
          Cuenta cada sabor. Al conciliar, VIGÍA moverá el stock de forma atómica y trazable.
        </p>
      </div>
      <span class="badge status-good">PROGRESO PRESERVADO</span>
    </div>
    <div class="v5-bridge-count-list">${cards}</div>
  `;
  shell.prepend(notice);
}

async function enhanceReconciliationPanel(force) {
  const panel = document.getElementById('v5CountReconciliationPanel');
  if (!panel || !panel.querySelector('.v5-recon-back')) return;

  if (force) panel.querySelector('.v5-saint-bridge-reconciliation')?.remove();
  if (panel.querySelector('.v5-saint-bridge-reconciliation')) return;

  const finalize = panel.querySelector(
    '[data-v5-recon-action="finalize"][data-reconciliation-id]'
  );
  const reconciliationId = finalize?.dataset.reconciliationId;
  if (!reconciliationId) return;

  const plans = await getSaintBridgePlansForReconciliation(reconciliationId);
  if (!plans.length) return;

  const section = document.createElement('section');
  section.className = 'v5-saint-bridge-reconciliation';
  section.innerHTML = `
    <div class="v5-bridge-recon-head">
      <div>
        <div class="product-meta">PUENTE SAINT · RECLASIFICACIÓN CONTROLADA</div>
        <h3>Separar stock genérico en sabores</h3>
        <p>Una sola transacción: el genérico va a 0 y cada sabor queda en su físico contado. Si algo no cuadra, no se aplica nada.</p>
      </div>
    </div>
    <div class="v5-bridge-recon-list">
      ${plans.map(plan => renderBridgePlan(plan, reconciliationId)).join('')}
    </div>
  `;

  const guide = panel.querySelector('.v5-recon-guide');
  if (guide?.nextSibling) panel.insertBefore(section, guide.nextSibling);
  else panel.prepend(section);

  const pending = plans.filter(plan => plan.status !== 'APPLIED').length;
  if (pending && finalize) {
    finalize.disabled = true;
    finalize.title = `Faltan ${pending} reclasificación(es) SAINT`;
  }

  for (const plan of plans.filter(item => item.status === 'APPLIED')) {
    markBridgeResolvedInDom(plan);
  }
}

function renderBridgePlan(plan, reconciliationId) {
  const applied = plan.status === 'APPLIED';
  const composition = (plan.variants || [])
    .map(item => `
      <div class="v5-bridge-flavor-row">
        <span>${escapeHtml(item.productName)}</span>
        <strong>${item.countedStock === null ? 'PENDIENTE' : format(item.countedStock)}</strong>
      </div>
    `).join('');

  return `
    <article class="v5-bridge-card ${applied ? 'resolved' : ''}" data-bridge-source="${escapeHtml(plan.sourceProductId)}">
      <div class="v5-bridge-card-head">
        <div>
          <strong>${escapeHtml(plan.bridgeName)}</strong>
          <small>Destino SAINT ${escapeHtml(plan.saintCode)}</small>
        </div>
        <span class="badge ${applied ? 'status-good' : 'status-warning'}">
          ${applied ? 'RECLASIFICADO' : 'PENDIENTE'}
        </span>
      </div>

      <div class="v5-bridge-kpis">
        <div><small>Stock genérico al cerrar</small><strong>${format(plan.sourceStockAtSubmit)}</strong></div>
        <div><small>Suma sabores</small><strong>${format(plan.variantCountedTotal)}</strong></div>
        <div><small>Control anterior</small><strong>${plan.controlCountedStock === null ? '—' : format(plan.controlCountedStock)}</strong></div>
        <div><small>Diferencia vs control</small><strong>${plan.controlDifference === null ? '—' : signed(plan.controlDifference)}</strong></div>
      </div>

      <details>
        <summary>Ver composición · ${plan.countedVariantCount}/${plan.variantCount} sabores</summary>
        <div class="v5-bridge-flavor-list">${composition}</div>
      </details>

      ${applied
        ? `<div class="status-good">✓ Reclasificación aplicada ${plan.appliedAt ? formatDate(plan.appliedAt) : ''}. Movimientos: ${(plan.movementIds || []).length}.</div>`
        : `<button
            class="danger"
            data-v5-bridge-action="apply"
            data-reconciliation-id="${escapeHtml(reconciliationId)}"
            data-source-product-id="${escapeHtml(plan.sourceProductId)}"
            type="button"
          >👑 Aplicar reclasificación atómica</button>`}
    </article>
  `;
}

function markBridgeResolvedInDom(plan) {
  const ids = new Set([
    plan.sourceProductId,
    ...(plan.variants || []).map(item => item.productId)
  ]);

  app.querySelectorAll('.v5-recon-line[data-recon-product]').forEach(card => {
    if (!ids.has(card.dataset.reconProduct)) return;
    card.classList.add('resolved');
    card.innerHTML = `
      <div class="v5-recon-line-head">
        <div>
          <strong>${escapeHtml(
            card.dataset.reconProduct === plan.sourceProductId
              ? plan.sourceProductName
              : plan.variants.find(item => item.productId === card.dataset.reconProduct)?.productName || card.dataset.reconProduct
          )}</strong>
          <small>Resuelto dentro del puente SAINT ${escapeHtml(plan.saintCode)}</small>
        </div>
        <span class="badge status-good">RECLASIFICADO</span>
      </div>
    `;
  });

  const card = app.querySelector(
    `.v5-bridge-card[data-bridge-source="${cssEscape(plan.sourceProductId)}"]`
  );
  if (card) {
    card.outerHTML = renderBridgePlan(
      { ...plan, status: 'APPLIED' },
      app.querySelector('[data-v5-recon-action="finalize"]')?.dataset.reconciliationId || ''
    );
  }

  const unresolvedNormal = app.querySelector(
    '.v5-recon-line [data-v5-recon-action="adjust"], ' +
    '.v5-recon-line [data-v5-recon-action="ignore"], ' +
    '.v5-recon-line [data-v5-recon-action="recount"]'
  );
  const pendingBridge = app.querySelector('[data-v5-bridge-action="apply"]');
  const finalize = app.querySelector('[data-v5-recon-action="finalize"]');
  if (finalize && !unresolvedNormal && !pendingBridge) {
    finalize.disabled = false;
    finalize.title = '';
  }
}

async function safeSession() {
  try {
    return await getCurrentSession();
  } catch (_) {
    return null;
  }
}

function navigateToReports() {
  const button = document.querySelector('.app-nav [data-view="reports"]');
  if (button) return button.click();
  toast('Conteo guardado. Abre Reportes para revisar la conciliación.', 'success');
}

function toast(message, tone = '') {
  const node = document.createElement('div');
  node.className = `v5-toast ${tone ? `v5-toast-${tone}` : ''}`;
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);

  const status = document.getElementById('saveStatus');
  if (status) status.textContent = String(message || 'Listo');
}

function signed(value) {
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${format(number)}`;
}

function format(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 3
  }).format(number);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
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
