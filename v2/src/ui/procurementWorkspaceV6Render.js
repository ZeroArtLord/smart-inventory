import {
  isProcurementExtra
} from '../replenishment/warehouseProcurementService.js';
import {
  procurementCategoryOf,
  procurementDisplayQuantity
} from '../replenishment/procurementListService.js';

export function renderWorkspace(model) {
  const {
    activeTab,
    visibleRows,
    manualRows,
    drafts,
    productsById,
    pendingExtras,
    lists,
    selectedCount,
    purchaseCount,
    orderCount,
    query,
    filter
  } = model;

  return `
    <nav class="v6p-tabs" aria-label="Comprar/Pedir">
      ${tab('replenish', 'Necesito reponer', activeTab)}
      ${tab('lists', 'Mis listas', activeTab)}
      ${tab('extras', 'Extras', activeTab)}
    </nav>

    <section class="v6p-panel ${activeTab === 'replenish' ? 'is-active' : ''}">
      ${renderReplenish({ visibleRows, manualRows, drafts, productsById, query, filter })}
    </section>
    <section class="v6p-panel ${activeTab === 'lists' ? 'is-active' : ''}">
      ${renderLists(lists)}
    </section>
    <section class="v6p-panel ${activeTab === 'extras' ? 'is-active' : ''}">
      ${renderExtras(pendingExtras)}
    </section>

    ${activeTab === 'replenish' ? `
      <div class="v6p-sticky">
        <div><strong>${selectedCount} seleccionado(s)</strong><small>${purchaseCount} Comprar · ${orderCount} Pedir</small></div>
        <div class="v6p-sticky-copy"><strong>Solo lo marcado entrará en la lista.</strong><small>Puedes editar cantidades y notas antes de confirmar.</small></div>
        <button class="v6p-primary" data-v6p-action="review-selection" type="button">Revisar lista con ${selectedCount}</button>
      </div>
    ` : ''}

    <div class="v6p-backdrop" id="v6pReviewModal"></div>
    <div class="v6p-backdrop" id="v6pManualModal"></div>
    <div class="v6p-backdrop" id="v6pListModal"></div>
    <div class="v6p-backdrop" id="v6pPrintModal"></div>
  `;
}

function renderReplenish({ visibleRows, manualRows, drafts, productsById, query, filter }) {
  return `
    <div class="v6p-toolbar">
      <label class="v6p-search">⌕<input id="v6pSearch" value="${esc(query)}" placeholder="Buscar producto, SAINT o SKU…" autocomplete="off"></label>
      <select id="v6pFilter" class="v6p-filter">
        <option value="ALL" ${filter === 'ALL' ? 'selected' : ''}>Todos</option>
        <option value="CRITICAL" ${filter === 'CRITICAL' ? 'selected' : ''}>Críticos</option>
        <option value="LOW" ${filter === 'LOW' ? 'selected' : ''}>Bajos</option>
      </select>
    </div>

    <div class="v6p-section-head">
      <div><h3>Lo que VIGÍA recomienda hoy</h3><p>Marca lo que vas a resolver. Puedes cambiar cantidad, Comprar/Pedir y agregar una observación por producto.</p></div>
      <div class="v6p-bulk-actions">
        <button class="v6p-ghost" data-v6p-action="prepare-visible" type="button">✨ Preparar sugeridos</button>
        <button class="v6p-ghost" data-v6p-action="select-visible" type="button">Seleccionar visibles</button>
        <button class="v6p-ghost" data-v6p-action="clear-selection" type="button">Limpiar</button>
      </div>
    </div>

    <div class="v6p-products">
      ${visibleRows.length ? visibleRows.map(row => productRow(row, drafts.get(row.productId), productsById.get(row.productId))).join('') : '<div class="v6p-empty">No hay productos para este filtro.</div>'}
    </div>

    ${manualRows.length ? `
      <div class="v6p-section-head v6p-manual-heading"><div><h3>Agregados manualmente</h3><p>Productos que tú decidiste incluir aunque VIGÍA no los recomendó.</p></div></div>
      <div class="v6p-products">${manualRows.map(row => productRow(row, drafts.get(row.productId), productsById.get(row.productId))).join('')}</div>
    ` : ''}

    <div class="v6p-manual-cta">
      <div><strong>¿Necesitas algo que VIGÍA no recomendó?</strong><p>Busca cualquier producto activo del catálogo y agrégalo manualmente.</p></div>
      <button class="v6p-primary" data-v6p-action="open-manual-product" type="button">＋ Agregar producto manual</button>
    </div>
  `;
}

