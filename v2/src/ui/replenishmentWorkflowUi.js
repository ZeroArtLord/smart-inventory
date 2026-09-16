import { evaluateNumericExpression } from '../core/mathExpression.js';
import { searchProducts } from '../catalog/catalogService.js';
import { catalogUnitCode } from '../catalog/catalogUi.js';
import { STORES, getAll } from '../storage/database.js';
import { buildInventoryReport } from '../reporting/reportingEngine.js';
import {
  calculatePendingInboundByProduct,
  listReplenishments,
  REPLENISHMENT_STATUS
} from '../replenishment/replenishmentService.js';
import {
  createManualProductProcurement,
  createProcurementExtra,
  completeProcurementExtra,
  cancelProcurementExtra,
  isProcurementExtra,
  procurementExtraUnit
} from '../replenishment/warehouseProcurementService.js';
import { getCurrentSession } from '../admin/adminClient.js';

const state = {
  selectedProduct: null,
  selectedMetrics: null,
  results: [],
  enhancing: false
};

const ACTIVE_STATUSES = new Set([
  REPLENISHMENT_STATUS.DRAFT,
  REPLENISHMENT_STATUS.ORDERED,
  REPLENISHMENT_STATUS.IN_TRANSIT,
  REPLENISHMENT_STATUS.PARTIALLY_RECEIVED
]);

const app = document.getElementById('app');

if (app) {
  const observer = new MutationObserver(() => {
    queueMicrotask(() => enhanceReplenishmentWorkspace().catch(() => {}));
  });

  observer.observe(app, {
    childList: true,
    subtree: true
  });

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('input', handleDocumentInput);

  enhanceReplenishmentWorkspace().catch(() => {});
}

async function enhanceReplenishmentWorkspace() {
  if (state.enhancing || !isReplenishmentView()) return;

  state.enhancing = true;
  try {
    let root = document.getElementById('v5ProcurementManual');

    // Si el panel ya existe no lo volvemos a pintar desde el observer.
    // Eso evita un ciclo MutationObserver -> innerHTML -> MutationObserver.
    if (root) {
      await patchExtraCards();
      return;
    }

    const layout = app.querySelector('.replenish-layout-v2');
    if (!layout) return;

    root = document.createElement('section');
    root.id = 'v5ProcurementManual';
    root.className = 'card v5-procurement-manual';
    layout.prepend(root);

    await renderManualPanel(root);
    await patchExtraCards();
  } finally {
    state.enhancing = false;
  }
}

function isReplenishmentView() {
  const heading = app?.querySelector('h2');
  return Boolean(
    heading &&
    String(heading.textContent || '').trim().toLowerCase() === 'comprar / pedir'
  );
}

