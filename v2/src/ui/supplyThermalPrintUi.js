import { get, getAll, STORES } from '../storage/database.js';
import { listDocumentLines } from '../documents/documentService.js';
import {
  DOCUMENT_STATUS,
  DOCUMENT_TYPES
} from '../documents/documentTypes.js';
import {
  getCurrentSession,
  listWorkspaceMembers
} from '../admin/adminClient.js';
import {
  buildSupplyThermalPayload,
  buildConsolidatedSupplyThermalPayload
} from '../printing/supplyThermalPayload.js';
import { printThermalSupplyDocument } from '../printing/thermalPrinterClient.js';

const app = document.getElementById('app');
const printing = new Set();
const LIVE_SUPPLY_DELIVERY = 'LIVE_SUPPLY_DELIVERY';
let timer = null;

if (app) {
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(app, { childList: true, subtree: true });
  document.addEventListener('click', handleClick, true);
  scheduleEnhance();
}

function scheduleEnhance() {
  clearTimeout(timer);
  timer = setTimeout(enhance, 30);
}

function enhance() {
  if (!isSupplyView()) return;

  app
    .querySelectorAll('.document-history-list .closed-document-row')
    .forEach(row => {
      const actions = row.querySelector('.document-export-actions');
      if (!actions || actions.querySelector('[data-supply-thermal-print]')) {
        return;
      }

      const documentId = resolveDocumentId(row);
      if (!documentId) return;

      const button = document.createElement('button');
      button.className = 'secondary';
      button.type = 'button';
      button.dataset.supplyThermalPrint = '1';
      button.dataset.documentId = documentId;
      button.textContent = '🖨 80mm';
      button.title = 'Imprimir una copia térmica del surtido real';

      const correct = actions.querySelector('[data-action="correct-document"]');
      if (correct) actions.insertBefore(button, correct);
      else actions.appendChild(button);
    });
}

function resolveDocumentId(row) {
  const godId = String(row?.dataset?.v82DocumentId || '').trim();
  if (godId) return godId;

  const legacy = row?.querySelector(
    '[data-action="export-document"][data-id]'
  );
  return String(legacy?.dataset?.id || '').trim();
}

async function handleClick(event) {
  const parentAction = event.target.closest('[data-v871-parent-action="thermal"]');
  if (parentAction) {
    const portal = parentAction.closest('.v871-history-action-portal');
    const parentId = String(portal?.dataset?.sourceDocumentId || '').trim();
    if (!parentId) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    closeHistoryPortal();
    await printConsolidatedParentSupply(parentId);
    return;
  }

  const button = event.target.closest('[data-supply-thermal-print]');
  if (!button) return;

  event.preventDefault();
  await printIndividualSupply(button);
}

async function printIndividualSupply(button) {
  const documentId = String(button.dataset.documentId || '').trim();
  if (!documentId || printing.has(documentId)) return;

  printing.add(documentId);
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Enviando…';

  try {
    const [document, lines, products, categories, session] = await Promise.all([
      get(STORES.DOCUMENTS, documentId),
      listDocumentLines(documentId),
      getAll(STORES.PRODUCTS),
      getAll(STORES.CATEGORIES),
      safeSession()
    ]);

    if (!document) {
      throw new Error('No se encontró el surtido en este dispositivo');
    }
    if (document.type !== DOCUMENT_TYPES.SUPPLY) {
      throw new Error('El documento seleccionado no es un surtido');
    }
    if (document.status !== DOCUMENT_STATUS.CLOSED) {
      throw new Error('Solo se imprimen surtidos cerrados');
    }

    const ownerLabel = await resolveOwnerLabel(document, session);
    const supply = buildSupplyThermalPayload({
      document,
      lines,
      products,
      categories,
      ownerLabel
    });

    const result = await printThermalSupplyDocument(supply);
    toast(
      `${result.itemCount} renglón(es) · 1 copia · ${result.printer.name}`
    );
  } catch (error) {
    console.error(error);
    toast(error?.message || String(error), true);
  } finally {
    printing.delete(documentId);
    button.disabled = false;
    button.textContent = previous;
  }
}

