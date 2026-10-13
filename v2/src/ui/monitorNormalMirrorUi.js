// Espejo de listas Monitor dentro de VIGÍA Comprar/Pedir NORMAL.
// No crea/edita reposiciones legacy ni escribe al servidor: solo GET.
// Autorización real se valida en /api/v1/monitor (allowlist del servidor).
import { apiRequest } from '../api/apiClient.js';
import { readMonitorReview } from '../replenishment/monitorReviewOffline.js';
import { projectMonitorToNormal } from '../replenishment/monitorToNormalMirror.js';

export function currentMonitorWeek(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export async function fetchMonitorMirrorForNormal({ session, products, categories, weekStart = currentMonitorWeek() }) {
  const workspaceId = String(session?.workspaceId || session?.workspace?.id || '');
  const userId = String(session?.userId || '');
  if (!workspaceId || !userId) throw new Error('Se requiere sesión y almacén');
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
function displayQuantity(item) {
  return item.quantity === null ? '________' : String(item.quantity);
}
export function renderMonitorMirrorForNormal(snapshot, { loading = false, error = '' } = {}) {
  const css = 'margin:14px 0;padding:18px;border:1px solid #aecbdf;border-radius:14px;background:#f6fbfe;color:#142c42';
  const header = '<section id="v6MonitorMirror" style="' + css + '" aria-label="Listas espejo de VIGÍA Monitor">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><strong style="font-size:1.13rem">✦ Listas de Monitor (espejo)</strong>' +
    '<p style="margin:4px 0;font-size:.85rem">La misma revisión semanal de Monitor, sin duplicar operaciones en las listas tradicionales.</p></div>' +
    '<button type="button" data-v6p-action="refresh-monitor-mirror" class="v6p-ghost">↻ Actualizar espejo</button></div>';
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
  const ticket = (title, copy, rows) => {
    let html = '<article style="padding:14px;background:white;border:1px dashed #b5c3d0;border-radius:8px;min-width:0">' +
      '<h4 style="margin:0 0 5px">' + title + '</h4><small>COPIA ' + copy +
      ' · Semana ' + escapeHtml(snapshot.weekStart) + '</small>';
    if (!rows.length) return html + '<p style="color:#667">Sin artículos</p></article>';
    let prev = null;
    for (const item of rows) {
      if (item.category !== prev) {
        prev = item.category;
        html += '<h5 style="margin:14px 0 6px;border-bottom:1px solid #eee">' +
          escapeHtml(prev) + '</h5>';
      }
      html += '<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #f0f2f4">' +
        '<span style="min-width:0;overflow-wrap:anywhere">' + escapeHtml(item.description) +
        (item.notes ? '<small style="display:block;color:#667">Nota: ' + escapeHtml(item.notes) + '</small>' : '') +
        (item.localOnly ? '<small style="display:block;color:#9a6600">Pendiente local: ' +
          escapeHtml(item.localStatus || 'SIN ENVIAR') + '</small>' : '') + '</span>' +
        '<strong style="white-space:nowrap">' + escapeHtml(displayQuantity(item)) +
        ' ' + escapeHtml(item.unit) + '</strong></div>';
    }
    return html + '</article>';
  };
  const cards = [
    ticket('LISTA DE COMPRAS', 'CHÓFER', list.PURCHASE),
    ticket('LISTA DE COMPRAS', 'DEPÓSITO', list.PURCHASE),
    ticket('LISTA DE PEDIDOS', 'PROVEEDOR', list.ORDER),
    ticket('LISTA DE PEDIDOS', 'DEPÓSITO', list.ORDER)
  ];
  return header +
    '<p style="margin:12px 0">Semana ' + escapeHtml(snapshot.weekStart) +
    ' · Comprar: <b>' + list.PURCHASE.length + '</b> · Pedir: <b>' + list.ORDER.length + '</b></p>' +
    warning + missing +
    '<p style="font-size:.81rem;color:#526678">Vista sincronizada bajo demanda. Los documentos y borradores normales permanecen independientes y sin alteraciones. No confirma ni cierra listas.</p>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px">' + cards.join('') + '</div></section>';
}
