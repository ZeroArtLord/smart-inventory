// Espejo de listas Monitor dentro de VIGÍA Comprar/Pedir NORMAL.
// No crea/edita reposiciones legacy ni escribe al servidor: solo GET.
// Autorización real se valida en /api/v1/monitor (allowlist del servidor).
import { apiRequest } from '../api/apiClient.js';
import { readMonitorReview, syncMonitorReview } from '../replenishment/monitorReviewOffline.js';
import { renderProcurementTickets } from './procurementWorkspaceV6Print.js';
import { listCard } from './procurementWorkspaceV6Render.js';
import { buildMonitorNativeLists } from '../replenishment/monitorNativeTicketAdapter.js';
import { projectMonitorToNormal } from '../replenishment/monitorToNormalMirror.js';

export function currentMonitorWeek(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export async function fetchMonitorMirrorForNormal({ session, products, categories, weekStart = currentMonitorWeek(), syncBeforeFetch = false }) {
  const workspaceId = String(session?.workspaceId || session?.workspace?.id || '');
  const userId = String(session?.userId || '');
  if (!workspaceId || !userId) throw new Error('Se requiere sesión y almacén');
  if (syncBeforeFetch) {
    // Reintento controlado de los cambios en ESTE dispositivo antes de imprimir.
    // No descarta conflictos ni elimina la cola si falla la red.
    await syncMonitorReview({ workspaceId, userId, weekStart });
  }
  const response = await apiRequest('/api/v1/monitor/reviews/' + encodeURIComponent(weekStart));
  if (String(response.workspaceId) !== workspaceId || response.weekStart !== weekStart) {
    throw new Error('La respuesta Monitor no corresponde a esta sesión');
  }
  // Si IndexedDB falla, los datos remotos siguen intactos y visibles.
  let localState = null;
  try { localState = await readMonitorReview({ workspaceId, userId, weekStart }); }
  catch (error) { console.warn('Vista local Monitor no disponible', error); }
  return projectMonitorToNormal({
    serverItems: response.items || [], localState, products, categories, weekStart
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
export function assertMonitorPrintable(snapshot) {
  if (!snapshot || snapshot.source !== 'monitor-weekly-review') {
    throw new Error('Se necesita una revisión Monitor válida para imprimir');
  }
  if (snapshot.counts.conflicts || snapshot.counts.pendingLocal) {
    throw new Error('Hay cambios sin sincronizar o en conflicto. Sincroniza antes de imprimir.');
  }
  if (snapshot.counts.unresolvedProducts) {
    throw new Error('El catálogo no contiene todos los productos. No se imprime una lista incompleta.');
  }
  const buy = snapshot.lists.PURCHASE || [];
  const order = snapshot.lists.ORDER || [];
  if (!buy.length && !order.length) {
    throw new Error('No hay productos seleccionados para imprimir');
  }
  return true;
}

// Renderiza exactamente la misma plantilla V6 que usa "Vista 80mm" en VIGÍA normal.
export function printableMonitorMirror(snapshot,{ownerLabel,businessName}={}) {
  assertMonitorPrintable(snapshot);
  return buildMonitorNativeLists(snapshot,{ownerLabel})
    .map(list=>renderProcurementTickets({list,businessName})).join('');
}

export function renderMonitorMirrorForNormal(snapshot, { loading = false, error = '', ownerLabel = 'Usuario VIGÍA' } = {}) {
  const css = 'margin:14px 0;padding:18px;border:1px solid #aecbdf;border-radius:14px;background:#f6fbfe;color:#142c42';
  const header = '<section id="v6MonitorMirror" style="' + css + '" aria-label="Listas espejo de VIGÍA Monitor">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><strong style="font-size:1.13rem">✦ Listas de Monitor (espejo)</strong>' +
    '<p style="margin:4px 0;font-size:.85rem">La misma revisión semanal de Monitor, sin duplicar operaciones en las listas tradicionales.</p></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
    '<button type="button" data-v6p-action="refresh-monitor-mirror" class="v6p-ghost">↻ Actualizar</button>' +
    '<button type="button" data-v6p-action="print-monitor-mirror" class="v6p-primary">↻ Actualizar y ver listas</button></div></div>';
  if (loading) return header + '<p role="status">Consultando Monitor…</p></section>';
  if (error) return header + '<p role="alert">No se pudo leer Monitor: ' + escapeHtml(error) +
    '. No se modificó ninguna lista.</p></section>';
  if (!snapshot) return '';
  const list = snapshot.lists;
  const warning = snapshot.counts.conflicts
    ? '<p role="alert" style="color:#a33">⚠ ' + snapshot.counts.conflicts + ' edición(es) local(es) en conflicto. No las des por consolidadas.</p>'
    : snapshot.counts.pendingLocal
      ? '<p role="status" style="color:#9a6600">⚠ ' + snapshot.counts.pendingLocal + ' cambio(s) solo en este dispositivo, aún sin confirmar en servidor.</p>'
      : '<p role="status" style="color:#215d47">✓ Lectura del servidor Monitor; sin cambios locales pendientes en esta vista.</p>';
  const missing = snapshot.counts.unresolvedProducts
    ? '<p role="alert">⚠ ' + snapshot.counts.unresolvedProducts + ' producto(s) no pudieron asociarse al catálogo local. Se muestran por ID y NO se omiten.</p>' : '';
  // Misma tarjeta del V6 original; Monitor es lectura semanal, no copia legacy.
  const nativeLists=buildMonitorNativeLists(snapshot,{ownerLabel});
  const cards=nativeLists.map(x=>listCard(x,{monitor:true})).join('');
  return header +
    '<p style="margin:12px 0">Semana ' + escapeHtml(snapshot.weekStart) +
    ' · Comprar: <b>' + list.PURCHASE.length + '</b> · Pedir: <b>' + list.ORDER.length + '</b>' +
    ' · Revisados: <b>' + snapshot.counts.reviewed + ' / ' + snapshot.counts.totalProducts + '</b>' +
    ' · Pendientes: <b>' + snapshot.counts.pending + '</b></p>' +
    warning + missing +
    '<p style="font-size:.81rem;color:#526678">Vista sincronizada bajo demanda. Los documentos y borradores normales permanecen independientes y sin alteraciones. No confirma ni cierra listas.</p>' +
    '<div class="v6p-list-grid">' + cards + '</div></section>';
}
