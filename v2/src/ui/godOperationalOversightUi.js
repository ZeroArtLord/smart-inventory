import { getCurrentSession, listWorkspaceMembers } from '../admin/adminClient.js';
import { getAll, STORES } from '../storage/database.js';
import {
  DOCUMENT_STATUS,
  DOCUMENT_TYPES
} from '../documents/documentTypes.js';
import {
  canActorAccessOperationalDocument,
  filterOperationalDocumentsForActor
} from '../documents/documentAccessPolicy.js';
import { buildSupplyHistoryGroups } from '../documents/supplyHistoryGrouping.js';
import {
  buildOperationalDomRenderKey,
  shouldRefreshOperationalDom
} from './operationalDomRenderGuard.js';

const appRoot = document.getElementById('app');
const TEAM_TYPES = new Set([DOCUMENT_TYPES.ENTRY, DOCUMENT_TYPES.SUPPLY]);
const LIVE_SUPPLY_DELIVERY_KIND = 'LIVE_SUPPLY_DELIVERY';
const documentsById = new Map();
let currentActor = null;
let enhancing = false;
let rerunRequested = false;
let memberCache = [];
let memberCacheAt = 0;

if (appRoot) {
  const observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(appRoot, { childList: true, subtree: true });

  // Segunda barrera del lado cliente: aunque alguien intente reinsertar un
  // control ajeno en el DOM, un WAREHOUSE no puede administrar un ENTRY/SUPPLY
  // que no le pertenece. GOD conserva el bypass deliberado.
  appRoot.addEventListener('click', event => {
    const summaryToggle = event.target.closest('[data-v871-summary-toggle]');
    if (summaryToggle) {
      event.preventDefault();
      toggleSupplyHistoryPanel(summaryToggle);
      return;
    }

    const deliveriesToggle = event.target.closest('[data-v871-deliveries-toggle]');
    if (deliveriesToggle) {
      event.preventDefault();
      toggleSupplyHistoryPanel(deliveriesToggle);
      return;
    }

    const supplyActionsTrigger = event.target.closest('[data-v871-supply-actions-trigger]');
    if (supplyActionsTrigger) {
      event.preventDefault();
      event.stopPropagation();
      openSupplyHistoryActionPortal(supplyActionsTrigger);
      return;
    }

    const godOpen = event.target.closest('[data-v82-open-document]');
    if (godOpen) {
      if (!currentActor) return;

      const document = documentsById.get(String(godOpen.dataset.id || ''));
      if (!document || !TEAM_TYPES.has(document.type)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!canCurrentActorAccessDocument(document)) {
        showToast('Ese documento pertenece a otro usuario.', 'danger');
        return;
      }

      forwardOpenToApp(document.id, document.type);
      return;
    }

    const action = event.target.closest(
      '[data-action="cancel-document"], ' +
      '[data-action="export-document"], ' +
      '[data-action="correct-document"]'
    );
    if (!action || !currentActor) return;

    const document = documentsById.get(String(action.dataset.id || ''));
    if (!document || !TEAM_TYPES.has(document.type)) return;

    if (!canCurrentActorAccessDocument(document)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast('Ese documento pertenece a otro usuario.', 'danger');
    }
  }, true);

  scheduleEnhance();
}

function scheduleEnhance() {
  if (enhancing) {
    rerunRequested = true;
    return;
  }

  queueMicrotask(() => enhanceOperationalWorkspace().catch(error => {
    console.warn('VIGÍA V8.7: no se pudo aplicar supervisión operativa.', error);
  }));
}