async function printConsolidatedParentSupply(parentId) {
  const printKey = `parent:${parentId}`;
  if (printing.has(printKey)) return;
  printing.add(printKey);

  try {
    const [parentDocument, documents, products, categories, session] = await Promise.all([
      get(STORES.DOCUMENTS, parentId),
      getAll(STORES.DOCUMENTS),
      getAll(STORES.PRODUCTS),
      getAll(STORES.CATEGORIES),
      safeSession()
    ]);

    if (!parentDocument || parentDocument.type !== DOCUMENT_TYPES.SUPPLY) {
      throw new Error('No se encontró el Surtido padre en este dispositivo');
    }

    const deliveryDocuments = (Array.isArray(documents) ? documents : [])
      .filter(document =>
        document.type === DOCUMENT_TYPES.SUPPLY &&
        document.status === DOCUMENT_STATUS.CLOSED &&
        String(document?.metadata?.kind || '').trim().toUpperCase() === LIVE_SUPPLY_DELIVERY &&
        String(document?.metadata?.parentCartId || '').trim() === parentId
      )
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    if (!deliveryDocuments.length) {
      throw new Error('Este Surtido no tiene entregas físicas cerradas para imprimir');
    }

    const deliveryLines = await Promise.all(
      deliveryDocuments.map(delivery => listDocumentLines(delivery.id))
    );
    const lines = deliveryLines.flat();
    const ownerLabel = await resolveOwnerLabel(parentDocument, session);
    const supply = buildConsolidatedSupplyThermalPayload({
      parentDocument,
      deliveryDocuments,
      lines,
      products,
      categories,
      ownerLabel
    });

    const result = await printThermalSupplyDocument(supply);
    toast(
      `${result.itemCount} producto(s) consolidado(s) · ${deliveryDocuments.length} entrega(s) · 1 copia · ${result.printer.name}`
    );
  } catch (error) {
    console.error(error);
    toast(error?.message || String(error), true);
  } finally {
    printing.delete(printKey);
  }
}

function closeHistoryPortal() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

function isSupplyView() {
  const h2 = app?.querySelector('h2');
  return Boolean(
    h2 &&
    String(h2.textContent || '').trim().toLowerCase() === 'surtido'
  );
}

async function resolveOwnerLabel(document, session) {
  const safe = session || {};
  const ownerId = String(document?.ownerId || '').trim();
  const actorId = sessionActorId(safe);

  if (ownerId && ownerId === actorId) {
    return sessionLabel(safe);
  }

  if (String(safe.roleCode || '').trim().toUpperCase() === 'GOD') {
    try {
      const members = await listWorkspaceMembers();
      const member = (Array.isArray(members) ? members : []).find(item =>
        [item?.externalAuthId, item?.userId]
          .map(value => String(value || '').trim())
          .includes(ownerId)
      );

      if (member) {
        return String(
          member.displayName ||
          member.email ||
          'Usuario del equipo'
        );
      }
    } catch (error) {
      console.warn('No se pudo resolver responsable del surtido térmico', error);
    }
  }

  return 'Usuario VIGÍA';
}

function sessionActorId(session = {}) {
  const safe = session || {};
  const firebase = String(safe.authMode || '').toLowerCase() === 'firebase';
  return String(
    firebase
      ? safe.externalAuthId || safe.userId || ''
      : safe.userId || ''
  ).trim();
}

function sessionLabel(session = {}) {
  const safe = session || {};
  const direct = String(safe.displayName || '').trim();
  if (direct) return direct;

  const email = String(safe.email || '').trim();
  if (email) return email.split('@')[0];

  return 'Usuario VIGÍA';
}

async function safeSession() {
  try {
    return await getCurrentSession();
  } catch {
    return null;
  }
}

function toast(message, danger = false) {
  const save = document.getElementById('saveStatus');
  if (save) save.textContent = String(message || 'Listo');

  const node = document.createElement('div');
  node.className = 'v6p-toast';
  if (danger) node.dataset.tone = 'danger';
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}