async function renderManualPanel(root) {
  const items = await listReplenishments();
  const active = items.filter(item => ACTIVE_STATUSES.has(item.status));
  const extras = active.filter(isProcurementExtra);
  const products = active.filter(item => !isProcurementExtra(item));
  const selected = state.selectedProduct;
  const metrics = state.selectedMetrics;

  root.innerHTML = `
    <div class="v5-procurement-head">
      <div>
        <div class="product-meta v5-eyebrow">V5 · DECISIÓN HUMANA</div>
        <h3>Agregar compra o pedido manual</h3>
        <p>VIGÍA recomienda; tú decides. Puedes agregar cualquier producto aunque la sugerencia sea 0.</p>
      </div>
      <div class="v5-procurement-badges">
        <span class="badge">${products.length} producto(s) activos</span>
        <span class="badge status-warning">${extras.length} extra(s)</span>
      </div>
    </div>

    <div class="v5-procurement-grid">
      <div class="v5-manual-product-panel">
        <label class="v5-field">
          <span>Buscar producto del catálogo</span>
          <input id="v5ProcurementSearch" autocomplete="off" placeholder="Arroz, Código SAINT, SKU…">
        </label>

        <div id="v5ProcurementResults" class="v5-procurement-results">
          ${renderSearchResults()}
        </div>

        ${selected ? `
          <article class="v5-selected-product">
            <div>
              <strong>${escapeHtml(selected.name)}</strong>
              <small>
                ${selected.saintCode ? 'SAINT ' + escapeHtml(selected.saintCode) + ' · ' : ''}
                ${selected.sku ? 'SKU ' + escapeHtml(selected.sku) : ''}
              </small>
            </div>
            <button class="ghost-button" data-v5-action="clear-product" type="button">Cambiar</button>
          </article>

          <div class="v5-decision-metrics">
            <div><small>Stock</small><strong>${formatNumber(metrics?.stock ?? 0)} ${escapeHtml(catalogUnitCode(selected))}</strong></div>
            <div><small>En camino</small><strong>${formatNumber(metrics?.pendingInbound ?? 0)}</strong></div>
            <div class="v5-vigia-suggestion"><small>VIGÍA sugiere</small><strong>${formatNumber(metrics?.suggestedQuantity ?? 0)}</strong></div>
            <div><small>Objetivo</small><strong>${formatNumber(metrics?.vigiaTargetStock ?? metrics?.targetStock ?? selected.maxStock ?? 0)}</strong></div>
          </div>

          <div class="v5-manual-fields">
            <label class="v5-field">
              <span>Yo voy a</span>
              <select id="v5ProcurementMethod">
                <option value="PURCHASE">COMPRAR</option>
                <option value="ORDER">PEDIR</option>
              </select>
            </label>

            <label class="v5-field">
              <span>Cantidad</span>
              <input
                id="v5ProcurementQuantity"
                inputmode="decimal"
                autocomplete="off"
                placeholder="Ej. 100 o 50+50"
                value="${metrics?.suggestedQuantity > 0 ? escapeHtml(String(metrics.suggestedQuantity)) : ''}"
              >
            </label>

            <label class="v5-field v5-field-wide">
              <span>Motivo / nota opcional</span>
              <input id="v5ProcurementReason" autocomplete="off" placeholder="Ej. Evento especial de 100 personas">
            </label>
          </div>

          <button class="primary v5-add-manual" data-v5-action="add-manual-product" type="button">
            ＋ Agregar a Comprar / Pedir
          </button>

          <div class="product-meta v5-manual-note">
            Esta decisión NO altera stock y NO enseña demanda. El stock cambia cuando recibes mercancía; la demanda aprende de surtidos reales.
          </div>
        ` : `
          <div class="v5-empty-selection">
            <strong>Selecciona un producto</strong>
            <span>La recomendación de VIGÍA aparecerá como referencia, nunca como obligación.</span>
          </div>
        `}
      </div>

      <form id="v5ExtraForm" class="v5-extra-panel">
        <div>
          <div class="product-meta v5-eyebrow">FUERA DE CATÁLOGO</div>
          <h4>Compra X / Extra</h4>
          <p>Para teipe, bombillos, herramientas o cualquier cosa que no pertenece al inventario.</p>
        </div>

        <label class="v5-field">
          <span>Descripción *</span>
          <input name="description" required autocomplete="off" placeholder="Ej. Teipe eléctrico negro">
        </label>

        <div class="v5-extra-row">
          <label class="v5-field">
            <span>Cantidad *</span>
            <input name="quantity" required inputmode="decimal" autocomplete="off" placeholder="3">
          </label>
          <label class="v5-field">
            <span>Unidad</span>
            <select name="unit">
              <option>UND</option>
              <option>CAJA</option>
              <option>PAQ</option>
              <option>KG</option>
              <option>LT</option>
              <option>BULTO</option>
              <option>SACO</option>
              <option>M</option>
              <option>OTRO</option>
            </select>
          </label>
        </div>

        <label class="v5-field">
          <span>Nota opcional</span>
          <input name="notes" autocomplete="off" placeholder="Ej. Para reparación de iluminación">
        </label>

        <button class="secondary v5-add-extra" data-v5-action="add-extra" type="submit">＋ Agregar extra</button>

        <div class="v5-extra-safety">
          <strong>Separado del inventario.</strong>
          No crea Código SAINT, no modifica stock y no participa en el aprendizaje de VIGÍA.
        </div>
      </form>
    </div>

    ${active.length ? `
      <div class="v5-active-summary">
        <strong>Lista operativa activa</strong>
        <span>${active.length} renglón(es): ${products.length} del catálogo + ${extras.length} extra(s).</span>
      </div>
    ` : ''}
  `;
}