function productRow(row, draft, product) {
  if (!draft || !product) return '';
  const risk = String(row.riskLevel || 'LOW').toUpperCase();
  const confidence = String(row.consumptionConfidence || '').toUpperCase();
  const details = draft.detailsOpen;
  const noteOpen = draft.noteOpen;
  return `
    <article class="v6p-product ${draft.selected ? 'is-selected' : ''}" data-product-id="${esc(product.id)}" data-risk="${esc(risk)}">
      <input class="v6p-check" data-v6p-field="selected" type="checkbox" ${draft.selected ? 'checked' : ''} aria-label="Seleccionar ${esc(product.name)}">
      <div class="v6p-product-main">
        <strong>${esc(product.name)}</strong>
        <small>${esc(draft.meta)}</small>
        ${draft.note ? `<em>(${esc(draft.note)})</em>` : ''}
        <div class="v6p-pills"><span class="v6p-pill ${risk === 'CRITICAL' ? 'is-critical' : 'is-low'}">${risk === 'CRITICAL' ? 'CRÍTICO' : 'BAJO'}</span>${confidence === 'NONE' || confidence === 'INSUFFICIENT' ? '<span class="v6p-pill">Sin historial</span>' : ''}${draft.manual ? '<span class="v6p-pill is-manual">Manual</span>' : ''}</div>
      </div>
      <div class="v6p-suggest"><small>VIGÍA sugiere</small><strong>${esc(draft.suggestedBaseText)}</strong><span>${esc(draft.suggestedHumanText)}</span></div>
      <div class="v6p-quantity"><small>Yo quiero</small><div><button data-v6p-action="step-qty" data-step="-1" type="button">−</button><input data-v6p-field="displayQuantity" value="${esc(draft.displayQuantity)}" inputmode="decimal"><button data-v6p-action="step-qty" data-step="1" type="button">+</button><select data-v6p-field="displayUnit">${draft.unitOptionsHtml}</select></div></div>
      <div class="v6p-method"><small>Voy a</small><select data-v6p-field="method"><option value="PURCHASE" ${draft.method === 'PURCHASE' ? 'selected' : ''}>COMPRAR</option><option value="ORDER" ${draft.method === 'ORDER' ? 'selected' : ''}>PEDIR</option></select></div>
      <div class="v6p-row-actions"><button data-v6p-action="toggle-details" type="button">${details ? 'Ocultar detalles' : 'Ver detalles'}</button><button data-v6p-action="toggle-note" type="button">📝 Nota</button></div>
      <div class="v6p-details ${details ? 'is-open' : ''}">${metric('Stock', draft.stockText)}${metric('En camino', draft.pendingText)}${metric('Objetivo', draft.targetText)}${metric('Mínimo', draft.minText)}${metric('Máximo', draft.maxText)}</div>
      <div class="v6p-note-editor ${noteOpen ? 'is-open' : ''}"><input data-v6p-field="note" value="${esc(draft.note)}" maxlength="180" placeholder="Ej. verdes para guasacaca"><span>Esta nota aparecerá debajo del producto en la lista y ticket.</span></div>
    </article>
  `;
}

function renderLists(lists) {
  return `
    <div class="v6p-section-head"><div><h3>Mis listas</h3><p>Compras y Pedidos quedan separados desde el momento de confirmar.</p></div><span class="v6p-pill">${lists.length}</span></div>
    <div class="v6p-list-grid">
      ${lists.length ? lists.map(listCard).join('') : '<div class="v6p-empty">Todavía no hay listas.</div>'}
    </div>
  `;
}

function listCard(list) {
  const active = list.activeItems || [];
  const categories = new Set(active.map(procurementCategoryOf));
  const extras = active.filter(isProcurementExtra).length;
  return `
    <article class="v6p-list-card">
      <div class="v6p-list-head"><div><strong>${esc(list.code)}</strong><small>${esc(list.dateLabel)} · ${active.length} producto(s) · ${categories.size} categoría(s)</small></div><span class="v6p-status">${esc(list.statusLabel)}</span></div>
      <div class="v6p-list-summary"><div><small>Tipo</small><strong>${list.kind === 'ORDER' ? 'PEDIDO' : 'COMPRA'}</strong></div><div><small>Extras</small><strong>${extras}</strong></div><div><small>Almacenista</small><strong>${esc(list.ownerLabel || 'Usuario VIGÍA')}</strong></div></div>
      <div class="v6p-list-actions"><button class="v6p-ghost" data-v6p-action="open-list" data-list-id="${esc(list.id)}" type="button">Abrir lista</button><button class="v6p-primary" data-v6p-action="open-print" data-list-id="${esc(list.id)}" type="button">👁 Vista 80mm</button></div>
    </article>
  `;
}