async function enhanceOperationalWorkspace() {
  if (!appRoot) return;
  if (enhancing) {
    rerunRequested = true;
    return;
  }

  const newButton = appRoot.querySelector('[data-action="new-document"][data-type]');
  const draftList = appRoot.querySelector('.draft-list-v2');
  if (!newButton || !draftList) return;

  const type = String(newButton.dataset.type || '').toUpperCase();
  const historyList = appRoot.querySelector('.document-history-list');

  // Conteo mantiene su flujo histórico. Solo quitamos el bloqueo visual de
  // privacidad que aplica el CSS hasta que este módulo clasifica la pantalla.
  if (!TEAM_TYPES.has(type)) {
    draftList.dataset.v82AccessReady = '1';
    if (historyList) historyList.dataset.v82AccessReady = '1';
    return;
  }

  enhancing = true;
  try {
    const session = await getCurrentSession();
    currentActor = actorFromSession(session);

    const allDocuments = await getAll(STORES.DOCUMENTS);
    documentsById.clear();
    allDocuments.forEach(document => documentsById.set(document.id, document));

    const operational = allDocuments.filter(document => document.type === type);
    const visible = filterOperationalDocumentsForActor(operational, currentActor);
    const drafts = visible
      .filter(document => document.status === DOCUMENT_STATUS.DRAFT)
      .sort(sortNewest);
    const historyDocuments = type === DOCUMENT_TYPES.SUPPLY
      ? visible.filter(document => document.status !== DOCUMENT_STATUS.CANCELLED)
      : visible.filter(document =>
          document.status !== DOCUMENT_STATUS.DRAFT &&
          document.status !== DOCUMENT_STATUS.CANCELLED
        );
    const movements = type === DOCUMENT_TYPES.SUPPLY
      ? await getAll(STORES.MOVEMENTS)
      : [];
    const history = type === DOCUMENT_TYPES.SUPPLY
      ? buildSupplyHistoryGroups({
          documents: historyDocuments,
          movements
        })
          .filter(group =>
            group.document?.status !== DOCUMENT_STATUS.DRAFT ||
            (
              group.kind === 'LIVE_CART' &&
              group.summary?.deliveryCount > 0
            )
          )
          .slice(0, 10)
      : historyDocuments
          .sort(sortNewest)
          .slice(0, 10);

    const members = currentActor.roleCode === 'GOD'
      ? await getGodMembers()
      : [];
    const memberIndex = buildMemberIndex(members);
    const renderKey = buildOperationalDomRenderKey({
      type,
      actor: currentActor,
      drafts,
      history,
      members
    });

    const refreshDom = shouldRefreshOperationalDom({
      nextKey: renderKey,
      draftKey: draftList.dataset.v83RenderKey,
      historyKey: historyList?.dataset.v83RenderKey,
      hasHistoryList: Boolean(historyList)
    });

    // V8.3.1: las mutaciones producidas por esta misma capa despiertan el
    // MutationObserver. Si el estado y las marcas siguen iguales, no volvemos
    // a reemplazar innerHTML; así los botones permanecen físicamente estables
    // entre pointerdown y click. Si app.js reemplaza la vista, las marcas
    // desaparecen y la decoración se ejecuta de nuevo normalmente.
    if (!refreshDom) {
      draftList.dataset.v82AccessReady = '1';
      if (historyList) historyList.dataset.v82AccessReady = '1';
      return;
    }

    closeSupplyHistoryActionPortal();
    renderDrafts(draftList, drafts, type, currentActor, memberIndex);
    renderHistory(historyList, history, type, currentActor, memberIndex);
    decorateHeadings(type, currentActor, drafts.length, history.length);

    draftList.dataset.v83RenderKey = renderKey;
    draftList.dataset.v82AccessReady = '1';
    if (historyList) {
      historyList.dataset.v83RenderKey = renderKey;
      historyList.dataset.v82AccessReady = '1';
    }
  } finally {
    enhancing = false;

    if (rerunRequested) {
      rerunRequested = false;
      scheduleEnhance();
    }
  }
}

function actorFromSession(session = {}) {
  const ownerId = String(
    String(session.authMode || '').toLowerCase() === 'firebase'
      ? session.externalAuthId || ''
      : session.userId || ''
  ).trim();

  return {
    ownerId,
    roleCode: String(session.roleCode || '').trim().toUpperCase()
  };
}

function canCurrentActorAccessDocument(document) {
  const parentDocument = document?.metadata?.kind === LIVE_SUPPLY_DELIVERY_KIND
    ? documentsById.get(String(document.metadata?.parentCartId || '').trim()) || null
    : null;

  return canActorAccessOperationalDocument(document, currentActor, {
    parentDocument
  });
}

async function getGodMembers() {
  const now = Date.now();
  if (memberCache.length && now - memberCacheAt < 60000) {
    return memberCache;
  }

  try {
    memberCache = await listWorkspaceMembers();
    memberCacheAt = now;
  } catch (error) {
    console.warn('VIGÍA V8.7: miembros no disponibles para etiquetas GOD.', error);
    memberCache = [];
    memberCacheAt = now;
  }

  return memberCache;
}

