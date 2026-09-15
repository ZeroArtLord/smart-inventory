import { getCurrentSession } from '../admin/adminClient.js';
import {
  submitCountForReconciliation,
  listCountReconciliationCases,
  ensureCountReconciliationDraft,
  getCountReconciliationDetails,
  adjustReconciliationLine,
  ignoreReconciliationLine,
  recountReconciliationLine,
  finalizeCountReconciliation,
  RECONCILIATION_DECISION,
  RECONCILIATION_STATE
} from '../documents/countReconciliationService.js';

const app = document.getElementById('app');
const uiState = {
  activeCountId: null,
  rendering: false
};

if (app) {
  // Captura antes del handler legacy de app.js. Así V5-D evita que
  // closeDocument() genere ADJUSTMENT automáticamente al cerrar un conteo.
  document.addEventListener('click', interceptCountClose, true);
  document.addEventListener('click', handleReconciliationClick);

  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceReports().catch(error =>
      console.error('V5-D reconciliation UI:', error)
    ));
  });
  observer.observe(app, { childList: true, subtree: true });
  enhanceReports().catch(() => {});
}

async function interceptCountClose(event) {
  const button = event.target.closest(
    '.v5-count-shell [data-action="close-document"]'
  );
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const documentId = app.dataset.v5CountDocumentId;
  if (!documentId) {
    toast('No se pudo identificar el conteo activo', 'danger');
    return;
  }

  button.disabled = true;
  button.textContent = 'Enviando a conciliación…';

  try {
    const session = await safeSession();
    const result = await submitCountForReconciliation(documentId, {
      userId: session?.userId || null
    });

    delete app.dataset.v5CountDocumentId;

    if (result.differenceLines > 0) {
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

async function enhanceReports() {
  if (uiState.rendering || !isReportsView()) return;
  if (document.getElementById('v5CountReconciliationPanel')) return;

  uiState.rendering = true;
  try {
    const session = await safeSession();
    const isGod = String(session?.roleCode || '').toUpperCase() === 'GOD';
    const [pending, allCases] = await Promise.all([
      listCountReconciliationCases(),
      listCountReconciliationCases({ includeResolved: true })
    ]);

    const panel = document.createElement('section');
    panel.id = 'v5CountReconciliationPanel';
    panel.className = 'card v5-reconciliation-panel';

    if (uiState.activeCountId && isGod) {
      panel.innerHTML = await renderActiveReconciliation(
        uiState.activeCountId,
        session
      );
    } else {
      panel.innerHTML = renderReconciliationOverview({
        pending,
        allCases,
        isGod
      });
    }

    const inventory = app.querySelector('.report-inventory-card');
    if (inventory) {
      inventory.before(panel);
    } else {
      app.appendChild(panel);
    }
  } finally {
    uiState.rendering = false;
  }
}

function isReportsView() {
  const heading = app?.querySelector('.hero h2');
  return Boolean(
    heading && String(heading.textContent || '').trim().toLowerCase() === 'reportes'
  );
}

function renderReconciliationOverview({ pending, allCases, isGod }) {
  const resolved = allCases
    .filter(item => [
      RECONCILIATION_STATE.RESOLVED,
      RECONCILIATION_STATE.NOT_REQUIRED
    ].includes(item.document.metadata?.reconciliationState))
    .slice(0, 8);

  return `
    <div class="v5-recon-head">
      <div>
        <div class="product-meta v5-recon-eyebrow">V5 · CONCILIACIÓN DE CONTEO</div>
        <h3>Faltantes, sobrantes y ajustes</h3>
        <p>
          Contar no modifica stock. Cada diferencia queda pendiente hasta una decisión explícita.
        </p>
      </div>
      <div class="v5-recon-head-badges">
        <span class="badge ${pending.length ? 'status-warning' : 'status-good'}">
          ${pending.length} pendiente(s)
        </span>
        <span class="badge ${isGod ? 'god-badge' : ''}">
          ${isGod ? 'DIOS 👑' : 'Solo consulta'}
        </span>
      </div>
    </div>

    ${pending.length ? `
      <div class="v5-recon-case-list">
        ${pending.map(item => renderCaseCard(item, isGod)).join('')}
      </div>
    ` : `
      <div class="v5-recon-empty">
        <strong>✓ No hay conciliaciones pendientes</strong>
        <span>Los próximos conteos con diferencias aparecerán aquí.</span>
      </div>
    `}

    ${!isGod && pending.length ? `
      <div class="v5-recon-security-note">
        <strong>Stock protegido.</strong>
        Puedes revisar las diferencias, pero solamente el rol DIOS puede recontar, ignorar o aplicar ajustes.
      </div>
    ` : ''}

    ${resolved.length ? `
      <details class="v5-recon-history">
        <summary>Historial reciente · ${resolved.length}</summary>
        <div class="v5-recon-history-list">
          ${resolved.map(item => {
            const state = item.document.metadata?.reconciliationState;
            const summary = item.document.metadata?.reconciliationSummary || {};
            return `
              <div class="v5-recon-history-row">
                <div>
                  <strong>${escapeHtml(item.document.id)}</strong>
                  <small>${formatDate(item.document.closedAt || item.document.updatedAt)}</small>
                </div>
                <span class="badge status-good">
                  ${state === RECONCILIATION_STATE.NOT_REQUIRED
                    ? 'Sin diferencias'
                    : `Resuelto · ${Number(summary.adjusted || 0)} ajuste(s)`}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </details>
    ` : ''}
  `;
}

function renderCaseCard(item, isGod) {
  const document = item.document;
  const state = document.metadata?.reconciliationState || 'PENDING';
  return `
    <article class="v5-recon-case">
      <div class="v5-recon-case-main">
        <div>
          <strong>${escapeHtml(document.id)}</strong>
          <small>
            ${formatDate(document.closedAt || document.updatedAt)} ·
            ${item.lineCount} productos contados
          </small>
        </div>
        <span class="badge ${state === 'REVIEWING' ? 'status-warning' : ''}">
          ${state === 'REVIEWING' ? 'EN REVISIÓN' : 'PENDIENTE'}
        </span>
      </div>

      <div class="v5-recon-case-stats">
        <div><small>Diferencias</small><strong>${item.differenceCount}</strong></div>
        <div><small>Faltantes</small><strong class="status-danger">${item.shortageCount}</strong></div>
        <div><small>Sobrantes</small><strong class="status-good">${item.surplusCount}</strong></div>
      </div>

      ${isGod ? `
        <button
          class="primary"
          data-v5-recon-action="open"
          data-count-id="${escapeHtml(document.id)}"
          type="button"
        >👑 Revisar conciliación</button>
      ` : ''}
    </article>
  `;
}

async function renderActiveReconciliation(countId, session) {
  const opened = await ensureCountReconciliationDraft(countId, {
    userId: session?.userId || null,
    roleCode: session?.roleCode || null
  });
  const details = await getCountReconciliationDetails(countId);
  const reconciliation = details.reconciliation || opened.reconciliation;
  const lines = details.lines;
  const summary = details.summary;

  return `
    <div class="v5-recon-head">
      <div>
        <button class="ghost-button v5-recon-back" data-v5-recon-action="back" type="button">← Volver</button>
        <div class="product-meta v5-recon-eyebrow">CONCILIACIÓN GOD 👑</div>
        <h3>${escapeHtml(countId)}</h3>
        <p>
          Ninguna diferencia cambia stock hasta pulsar <strong>AJUSTAR</strong> en esa línea.
        </p>
      </div>
      <div class="v5-recon-head-badges">
        <span class="badge status-warning">${summary.pending} pendiente(s)</span>
        <span class="badge">${summary.adjusted} ajustado(s)</span>
        <span class="badge">${summary.ignored} ignorado(s)</span>
        <span class="badge status-good">${summary.matched} cuadrado(s)</span>
      </div>
    </div>

    <div class="v5-recon-guide">
      <div><strong>RECONTAR</strong><span>Toma un nuevo físico y compara contra el stock VIGÍA actual.</span></div>
      <div><strong>IGNORAR</strong><span>Conserva el stock y registra que revisaste la diferencia.</span></div>
      <div><strong>AJUSTAR</strong><span>Crea un ADJUSTMENT trazable. Es la única acción que cambia stock.</span></div>
    </div>

    <div class="v5-recon-lines">
      ${lines.map(line => renderReconciliationLine(line)).join('')}
    </div>

    <div class="v5-recon-finalize">
      <div>
        <strong>Resumen de la conciliación</strong>
        <span>
          ${summary.total} diferencia(s) · ${summary.shortages} faltante(s) ·
          ${summary.surpluses} sobrante(s)
        </span>
      </div>
      <button
        class="success"
        data-v5-recon-action="finalize"
        data-reconciliation-id="${escapeHtml(reconciliation.id)}"
        type="button"
        ${summary.pending ? 'disabled' : ''}
      >Cerrar conciliación</button>
    </div>
  `;
}

function renderReconciliationLine(line) {
  const difference = Number(line.difference || 0);
  const decision = line.decision || RECONCILIATION_DECISION.PENDING;
  const resolved = decision !== RECONCILIATION_DECISION.PENDING;
  const statusClass = decision === RECONCILIATION_DECISION.ADJUSTED
    ? 'status-warning'
    : decision === RECONCILIATION_DECISION.IGNORED
      ? ''
      : decision === RECONCILIATION_DECISION.MATCHED
        ? 'status-good'
        : difference < 0
          ? 'status-danger'
          : 'status-good';

  return `
    <article class="v5-recon-line ${resolved ? 'resolved' : ''}" data-recon-product="${escapeHtml(line.productId)}">
      <div class="v5-recon-line-head">
        <div>
          <strong>${escapeHtml(line.productName || line.productId)}</strong>
          <small>
            Esperado ${formatNumber(line.expectedStock)} ·
            Físico ${formatNumber(line.countedStock)}
          </small>
        </div>
        <span class="badge ${statusClass}">
          ${resolved ? decisionLabel(decision) : signed(difference)}
        </span>
      </div>

      ${resolved ? `
        <div class="v5-recon-resolution">
          <strong>${decisionLabel(decision)}</strong>
          <span>${escapeHtml(line.decisionReason || 'Sin nota')}</span>
          ${line.movementId ? `<small>Movimiento ${escapeHtml(line.movementId)}</small>` : ''}
        </div>
      ` : `
        <div class="v5-recon-inputs">
          <label>
            Nuevo conteo
            <input
              data-v5-recount-value
              inputmode="decimal"
              autocomplete="off"
              placeholder="Cantidad física"
            >
          </label>
          <label>
            Motivo / nota
            <input
              data-v5-recon-reason
              autocomplete="off"
              placeholder="Ej. faltante confirmado"
            >
          </label>
        </div>

        <div class="v5-recon-line-actions">
          <button
            class="secondary"
            data-v5-recon-action="recount"
            data-reconciliation-id="${escapeHtml(line.documentId)}"
            data-product-id="${escapeHtml(line.productId)}"
            type="button"
          >↺ Recontar</button>
          <button
            class="secondary"
            data-v5-recon-action="ignore"
            data-reconciliation-id="${escapeHtml(line.documentId)}"
            data-product-id="${escapeHtml(line.productId)}"
            type="button"
          >Ignorar</button>
          <button
            class="danger"
            data-v5-recon-action="adjust"
            data-reconciliation-id="${escapeHtml(line.documentId)}"
            data-product-id="${escapeHtml(line.productId)}"
            type="button"
          >👑 Ajustar ${signed(difference)}</button>
        </div>
      `}
    </article>
  `;
}

async function handleReconciliationClick(event) {
  const button = event.target.closest('[data-v5-recon-action]');
  if (!button) return;
  event.preventDefault();

  try {
    const session = await safeSession();
    const action = button.dataset.v5ReconAction;

    if (action === 'open') {
      assertGodSession(session);
      uiState.activeCountId = button.dataset.countId;
      return rerenderPanel();
    }

    if (action === 'back') {
      uiState.activeCountId = null;
      return rerenderPanel();
    }

    if (action === 'finalize') {
      assertGodSession(session);
      const result = await finalizeCountReconciliation(
        button.dataset.reconciliationId,
        {
          userId: session.userId,
          roleCode: session.roleCode
        }
      );
      toast(
        `Conciliación cerrada: ${result.summary.adjusted} ajuste(s), ${result.summary.ignored} ignorado(s).`,
        'success'
      );
      uiState.activeCountId = null;
      return rerenderPanel();
    }

    const lineCard = button.closest('.v5-recon-line');
    const reason = String(
      lineCard?.querySelector('[data-v5-recon-reason]')?.value || ''
    ).trim();
    const reconciliationId = button.dataset.reconciliationId;
    const productId = button.dataset.productId;

    assertGodSession(session);

    if (action === 'recount') {
      const raw = lineCard?.querySelector('[data-v5-recount-value]')?.value;
      const countedStock = parseNumber(raw);
      await recountReconciliationLine(
        reconciliationId,
        productId,
        {
          countedStock,
          userId: session.userId,
          roleCode: session.roleCode,
          reason: reason || 'Reconteo físico'
        }
      );
      toast('Reconteo guardado; diferencia recalculada.', 'success');
      return rerenderPanel();
    }

    if (action === 'ignore') {
      if (!confirm('¿Ignorar esta diferencia sin modificar stock?')) return;
      await ignoreReconciliationLine(
        reconciliationId,
        productId,
        {
          userId: session.userId,
          roleCode: session.roleCode,
          reason: reason || 'Diferencia revisada y no aplicada'
        }
      );
      toast('Diferencia ignorada. El stock no cambió.', 'warning');
      return rerenderPanel();
    }

    if (action === 'adjust') {
      if (!confirm(
        'Esta acción CREARÁ un ajuste de inventario trazable. ¿Confirmas que el físico es correcto?'
      )) return;
      const result = await adjustReconciliationLine(
        reconciliationId,
        productId,
        {
          userId: session.userId,
          roleCode: session.roleCode,
          reason: reason || 'Conciliación de conteo físico'
        }
      );
      toast(`Stock ajustado ${signed(result.movement.delta)}.`, 'warning');
      return rerenderPanel();
    }
  } catch (error) {
    toast(error.message || String(error), 'danger');
  }
}

async function rerenderPanel() {
  const existing = document.getElementById('v5CountReconciliationPanel');
  existing?.remove();
  await enhanceReports();
}

function navigateToReports() {
  const button = document.querySelector('.app-nav [data-view="reports"]');
  if (button) {
    button.click();
    return;
  }
  toast('Conteo guardado. Abre Reportes para revisar conciliación.', 'success');
}

async function safeSession() {
  try {
    return await getCurrentSession();
  } catch (_) {
    return null;
  }
}

function assertGodSession(session) {
  if (String(session?.roleCode || '').toUpperCase() !== 'GOD') {
    throw new Error('Solo el rol DIOS puede conciliar existencias');
  }
}

function parseNumber(raw) {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) throw new Error('Escribe la nueva existencia física');
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error('La existencia recontada debe ser un número mayor o igual a cero');
  }
  return number;
}

function decisionLabel(decision) {
  switch (decision) {
    case RECONCILIATION_DECISION.ADJUSTED:
      return 'AJUSTADO';
    case RECONCILIATION_DECISION.IGNORED:
      return 'IGNORADO';
    case RECONCILIATION_DECISION.MATCHED:
      return 'CUADRÓ AL RECONTAR';
    default:
      return 'PENDIENTE';
  }
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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function toast(message, tone = '') {
  const node = document.createElement('div');
  node.className = `v5-toast ${tone ? `v5-toast-${tone}` : ''}`;
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3300);

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