function renderExtras(extras) {
  return `
    <div class="v6p-section-head"><div><h3>Extras</h3><p>Fuera del catálogo. Sí salen en listas y tickets; nunca crean stock.</p></div></div>
    <div class="v6p-extra-grid">
      <form class="v6p-extra-form" id="v6pExtraForm">
        <label>Descripción *<input name="description" required placeholder="Ej. Teipe eléctrico negro"></label>
        <div><label>Cantidad *<input name="quantity" required inputmode="decimal" placeholder="3"></label><label>Unidad<select name="unit"><option>UND</option><option>CAJA</option><option>PAQ</option><option>KG</option><option>LT</option><option>BULTO</option><option>SACO</option><option>M</option><option>OTRO</option></select></label></div>
        <label>Va como<select name="method"><option value="PURCHASE">COMPRAR</option><option value="ORDER">PEDIR</option></select></label>
        <label>Observación<input name="notes" maxlength="180" placeholder="Ej. Para reparación"></label>
        <button class="v6p-primary" data-v6p-action="add-extra" type="submit">＋ Agregar extra</button>
      </form>
      <section class="v6p-extra-pending"><div class="v6p-section-head"><div><h3>Extras pendientes</h3><p>Entrarán en la próxima lista que confirmes.</p></div><span class="v6p-pill is-manual">${extras.length}</span></div>${extras.length ? extras.map(extra => `<div class="v6p-extra-row" data-extra-id="${esc(extra.id)}"><div><strong>${esc(extra.description)}</strong><small>${esc(extra.notes || '')}</small></div><span>${esc(extra.displayQuantity)} ${esc(extra.unit)} · ${extra.method === 'ORDER' ? 'PEDIR' : 'COMPRAR'}</span><button data-v6p-action="remove-extra" type="button">×</button></div>`).join('') : '<div class="v6p-empty">Sin extras pendientes.</div>'}</section>
    </div>
  `;
}

export function renderReviewModal(model) {
  const { buyDrafts, orderDrafts, buyExtras, orderExtras, productName } = model;
  return modal(`
    <div class="v6p-modal-head"><div><div class="v6p-eyebrow">REVISIÓN FINAL</div><h3>Así quedarán tus listas</h3><p>Nada se registra todavía. Compras y Pedidos se crearán por separado.</p></div><button class="v6p-ghost" data-v6p-action="close-review" type="button">Cerrar</button></div>
    <div class="v6p-modal-body"><div class="v6p-review-groups">${reviewGroup('🛒 Comprar', buyDrafts, buyExtras, productName)}${reviewGroup('📦 Pedir', orderDrafts, orderExtras, productName)}</div><div class="v6p-review-actions"><button class="v6p-ghost" data-v6p-action="close-review" type="button">Seguir editando</button><button class="v6p-primary" data-v6p-action="confirm-lists" type="button">Crear listas separadas</button></div></div>
  `, 'v6p-review-modal');
}

function reviewGroup(title, drafts, extras, productName) {
  const rows = drafts.map(d => `<div class="v6p-review-item"><div><strong>${esc(productName(d.productId))}</strong>${d.note ? `<small>(${esc(d.note)})</small>` : ''}</div><strong>${esc(d.displayQuantity)} ${esc(d.displayUnit)}</strong></div>`).join('') + extras.map(e => `<div class="v6p-review-item"><div><strong>${esc(e.description)}</strong>${e.notes ? `<small>(${esc(e.notes)})</small>` : ''}<small>EXTRA</small></div><strong>${esc(e.displayQuantity)} ${esc(e.unit)}</strong></div>`).join('');
  return `<section class="v6p-review-group"><h4>${title}</h4>${rows || '<div class="v6p-empty">Nada en esta lista.</div>'}</section>`;
}

