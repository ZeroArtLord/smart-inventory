import { isProcurementExtra } from '../replenishment/warehouseProcurementService.js';
import { procurementCategoryOf, procurementDisplayQuantity } from '../replenishment/procurementListService.js';
import { esc } from './procurementWorkspaceV6Render.js';

export function renderPrintModal({ list, businessName }) {
  const typeLabel = list.kind === 'ORDER' ? 'LISTA DE PEDIDOS' : 'LISTA DE COMPRAS';
  const copies = list.kind === 'ORDER'
    ? ['COPIA PEDIDO / PROVEEDOR', 'COPIA DEPÓSITO']
    : ['COPIA CHÓFER', 'COPIA DEPÓSITO'];
  const active = list.items.filter(item => item.status !== 'CANCELLED');
  const groups = groupByCategory(active);

  return `
    <div class="v6p-modal v6p-print-modal">
      <div class="v6p-modal-head">
        <div><div class="v6p-eyebrow">PREVISUALIZACIÓN 80MM</div><h3>Así saldría de la impresora térmica</h3><p>Vista previa solamente; no necesitas tener la comandera conectada ahora.</p></div>
        <button class="v6p-ghost" data-v6p-action="close-print" type="button">Cerrar</button>
      </div>
      <div class="v6p-modal-body">
        <div class="v6p-print-toolbar">
          <label>Nombre del negocio<input id="v6pBusinessName" value="${esc(businessName)}" maxlength="80"></label>
          <button class="v6p-ghost" data-v6p-action="save-business-name" type="button">Guardar nombre</button>
          <button class="v6p-primary" data-v6p-action="browser-print" type="button">🖨 Imprimir</button>
        </div>
        <div class="v6p-ticket-preview">
          ${copies.map(copy => ticket({ list, typeLabel, copy, groups, businessName })).join('')}
        </div>
      </div>
    </div>
  `;
}

function ticket({ list, typeLabel, copy, groups, businessName }) {
  const actor = list.ownerLabel || 'Usuario VIGÍA';
  return `
    <section class="v6p-ticket ${list.kind === 'ORDER' ? 'is-order' : 'is-buy'}">
      <header class="v6p-ticket-head">
        <small>VIGÍA · Inventory Intelligence</small>
        <strong>${esc(businessName || 'NOMBRE DEL NEGOCIO')}</strong>
        <b>${typeLabel}</b>
        <span>${copy}</span>
      </header>
      <div class="v6p-ticket-meta">
        <div><b>Lista:</b> ${esc(list.code)}</div>
        <div><b>Fecha:</b> ${esc(list.dateLabel)}</div>
        <div><b>Almacenista:</b> ${esc(actor)}</div>
      </div>
      <div class="v6p-ticket-rule"></div>
      <div class="v6p-ticket-legend"><span>PRODUCTO</span><span>CANT.</span><span>OK</span></div>
      ${[...groups.entries()].map(([category, items]) => `
        <section class="v6p-ticket-category">
          <h4>${esc(category)}</h4>
          ${items.map(ticketRow).join('')}
        </section>
      `).join('')}
      <div class="v6p-ticket-notes"><b>Observaciones:</b><i></i><i></i></div>
      <div class="v6p-ticket-rule is-solid"></div>
      <footer>${esc(typeLabel)} · ${copy}<br>Firma: __________________</footer>
    </section>
  `;
}

function ticketRow(item) {
  const display = procurementDisplayQuantity(item);
  const extra = isProcurementExtra(item);
  return `
    <div class="v6p-ticket-row">
      <div><strong>${esc(item.productName || item.productId)}</strong>${item.notes ? `<span>(${esc(item.notes)})</span>` : ''}${extra ? '<small>EXTRA</small>' : ''}</div>
      <b>${esc(formatNumber(display.quantity))} ${esc(shortUnit(display.unit))}</b>
      <i></i>
    </div>
  `;
}

function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const category = procurementCategoryOf(item) || 'SIN CATEGORÍA';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return new Map([...groups.entries()].sort((a,b) => {
    if (a[0] === 'EXTRAS') return 1;
    if (b[0] === 'EXTRAS') return -1;
    return a[0].localeCompare(b[0], 'es');
  }));
}

function shortUnit(unit) {
  const value = String(unit || 'UND').toUpperCase();
  return ({ CAJA:'CJ', CAJAS:'CJ', BULTO:'BUL', BULTOS:'BUL', PAQUETE:'PAQ', PAQ:'PAQ' })[value] || value;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : new Intl.NumberFormat('es-VE',{maximumFractionDigits:3}).format(number);
}