async function handleDocumentInput(event) {
  if (event.target.id !== 'v5ProcurementSearch') return;

  try {
    const query = String(event.target.value || '').trim();
    state.results = query.length >= 2
      ? await searchProducts(query, { limit: 8 })
      : [];

    const container = document.getElementById('v5ProcurementResults');
    if (container) container.innerHTML = renderSearchResults();
  } catch (error) {
    toast(error.message || String(error));
  }
}

async function handleDocumentClick(event) {
  try {
    const productButton = event.target.closest('[data-v5-product-id]');
    if (productButton) {
      event.preventDefault();
      const productId = productButton.dataset.v5ProductId;
      const products = await getAll(STORES.PRODUCTS);
      state.selectedProduct = products.find(item => item.id === productId) || null;
      state.selectedMetrics = state.selectedProduct
        ? await loadProductMetrics(state.selectedProduct.id)
        : null;
      state.results = [];

      const root = document.getElementById('v5ProcurementManual');
      if (root) await renderManualPanel(root);
      return;
    }

    const actionButton = event.target.closest('[data-v5-action]');
    if (!actionButton) return;

    const action = actionButton.dataset.v5Action;

    if (action === 'clear-product') {
      state.selectedProduct = null;
      state.selectedMetrics = null;
      state.results = [];
      const root = document.getElementById('v5ProcurementManual');
      if (root) await renderManualPanel(root);
      return;
    }

    if (action === 'add-manual-product') {
      event.preventDefault();
      await addManualProduct();
      return;
    }

    if (action === 'add-extra') {
      event.preventDefault();
      await addExtra();
      return;
    }

    if (action === 'complete-extra') {
      event.preventDefault();
      await completeProcurementExtra(actionButton.dataset.id, {
        userId: await currentUserId()
      });
      toast('Extra marcado como comprado');
      refreshReplenishmentView();
      return;
    }

    if (action === 'cancel-extra') {
      event.preventDefault();
      if (!confirm('¿Cancelar este extra de la lista de compras?')) return;
      await cancelProcurementExtra(actionButton.dataset.id, {
        userId: await currentUserId()
      });
      toast('Extra cancelado');
      refreshReplenishmentView();
    }
  } catch (error) {
    toast(error.message || String(error));
  }
}

async function addManualProduct() {
  try {
    if (!state.selectedProduct) throw new Error('Selecciona un producto');

    const quantity = evaluateNumericExpression(
      document.getElementById('v5ProcurementQuantity')?.value || ''
    );
    if (!(quantity > 0)) throw new Error('La cantidad debe ser mayor que cero');

    const method = document.getElementById('v5ProcurementMethod')?.value;
    const reason = String(
      document.getElementById('v5ProcurementReason')?.value || ''
    ).trim();
    const metrics = state.selectedMetrics || {};

    await createManualProductProcurement({
      productId: state.selectedProduct.id,
      method,
      requestedQuantity: quantity,
      reason,
      notes: reason,
      ownerId: await currentUserId(),
      vigiaSuggestedQuantity: metrics.suggestedQuantity ?? 0,
      stockAtDecision: metrics.stock ?? 0,
      pendingInboundAtDecision: metrics.pendingInbound ?? 0
    });

    toast(`${method === 'PURCHASE' ? 'Compra' : 'Pedido'} agregado: ${state.selectedProduct.name}`);
    state.selectedProduct = null;
    state.selectedMetrics = null;
    state.results = [];
    refreshReplenishmentView();
  } catch (error) {
    toast(error.message || String(error));
  }
}