export function renderManualModal(model) {
  const { selected, results, selectedDraft } = model;
  return modal(`
    <div class="v6p-modal-head"><div><div class="v6p-eyebrow">DECISIÓN HUMANA</div><h3>Agregar producto manual</h3><p>Incluye cualquier producto activo aunque VIGÍA no lo haya recomendado.</p></div><button class="v6p-ghost" data-v6p-action="close-manual" type="button">Cerrar</button></div>
    <div class="v6p-modal-body"><label class="v6p-modal-search">Buscar producto<input id="v6pManualSearch" autocomplete="off" placeholder="Nombre, SAINT o SKU…"></label><div class="v6p-manual-results">${results.map(p => `<button data-v6p-action="choose-manual-product" data-product-id="${esc(p.id)}" type="button"><span><strong>${esc(p.name)}</strong><small>${esc([p.saintCode ? 'SAINT '+p.saintCode : '', p.sku ? 'SKU '+p.sku : ''].filter(Boolean).join(' · '))}</small></span><span>Agregar →</span></button>`).join('')}</div>${selected && selectedDraft ? `<div class="v6p-manual-selected"><strong>${esc(selected.name)}</strong><div class="v6p-manual-fields"><label>Cantidad<input id="v6pManualQty" value="${esc(selectedDraft.displayQuantity)}" inputmode="decimal"></label><label>Unidad<select id="v6pManualUnit">${selectedDraft.unitOptionsHtml}</select></label><label>Voy a<select id="v6pManualMethod"><option value="PURCHASE" ${selectedDraft.method === 'PURCHASE' ? 'selected' : ''}>COMPRAR</option><option value="ORDER" ${selectedDraft.method === 'ORDER' ? 'selected' : ''}>PEDIR</option></select></label><label class="is-wide">Observación<input id="v6pManualNote" maxlength="180" value="${esc(selectedDraft.note || '')}" placeholder="Ej. verdes para guasacaca"></label></div><button class="v6p-primary" data-v6p-action="confirm-manual-product" type="button">＋ Agregar a la lista</button></div>` : ''}</div>
  `, 'v6p-manual-modal');
}

export function renderListModal(model) {
  const { list } = model;
  const editable = list.status === 'DRAFT';
  return modal(`
    <div class="v6p-modal-head"><div><div class="v6p-eyebrow">${list.kind === 'ORDER' ? 'PEDIDO' : 'COMPRA'}</div><h3>${esc(list.code)}</h3><p>${esc(list.dateLabel)} · ${esc(list.ownerLabel || 'Usuario VIGÍA')}</p></div><button class="v6p-ghost" data-v6p-action="close-list" type="button">Cerrar</button></div>
    <div class="v6p-modal-body"><div class="v6p-list-lines">${list.items.map(item => listLine(item, editable)).join('')}</div><div class="v6p-review-actions">${editable ? '<button class="v6p-primary" data-v6p-action="save-list-edits" type="button">Guardar cambios</button>' : ''}<button class="v6p-ghost" data-v6p-action="open-print" data-list-id="${esc(list.id)}" type="button">👁 Vista 80mm</button>${list.status === 'DRAFT' ? `<button class="v6p-primary" data-v6p-action="list-ordered" data-list-id="${esc(list.id)}" type="button">Marcar realizada</button>` : ''}${list.status === 'ORDERED' ? `<button class="v6p-primary" data-v6p-action="list-transit" data-list-id="${esc(list.id)}" type="button">Marcar en camino</button>` : ''}</div></div>
  `, 'v6p-list-modal');
}

function listLine(item, editable) {
  const display = procurementDisplayQuantity(item);
  const receipt = renderReceiptAction(item);
  return `<div class="v6p-list-line" data-line-id="${esc(item.id)}"><div><strong>${esc(item.productName || item.productId)}</strong><small>${esc(procurementCategoryOf(item))}${item.notes ? ` · (${esc(item.notes)})` : ''}${isProcurementExtra(item) ? ' · EXTRA' : ''}</small></div>${editable ? `<input data-list-field="quantity" value="${esc(display.quantity)}" inputmode="decimal"><span>${esc(display.unit)}</span><input data-list-field="note" value="${esc(item.notes || '')}" maxlength="180"><button class="v6p-danger" data-v6p-action="cancel-list-line" type="button">Quitar</button>` : `<strong>${esc(display.quantity)} ${esc(display.unit)}</strong>${receipt}`}</div>`;
}

function renderReceiptAction(item) {
  if (item.status === 'CANCELLED' || item.status === 'RECEIVED') return `<span class="v6p-status">${esc(item.status)}</span>`;
  if (isProcurementExtra(item)) return `<button class="v6p-success v6p-line-action" data-v6p-action="complete-extra-line" data-line-id="${esc(item.id)}" type="button">✓ Listo</button>`;
  if (['ORDERED','IN_TRANSIT','PARTIALLY_RECEIVED'].includes(item.status)) return `<button class="v6p-success v6p-line-action" data-v6p-action="receive-list-line" data-line-id="${esc(item.id)}" type="button">↓ Recibir</button>`;
  return '<span class="v6p-status">BORRADOR</span>';
}

function tab(value, label, active) { return `<button class="v6p-tab ${active === value ? 'is-active' : ''}" data-v6p-action="switch-tab" data-tab="${value}" type="button">${label}</button>`; }
function metric(label, value) { return `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }
function modal(inner, className) { return `<div class="v6p-modal ${className}">${inner}</div>`; }
export function esc(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