function buildMemberIndex(members) {
  const index = new Map();
  (Array.isArray(members) ? members : []).forEach(member => {
    const keys = [member.externalAuthId, member.userId]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    keys.forEach(key => index.set(key, member));
  });
  return index;
}

function renderDrafts(container, drafts, type, actor, memberIndex) {
  const icon = type === DOCUMENT_TYPES.ENTRY ? '↓' : '↑';

  container.innerHTML = drafts.length
    ? drafts.map(document => {
        const owner = ownerLabel(document, actor, memberIndex);
        const godForeign = actor.roleCode === 'GOD' &&
          String(document.ownerId || '') !== actor.ownerId;
        const label = operationalDocumentLabel(document);

        return `
          <div class="draft-row-v2 v82-operational-row ${godForeign ? 'v82-god-foreign' : ''}" data-v82-document-id="${escapeHtml(document.id)}">
            <div class="draft-icon-v2">${icon}</div>
            <div class="v82-document-copy">
              <strong title="ID técnico: ${escapeHtml(document.id)}">${escapeHtml(label)}</strong>
              <small>Borrador</small>
              <span class="v82-owner-line">${godForeign ? '👑 ' : ''}${escapeHtml(owner)}</span>
            </div>
            <div class="draft-actions-v2">
              <button
                class="secondary"
                data-v82-open-document="1"
                data-id="${escapeHtml(document.id)}"
                data-type="${escapeHtml(type)}"
                type="button"
              >${godForeign ? 'Supervisar / editar' : 'Continuar'}</button>
              <button
                class="danger"
                data-action="cancel-document"
                data-id="${escapeHtml(document.id)}"
                type="button"
                title="Cancelar borrador"
              >×</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="empty compact-empty">No hay borradores pendientes.</div>';
}

function renderHistory(container, history, type, actor, memberIndex) {
  if (!container) return;

  if (type === DOCUMENT_TYPES.SUPPLY) {
    renderSupplyHistory(container, history, actor, memberIndex);
    return;
  }

  container.innerHTML = history.length
    ? history.map(document =>
        renderFlatHistoryRow(document, type, actor, memberIndex)
      ).join('')
    : '<div class="empty compact-empty">No hay documentos cerrados visibles.</div>';
}

function renderSupplyHistory(container, groups, actor, memberIndex) {
  container.innerHTML = groups.length
    ? groups.map(group => {
        if (group.kind !== 'LIVE_CART') {
          return renderSupplyDeliveryRow(
            group.document,
            actor,
            memberIndex,
            {
              deliveredTotal: group.summary?.deliveredTotal,
              fallbackKind: group.kind
            }
          );
        }

        const parent = group.document;
        const owner = ownerLabel(parent, actor, memberIndex);
        const godForeign = actor.roleCode === 'GOD' &&
          String(parent.ownerId || '') !== actor.ownerId;
        const operationalDate = formatOperationalDay(group.operationalDate);
        const summary = group.summary || {};
        const safeParentId = domSafeId(parent.id);
        const summaryId = `v871-summary-${safeParentId}`;
        const deliveriesId = `v871-deliveries-${safeParentId}`;

        return `
          <article
            class="closed-document-row v82-operational-row v871-history-parent ${godForeign ? 'v82-god-foreign' : ''}"
            data-v871-supply-history-parent="1"
            data-v82-document-id="${escapeHtml(parent.id)}"
          >
            <div class="v871-history-parent-main">
              <div class="history-doc-title">
                <div class="history-doc-icon">↑</div>
                <div class="v82-document-copy">
                  <strong title="ID técnico: ${escapeHtml(parent.id)}">Surtido · ${escapeHtml(operationalDate)}</strong>
                  <span class="v82-owner-line">${godForeign ? '👑 ' : ''}${escapeHtml(owner)}</span>
                  <div class="v871-history-parent-meta">
                    <span class="v871-history-chip">${formatSummaryQuantity(summary.deliveredTotal)} uds</span>
                    <span class="v871-history-chip">${Number(summary.deliveryCount || 0)} entrega(s)</span>
                    <span class="v871-history-chip">${escapeHtml(humanStatus(summary.status))}</span>
                  </div>
                </div>
              </div>

              <div class="v871-history-parent-actions">
                <button
                  class="v871-history-more"
                  data-v871-supply-actions-trigger="parent"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded="false"
                  title="Más opciones"
                >⋯</button>
                <button
                  class="secondary v871-history-control"
                  data-v871-summary-toggle="1"
                  aria-controls="${summaryId}"
                  aria-expanded="false"
                  type="button"
                >Resumen</button>
                <button
                  class="secondary v871-history-control"
                  data-v871-deliveries-toggle="1"
                  aria-controls="${deliveriesId}"
                  aria-expanded="false"
                  type="button"
                >Ver entregas (${group.summary.deliveryCount})</button>
              </div>
            </div>

            <div id="${summaryId}" class="v871-history-summary" hidden>
              <div class="v871-history-summary-grid">
                <span><b>Planificado:</b> ${formatSummaryQuantity(summary.plannedTotal)}</span>
                <span><b>Entregado:</b> ${formatSummaryQuantity(summary.deliveredTotal)}</span>
                <span><b>Pendiente:</b> ${formatSummaryQuantity(summary.pendingTotal)}</span>
                <span><b>Cancelado:</b> ${formatSummaryQuantity(summary.cancelledTotal)}</span>
                <span><b>Estado:</b> ${escapeHtml(humanStatus(summary.status))}</span>
              </div>
            </div>

            <div id="${deliveriesId}" class="v871-history-deliveries" hidden>
              ${group.deliveries.length
                ? group.deliveries.map(delivery =>
                    renderSupplyDeliveryRow(
                      delivery.document,
                      actor,
                      memberIndex,
                      {
                        parentDocument: parent,
                        deliveredTotal: delivery.deliveredTotal
                      }
                    )
                  ).join('')
                : '<div class="empty compact-empty">No hay entregas físicas cerradas.</div>'}
            </div>
          </article>
        `;
      }).join('')
    : '<div class="empty compact-empty">No hay documentos cerrados visibles.</div>';
}

function renderSupplyDeliveryRow(
  document,
  actor,
  memberIndex,
  {
    parentDocument = null,
    deliveredTotal = null,
    fallbackKind = ''
  } = {}
) {
  const ownershipDocument = parentDocument || document;
  const owner = ownerLabel(ownershipDocument, actor, memberIndex);
  const godForeign = actor.roleCode === 'GOD' &&
    String(ownershipDocument.ownerId || '') !== actor.ownerId;
  const canCorrect = actor.roleCode === 'GOD' &&
    document.status === DOCUMENT_STATUS.CLOSED &&
    !document.metadata?.correctionDraftId;
  const technicalWhen = document.closedAt || document.updatedAt || document.createdAt;
  const fallbackLabel = fallbackKind === 'ORPHAN_DELIVERY'
    ? 'Entrega huérfana'
    : fallbackKind === 'LEGACY_SUPPLY'
      ? 'Surtido legacy'
      : 'Entrega física';
  const displayWhen = parentDocument
    ? formatOperationalTime(technicalWhen)
    : formatOperationalDate(technicalWhen);

  return `
    <div class="closed-document-row v82-operational-row v871-history-delivery ${godForeign ? 'v82-god-foreign' : ''}" data-v82-document-id="${escapeHtml(document.id)}">
      <div class="history-doc-title">
        <div class="history-doc-icon">↳</div>
        <div class="v82-document-copy">
          <strong title="ID técnico: ${escapeHtml(document.id)}">${escapeHtml(fallbackLabel)} · ${escapeHtml(displayWhen)}</strong>
          <small>${escapeHtml(humanStatus(document.status))}${deliveredTotal === null || deliveredTotal === undefined ? '' : ` · Entregado: ${formatSummaryQuantity(deliveredTotal)}`}</small>
          <span class="v82-owner-line">${godForeign ? '👑 ' : ''}${escapeHtml(owner)}</span>
        </div>
      </div>

      <button
        class="v871-history-more"
        data-v871-supply-actions-trigger="delivery"
        data-v871-delivery-actions-trigger="1"
        type="button"
        aria-haspopup="menu"
        aria-expanded="false"
        title="Acciones de esta entrega"
      >⋯</button>

      <div class="document-export-actions v871-history-action-staging" aria-hidden="true">
        <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="csv" type="button">CSV</button>
        <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="xlsx" type="button">Excel</button>
        <button class="primary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="print" type="button">Imprimir / PDF</button>
        ${canCorrect ? `
          <button
            class="danger"
            data-action="correct-document"
            data-id="${escapeHtml(document.id)}"
            data-type="${escapeHtml(DOCUMENT_TYPES.SUPPLY)}"
            type="button"
            title="Crea reversos y un nuevo borrador; no reescribe el original"
          >Corregir</button>
        ` : ''}
        ${document.metadata?.correctionDraftId
          ? '<span class="badge status-warning">Con corrección</span>'
          : ''}
      </div>
    </div>
  `;
}

function toggleSupplyHistoryPanel(trigger) {
  const targetId = String(trigger.getAttribute('aria-controls') || '').trim();
  if (!targetId) return;

  const target = document.getElementById(targetId);
  if (!target) return;

  const willOpen = target.hidden;
  target.hidden = !willOpen;
  trigger.setAttribute('aria-expanded', String(willOpen));
}

function ensureSupplyHistoryActionPortal() {
  let portal = document.querySelector('.v871-history-action-portal');
  if (portal) return portal;

  portal = document.createElement('div');
  portal.className = 'v871-history-action-portal';
  portal.hidden = true;
  portal.setAttribute('role', 'menu');
  portal.addEventListener('click', handleSupplyHistoryPortalClick);
  document.body.appendChild(portal);

  document.addEventListener('pointerdown', event => {
    if (portal.hidden) return;
    if (portal.contains(event.target)) return;
    if (event.target.closest('[data-v871-supply-actions-trigger]')) return;
    closeSupplyHistoryActionPortal();
  }, true);

  window.addEventListener('resize', closeSupplyHistoryActionPortal);
  window.addEventListener('scroll', closeSupplyHistoryActionPortal, true);
  return portal;
}

function openSupplyHistoryActionPortal(trigger) {
  const portal = ensureSupplyHistoryActionPortal();
  const row = trigger.closest('.closed-document-row');
  if (!row) return;

  closeSupplyHistoryActionPortal();
  portal.dataset.sourceDocumentId = String(row.dataset.v82DocumentId || '');

  if (trigger.dataset.v871DeliveryActionsTrigger === '1') {
    const staging = row.querySelector('.v871-history-action-staging');
    if (!staging) return;

    portal.innerHTML = `
      <div class="v871-history-action-title">Acciones de la entrega</div>
      <div class="v871-history-action-grid">${staging.innerHTML}</div>
    `;
  } else {
    const parent = trigger.closest('[data-v871-supply-history-parent]');
    const summary = parent?.querySelector('[data-v871-summary-toggle]');
    const deliveries = parent?.querySelector('[data-v871-deliveries-toggle]');
    if (!parent || !summary || !deliveries) return;

    portal.innerHTML = `
      <div class="v871-history-action-title">Surtido</div>
      <div class="v871-history-action-grid">
        <button class="secondary" data-v871-portal-toggle="summary" type="button">Resumen</button>
        <button class="secondary" data-v871-portal-toggle="deliveries" type="button">${escapeHtml(deliveries.textContent || 'Ver entregas')}</button>
      </div>
    `;
  }

  portal.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  portal._v871Trigger = trigger;
  requestAnimationFrame(() => positionSupplyHistoryActionPortal(portal, trigger));
}

function positionSupplyHistoryActionPortal(portal, trigger) {
  if (!portal || !trigger || portal.hidden) return;

  const triggerRect = trigger.getBoundingClientRect();
  const margin = 12;
  const width = Math.min(330, Math.max(220, window.innerWidth - margin * 2));
  const measuredHeight = Math.max(portal.offsetHeight, 80);
  const left = Math.min(
    Math.max(margin, triggerRect.right - width),
    Math.max(margin, window.innerWidth - width - margin)
  );
  const roomBelow = window.innerHeight - triggerRect.bottom - margin;
  const top = roomBelow >= measuredHeight
    ? triggerRect.bottom + 8
    : Math.max(margin, triggerRect.top - measuredHeight - 8);

  portal.style.width = `${width}px`;
  portal.style.left = `${Math.round(left)}px`;
  portal.style.top = `${Math.round(top)}px`;
}

function handleSupplyHistoryPortalClick(event) {
  const portal = event.currentTarget;
  const button = event.target.closest('button');
  if (!button) return;

  const portalToggle = button.dataset.v871PortalToggle;
  if (portalToggle) {
    event.preventDefault();
    const parentId = String(portal.dataset.sourceDocumentId || '');
    const parent = appRoot?.querySelector(
      `[data-v871-supply-history-parent][data-v82-document-id="${cssEscape(parentId)}"]`
    );
    const selector = portalToggle === 'summary'
      ? '[data-v871-summary-toggle]'
      : '[data-v871-deliveries-toggle]';
    const trigger = parent?.querySelector(selector);
    if (trigger) toggleSupplyHistoryPanel(trigger);
    closeSupplyHistoryActionPortal();
    return;
  }

  if (button.dataset.action === 'export-document' || button.dataset.action === 'correct-document') {
    event.preventDefault();
    forwardOperationalActionToApp(button);
    closeSupplyHistoryActionPortal();
    return;
  }

  // Las acciones SAINT y 80mm son atendidas por sus módulos mediante
  // delegación global en document. El portal conserva sus data-* originales.
  if (button.matches('[data-v5-saint-action], [data-supply-thermal-print]')) {
    setTimeout(closeSupplyHistoryActionPortal, 0);
  }
}

function forwardOperationalActionToApp(sourceButton) {
  if (!appRoot || !sourceButton) return;

  const bridge = document.createElement('button');
  bridge.type = 'button';
  bridge.hidden = true;

  ['action', 'id', 'format', 'type'].forEach(key => {
    const value = sourceButton.dataset[key];
    if (value !== undefined) bridge.dataset[key] = value;
  });

  appRoot.appendChild(bridge);
  try {
    bridge.click();
  } finally {
    bridge.remove();
  }
}

function closeSupplyHistoryActionPortal() {
  const portal = document.querySelector('.v871-history-action-portal');
  if (!portal || portal.hidden) return;

  if (portal._v871Trigger) {
    portal._v871Trigger.setAttribute('aria-expanded', 'false');
    portal._v871Trigger = null;
  }
  portal.hidden = true;
  portal.innerHTML = '';
  delete portal.dataset.sourceDocumentId;
}

function renderFlatHistoryRow(document, type, actor, memberIndex) {
  const icon = type === DOCUMENT_TYPES.ENTRY ? '↓' : '↑';
  const owner = ownerLabel(document, actor, memberIndex);
  const godForeign = actor.roleCode === 'GOD' &&
    String(document.ownerId || '') !== actor.ownerId;
  const canCorrect = actor.roleCode === 'GOD' &&
    document.status === DOCUMENT_STATUS.CLOSED &&
    !document.metadata?.correctionDraftId;
  const label = operationalDocumentLabel(document);

  return `
    <div class="closed-document-row v82-operational-row ${godForeign ? 'v82-god-foreign' : ''}" data-v82-document-id="${escapeHtml(document.id)}">
      <div class="history-doc-title">
        <div class="history-doc-icon">${icon}</div>
        <div class="v82-document-copy">
          <strong title="ID técnico: ${escapeHtml(document.id)}">${escapeHtml(label)}</strong>
          <small>${humanStatus(document.status)}</small>
          <span class="v82-owner-line">${godForeign ? '👑 ' : ''}${escapeHtml(owner)}</span>
        </div>
      </div>

      <div class="document-export-actions">
        <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="csv" type="button">CSV</button>
        <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="xlsx" type="button">Excel</button>
        <button class="primary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="print" type="button">Imprimir / PDF</button>
        ${canCorrect ? `
          <button
            class="danger"
            data-action="correct-document"
            data-id="${escapeHtml(document.id)}"
            data-type="${escapeHtml(type)}"
            type="button"
            title="Crea reversos y un nuevo borrador; no reescribe el original"
          >Corregir</button>
        ` : ''}
        ${document.metadata?.correctionDraftId
          ? '<span class="badge status-warning">Con corrección</span>'
          : ''}
      </div>
    </div>
  `;
}

function decorateHeadings(type, actor, draftCount, historyCount) {
  const landing = appRoot.querySelector('.document-landing-grid');
  const draftCard = landing?.querySelector('.draft-list-v2')?.closest('.card');
  const historyCard = appRoot.querySelector('.document-history-card');

  if (draftCard) {
    const title = draftCard.querySelector('.section-head h3');
    const description = draftCard.querySelector('.section-head p');
    const badge = draftCard.querySelector('.section-head .badge');

    if (title) {
      title.textContent = actor.roleCode === 'GOD'
        ? '👑 Trabajo del equipo · GOD'
        : 'Mi trabajo';
    }
    if (description) {
      description.textContent = actor.roleCode === 'GOD'
        ? 'Puedes abrir, agregar, modificar, cerrar o cancelar borradores de cualquier almacenista.'
        : 'Solo tus borradores son visibles aquí.';
    }
    if (badge) badge.textContent = String(draftCount);
  }

  if (historyCard) {
    const title = historyCard.querySelector('.section-head h3');
    const description = historyCard.querySelector('.section-head p');
    const badge = historyCard.querySelector('.section-head .badge');

    if (title) {
      title.textContent = actor.roleCode === 'GOD'
        ? '👑 Historial del equipo'
        : 'Mi historial reciente';
    }
    if (description) {
      description.textContent = type === DOCUMENT_TYPES.SUPPLY
        ? actor.roleCode === 'GOD'
          ? 'Surtidos cerrados o con entregas físicas; los hijos permanecen trazables dentro de su carrito.'
          : 'Tus Surtidos cerrados o con entregas físicas, agrupados por carrito.'
        : actor.roleCode === 'GOD'
          ? 'Los cerrados permanecen inmutables; Corregir crea reversos trazables y un nuevo borrador.'
          : 'Solo aparecen tus Entradas cerradas.';
    }
    if (badge) badge.textContent = String(historyCount);
  }

  if (actor.roleCode === 'GOD') {
    const hero = appRoot.querySelector('.hero.dashboard-hero');
    if (hero && !hero.querySelector('.v82-god-badge')) {
      const badge = document.createElement('span');
      badge.className = 'badge v82-god-badge';
      badge.textContent = `👑 Supervisión GOD · ${type === DOCUMENT_TYPES.ENTRY ? 'Entradas' : 'Surtidos'}`;
      hero.querySelector('div')?.appendChild(badge);
    }
  }
}

function forwardOpenToApp(documentId, type) {
  if (!appRoot) return;

  // Puente explícito V8.3: el panel GOD no mantiene un segundo editor.
  // Reenvía la intención al contrato normal data-action=open-document de app.js.
  const bridge = document.createElement('button');
  bridge.type = 'button';
  bridge.hidden = true;
  bridge.dataset.action = 'open-document';
  bridge.dataset.id = String(documentId || '');
  bridge.dataset.type = String(type || '');
  appRoot.appendChild(bridge);

  try {
    bridge.click();
  } finally {
    bridge.remove();
  }
}

function operationalDocumentLabel(document) {
  const type = String(document?.type || '').toUpperCase();
  const name = type === DOCUMENT_TYPES.ENTRY ? 'Entrada' : 'Surtido';
  const when = document?.closedAt || document?.updatedAt || document?.createdAt;
  return `${name} · ${formatOperationalDate(when)}`;
}

function humanStatus(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === DOCUMENT_STATUS.CLOSED) return 'Cerrado';
  if (normalized === DOCUMENT_STATUS.DRAFT) return 'Borrador';
  if (normalized === DOCUMENT_STATUS.CANCELLED) return 'Cancelado';
  return normalized || 'Sin estado';
}

function ownerLabel(document, actor, memberIndex) {
  const ownerId = String(document.ownerId || '').trim();
  if (ownerId && ownerId === actor.ownerId) return 'Responsable: tú';

  const member = memberIndex.get(ownerId);
  if (member) {
    const label = member.displayName || member.email || 'Usuario del equipo';
    return `Responsable: ${label}`;
  }

  if (!ownerId) return 'Responsable: Sin identificar';
  return 'Responsable: Usuario del equipo';
}

function sortNewest(a, b) {
  return String(b.closedAt || b.updatedAt || b.createdAt || '')
    .localeCompare(String(a.closedAt || a.updatedAt || a.createdAt || ''));
}

function formatOperationalDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return 'Sin fecha';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatSummaryQuantity(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return escapeHtml(new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 6
  }).format(number));
}

function formatOperationalTime(value) {
  if (!value) return 'Sin hora';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin hora';

  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

function formatOperationalDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} · ${hour}:${minute}`;
}

function domSafeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value || ''));
  return String(value || '').replace(/["\\]/g, '\\$&');
}

function showToast(message, tone = 'info') {
  let toast = document.querySelector('.v82-oversight-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'v82-oversight-toast';
    document.body.appendChild(toast);
  }

  toast.dataset.tone = tone;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}