async function addExtra() {
  const form = document.getElementById('v5ExtraForm');
  if (!form) return;

  try {
    const data = new FormData(form);
    const quantity = evaluateNumericExpression(data.get('quantity'));
    if (!(quantity > 0)) throw new Error('La cantidad debe ser mayor que cero');

    await createProcurementExtra({
      description: data.get('description'),
      requestedQuantity: quantity,
      unit: data.get('unit'),
      notes: data.get('notes'),
      ownerId: await currentUserId()
    });

    toast('Extra agregado a la lista');
    form.reset();
    refreshReplenishmentView();
  } catch (error) {
    toast(error.message || String(error));
  }
}

async function loadProductMetrics(productId) {
  const [products, movements, replenishments] = await Promise.all([
    getAll(STORES.PRODUCTS),
    getAll(STORES.MOVEMENTS),
    getAll(STORES.REPLENISHMENTS)
  ]);

  const pendingInboundByProduct = calculatePendingInboundByProduct(
    replenishments.filter(item => !isProcurementExtra(item))
  );
  const rows = buildInventoryReport(products, movements, {
    now: new Date(),
    pendingInboundByProduct
  });

  return rows.find(row => row.productId === productId) || {
    stock: 0,
    pendingInbound: 0,
    suggestedQuantity: 0
  };
}

async function patchExtraCards() {
  if (!isReplenishmentView()) return;

  const extras = (await listReplenishments()).filter(isProcurementExtra);
  if (!extras.length) return;

  for (const extra of extras) {
    const button = app.querySelector(
      `.replenishment-card button[data-id="${cssEscape(extra.id)}"]`
    );
    let card = button?.closest('.replenishment-card') || null;

    if (!card) {
      card = [...app.querySelectorAll('.replenishment-card')].find(candidate => {
        const strong = candidate.querySelector('.replenishment-card-head-v2 strong');
        return strong?.textContent?.trim() === extra.productName;
      }) || null;
    }

    if (!card) continue;
    card.classList.add('v5-extra-card');

    const head = card.querySelector('.replenishment-card-head-v2 > div');
    if (head && !head.querySelector('.v5-extra-chip')) {
      const chip = document.createElement('span');
      chip.className = 'v5-extra-chip';
      chip.textContent = `EXTRA · ${procurementExtraUnit(extra)}`;
      head.appendChild(chip);
    }

    const actions = card.querySelector('.replenishment-buttons');
    if (
      actions &&
      ![
        REPLENISHMENT_STATUS.RECEIVED,
        REPLENISHMENT_STATUS.CANCELLED
      ].includes(extra.status) &&
      actions.dataset.v5ExtraPatched !== extra.id
    ) {
      actions.dataset.v5ExtraPatched = extra.id;
      actions.innerHTML = `
        <button class="success" data-v5-action="complete-extra" data-id="${escapeHtml(extra.id)}" type="button">✓ Comprado</button>
        <button class="danger" data-v5-action="cancel-extra" data-id="${escapeHtml(extra.id)}" type="button">Cancelar extra</button>
      `;
    }
  }
}

function renderSearchResults() {
  if (!state.results.length) return '';

  return state.results.map(product => `
    <button class="v5-procurement-result" data-v5-product-id="${escapeHtml(product.id)}" type="button">
      <span>
        <strong>${escapeHtml(product.name)}</strong>
        <small>
          ${product.saintCode ? 'SAINT ' + escapeHtml(product.saintCode) + ' · ' : ''}
          ${product.sku ? 'SKU ' + escapeHtml(product.sku) : ''}
        </small>
      </span>
      <span>Agregar →</span>
    </button>
  `).join('');
}

async function currentUserId() {
  try {
    const session = await getCurrentSession();
    return session?.userId || null;
  } catch (_) {
    return null;
  }
}

function refreshReplenishmentView() {
  const button = document.querySelector('.app-nav [data-view="replenishment"]');
  if (button) {
    button.click();
    return;
  }
  window.location.reload();
}

function toast(message) {
  const saveStatus = document.getElementById('saveStatus');
  if (saveStatus) saveStatus.textContent = String(message || 'Listo');

  const node = document.createElement('div');
  node.className = 'v5-toast';
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 3
  }).format(number);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
