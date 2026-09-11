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

const appRoot = document.getElementById('app');
const TEAM_TYPES = new Set([DOCUMENT_TYPES.ENTRY, DOCUMENT_TYPES.SUPPLY]);
const documentsById = new Map();
let currentActor = null;
let enhancing = false;
let memberCache = [];
let memberCacheAt = 0;

if (appRoot) {
  const observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(appRoot, { childList: true, subtree: true });

  // Segunda barrera del lado cliente: aunque alguien intente reinsertar un
  // botón ajeno en el DOM, un WAREHOUSE no puede abrir/exportar/cancelar ni
  // corregir un ENTRY/SUPPLY que no le pertenece. El servidor aplica además
  // la misma regla al push para proteger contra clientes manipulados.
  appRoot.addEventListener('click', event => {
    const action = event.target.closest(
      '[data-action="open-document"], ' +
      '[data-action="cancel-document"], ' +
      '[data-action="export-document"], ' +
      '[data-action="correct-document"]'
    );
    if (!action || !currentActor) return;

    const document = documentsById.get(String(action.dataset.id || ''));
    if (!document || !TEAM_TYPES.has(document.type)) return;

    if (!canActorAccessOperationalDocument(document, currentActor)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast('Ese documento pertenece a otro usuario.', 'danger');
    }
  }, true);

  scheduleEnhance();
}

function scheduleEnhance() {
  queueMicrotask(() => enhanceOperationalWorkspace().catch(error => {
    console.warn('VIGÍA V8.2: no se pudo aplicar supervisión operativa.', error);
  }));
}

async function enhanceOperationalWorkspace() {
  if (!appRoot || enhancing) return;

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
    const history = visible
      .filter(document =>
        document.status !== DOCUMENT_STATUS.DRAFT &&
        document.status !== DOCUMENT_STATUS.CANCELLED
      )
      .sort(sortNewest)
      .slice(0, 10);

    const members = currentActor.roleCode === 'GOD'
      ? await getGodMembers()
      : [];
    const memberIndex = buildMemberIndex(members);

    renderDrafts(draftList, drafts, type, currentActor, memberIndex);
    renderHistory(historyList, history, type, currentActor, memberIndex);
    decorateHeadings(type, currentActor, drafts.length, history.length);

    draftList.dataset.v82AccessReady = '1';
    if (historyList) historyList.dataset.v82AccessReady = '1';
  } finally {
    enhancing = false;
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

async function getGodMembers() {
  const now = Date.now();
  if (memberCache.length && now - memberCacheAt < 60000) {
    return memberCache;
  }

  try {
    memberCache = await listWorkspaceMembers();
    memberCacheAt = now;
  } catch (error) {
    console.warn('VIGÍA V8.2: miembros no disponibles para etiquetas GOD.', error);
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

        return `
          <div class="draft-row-v2 v82-operational-row ${godForeign ? 'v82-god-foreign' : ''}" data-v82-document-id="${escapeHtml(document.id)}">
            <div class="draft-icon-v2">${icon}</div>
            <div class="v82-document-copy">
              <strong>${escapeHtml(document.id)}</strong>
              <small>${formatDate(document.updatedAt)}</small>
              <span class="v82-owner-line">${godForeign ? '👑 ' : ''}${escapeHtml(owner)}</span>
            </div>
            <div class="draft-actions-v2">
              <button
                class="secondary"
                data-action="open-document"
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

function renderHistory(container, documents, type, actor, memberIndex) {
  if (!container) return;
  const icon = type === DOCUMENT_TYPES.ENTRY ? '↓' : '↑';

  container.innerHTML = documents.length
    ? documents.map(document => {
        const owner = ownerLabel(document, actor, memberIndex);
        const godForeign = actor.roleCode === 'GOD' &&
          String(document.ownerId || '') !== actor.ownerId;
        const canCorrect = actor.roleCode === 'GOD' &&
          document.status === DOCUMENT_STATUS.CLOSED &&
          !document.metadata?.correctionDraftId;

        return `
          <div class="closed-document-row v82-operational-row ${godForeign ? 'v82-god-foreign' : ''}" data-v82-document-id="${escapeHtml(document.id)}">
            <div class="history-doc-title">
              <div class="history-doc-icon">${icon}</div>
              <div class="v82-document-copy">
                <strong>${escapeHtml(document.id)}</strong>
                <small>${escapeHtml(document.status)} · ${formatDate(document.closedAt || document.updatedAt)}</small>
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
      }).join('')
    : '<div class="empty compact-empty">No hay documentos cerrados visibles.</div>';
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
      description.textContent = actor.roleCode === 'GOD'
        ? 'Los cerrados permanecen inmutables; Corregir crea reversos trazables y un nuevo borrador.'
        : 'Solo aparecen tus Entradas o Surtidos cerrados.';
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

function ownerLabel(document, actor, memberIndex) {
  const ownerId = String(document.ownerId || '').trim();
  if (ownerId && ownerId === actor.ownerId) return 'Responsable: tú';

  const member = memberIndex.get(ownerId);
  if (member) {
    const label = member.displayName || member.email || member.externalAuthId || member.userId;
    return `Responsable: ${label}`;
  }

  if (!ownerId) return 'Responsable: propietario no identificado';
  return `Responsable: ${shortId(ownerId)}`;
}

function sortNewest(a, b) {
  return String(b.closedAt || b.updatedAt || b.createdAt || '')
    .localeCompare(String(a.closedAt || a.updatedAt || a.createdAt || ''));
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function shortId(value) {
  const text = String(value || '');
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
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
