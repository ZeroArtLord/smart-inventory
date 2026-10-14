// ÚNICA plantilla de tickets Monitor para el piloto y el espejo en VIGÍA normal.
// Nunca convierte unidades, modifica stock, guarda listas ni toca entidades legacy.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function renderMonitorTicketSet({ weekStart, items = [] } = {}) {
  const all = Array.isArray(items) ? items : [];
  const buy = all.filter(x => x.decision === 'BUY' && !x.deleted);
  const order = all.filter(x => x.decision === 'ORDER' && !x.deleted);
  return [
    renderMonitorTicket('LISTA DE COMPRAS', 'COPIA CHÓFER', buy, weekStart),
    renderMonitorTicket('LISTA DE COMPRAS', 'COPIA DEPÓSITO', buy, weekStart),
    renderMonitorTicket('LISTA DE PEDIDOS', 'COPIA PROVEEDOR', order, weekStart),
    renderMonitorTicket('LISTA DE PEDIDOS', 'COPIA DEPÓSITO', order, weekStart)
  ].join('');
}

export function renderMonitorTicket(title, copy, items, weekStart) {
  const byCategory = new Map();
  for (const item of items) {
    if (!item || (item.decision !== 'BUY' && item.decision !== 'ORDER') || item.deleted) continue;
    const key = String(item.category || 'SIN CATEGORÍA');
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(item);
  }
  const grouped = [...byCategory.entries()]
    .sort((a,b) => a[0] === 'EXTRAS' ? 1 : b[0] === 'EXTRAS' ? -1 : a[0].localeCompare(b[0], 'es'));

  let body = '';
  for (const [category, rows] of grouped) {
    body += '<strong class="mp-ticket-category">' + esc(category) + '</strong>';
    for (const item of rows) {
      // "null" se imprime como hueco, nunca 0.
      const quantity = item.quantity === null || item.quantity === undefined || item.quantity === ''
        ? '________' : String(item.quantity);
      body += '<div class="mp-ticket-line"><span class="mp-ticket-product">' +
        esc(item.name ?? item.description ?? item.productId ?? '[SIN NOMBRE]') +
        (item.notes ? '<small>Nota: ' + esc(item.notes) + '</small>' : '') +
        '</span><b>' + esc(quantity) + (item.unit ? ' ' + esc(item.unit) : '') + '</b></div>';
    }
  }
  return '<div class="mp-ticket"><h3>VIGÍA MONITOR' +
    '<br>' + esc(title) + '</h3>' +
    '<div style="text-align:center">' + esc(copy) + '<br>Semana ' + esc(weekStart || '') + '</div><hr>' +
    (body || '<p>Sin artículos</p>') +
    '<hr>Firma: ______________</div>';
}
