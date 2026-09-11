import { evaluateNumericExpression } from '../core/mathExpression.js';
import {
  STORES,
  get,
  getAll
} from '../storage/database.js';
import {
  saveDocumentLine,
  listDocumentLines
} from '../documents/documentService.js';
import {
  buildCountCategoryProgress,
  buildCountOverallProgress,
  countPendingProducts,
  selectNextCountProduct,
  COUNT_WORKFLOW_MODES
} from '../documents/countWorkflow.js';
import {
  clearCountProductPending,
  getCountWorkflow,
  markCountProductPending,
  updateCountWorkflow
} from '../documents/countWorkflowService.js';

const appRoot = document.getElementById('app');
const STYLE_ID = 'vigia-v5-count-styles';
let rendering = false;

installStyles();

const observer = new MutationObserver(() => {
  queueMicrotask(() => {
    enhanceCurrentCount().catch(error =>
      console.error('V5-A count enhancer:', error)
    );
  });
});

if (appRoot) {
  observer.observe(appRoot, {
    childList: true,
    subtree: true
  });

  appRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-v5-count-action]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    handleV5CountAction(button)
      .catch(error => showLocalError(error));
  });

  appRoot.addEventListener('keydown', event => {
    if (
      event.key === 'Enter' &&
      event.target?.id === 'v5CountValue'
    ) {
      event.preventDefault();
      const button = appRoot.querySelector(
        '[data-v5-count-action="save"]'
      );
      if (button) {
        handleV5CountAction(button)
          .catch(error => showLocalError(error));
      }
    }
  });

  appRoot.addEventListener('input', event => {
    if (event.target?.id !== 'v5CountSearch') return;
    filterJumpRows(event.target.value);
  });
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .v5-count-shell{display:grid;gap:16px}
    .v5-count-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
    .v5-count-toolbar-actions{display:flex;gap:8px;flex-wrap:wrap}
    .v5-count-category-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
    .v5-count-category{border:1px solid var(--border);background:var(--surface,#fff);border-radius:14px;padding:16px;text-align:left;display:grid;gap:9px;cursor:pointer}
    .v5-count-category:hover{border-color:var(--accent);transform:translateY(-1px)}
    .v5-count-category-head{display:flex;justify-content:space-between;gap:10px;align-items:center}
    .v5-count-category strong{font-size:15px}
    .v5-count-category small{color:var(--muted,#64748b)}
    .v5-count-mini-track{height:7px;border-radius:999px;background:#e5e7eb;overflow:hidden}
    .v5-count-mini-track span{display:block;height:100%;background:var(--accent);border-radius:999px}
    .v5-count-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .v5-count-kpi{padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface,#fff)}
    .v5-count-kpi small{display:block;color:var(--muted,#64748b)}
    .v5-count-kpi strong{font-size:20px}
    .v5-count-product-card{border:1px solid var(--border);border-radius:16px;padding:18px;background:var(--surface,#fff);display:grid;gap:15px}
    .v5-count-product-card.v5-count-editing{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 16%,transparent)}
    .v5-count-product-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .v5-count-product-head h2{margin:3px 0}
    .v5-count-input{font-size:30px!important;font-weight:800;text-align:center;min-height:64px}
    .v5-count-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .v5-count-pending-button{position:relative}
    .v5-count-pending-list{display:grid;gap:8px}
    .v5-count-pending-row,.v5-count-jump-row,.v5-count-recent-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
    .v5-count-jump-row[data-counted="true"]{background:color-mix(in srgb,var(--accent) 5%,var(--surface,#fff))}
    .v5-count-search{width:100%;margin-top:4px}
    .v5-count-jump-list{display:grid;gap:6px;max-height:250px;overflow:auto;margin-top:8px}
    .v5-count-section-title{display:flex;justify-content:space-between;gap:10px;align-items:center}
    .v5-count-edit-note{display:grid;gap:4px;padding:12px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:12px;background:color-mix(in srgb,var(--accent) 6%,var(--surface,#fff))}
    .v5-count-review{margin-top:12px;border-top:1px solid var(--border);padding-top:12px}
    .v5-count-review summary{cursor:pointer;font-weight:800}
    .v5-count-review-list{display:grid;gap:6px;margin-top:10px}
    @media(max-width:760px){
      .v5-count-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v5-count-actions{grid-template-columns:1fr}
      .v5-count-category-grid{grid-template-columns:1fr 1fr}
    }
    @media(max-width:430px){.v5-count-category-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

async function enhanceCurrentCount() {
  if (!appRoot || rendering) return;
  if (!appRoot.querySelector('.count-page-head')) return;
  if (appRoot.querySelector('.v5-count-shell')) return;

  const idFromOldUi = appRoot.querySelector(
    '.count-progress-card .section-head p'
  )?.textContent?.trim();
  const documentId =
    idFromOldUi ||
    appRoot.dataset.v5CountDocumentId ||
    '';

  if (!documentId) return;

  const documentRecord = await get(
    STORES.DOCUMENTS,
    documentId
  );

  if (
    !documentRecord ||
    documentRecord.type !== 'COUNT' ||
    documentRecord.status !== 'DRAFT'
  ) {
    return;
  }

  appRoot.dataset.v5CountDocumentId = documentId;
  await renderV5Count(documentId);
}

async function renderV5Count(documentId) {
  if (rendering) return;
  rendering = true;

  try {
    const root = appRoot.querySelector('.count-workspace-v2');
    if (!root) return;

    const [documentRecord, products, categories, lines] = await Promise.all([
      get(STORES.DOCUMENTS, documentId),
      getAll(STORES.PRODUCTS),
      getAll(STORES.CATEGORIES),
      listDocumentLines(documentId)
    ]);

    if (!documentRecord || documentRecord.status !== 'DRAFT') return;

    const activeProducts = products.filter(product =>
      product && product.active !== false
    );
    const workflow = getCountWorkflow(documentRecord);
    const overall = buildCountOverallProgress({
      products: activeProducts,
      lines,
      metadata: documentRecord.metadata
    });
    const categoryProgress = buildCountCategoryProgress({
      products: activeProducts,
      categories,
      lines,
      metadata: documentRecord.metadata
    });
    const pendingProducts = countPendingProducts({
      products: activeProducts,
      lines,
      metadata: documentRecord.metadata
    });
    const lastCountedLine = lines.length
      ? lines[lines.length - 1]
      : null;
    const lastCountedProduct = lastCountedLine
      ? activeProducts.find(product => product.id === lastCountedLine.productId) || null
      : null;

    root.innerHTML = `
      <section class="v5-count-shell">
        ${renderOverallHeader(
          overall,
          workflow,
          pendingProducts.length,
          lastCountedProduct,
          lastCountedLine
        )}
        ${workflow.mode === COUNT_WORKFLOW_MODES.PENDING
          ? renderPendingWorkspace({
              documentId,
              products: activeProducts,
              lines,
              documentRecord,
              pendingProducts,
              overall
            })
          : workflow.activeCategoryId
            ? renderCategoryWorkspace({
                documentId,
                products: activeProducts,
                categories,
                lines,
                documentRecord,
                categoryProgress,
                overall
              })
            : renderCategoryHub({
                categoryProgress,
                overall,
                pendingProducts
              })}
      </section>
    `;

    requestAnimationFrame(() => {
      const input = document.getElementById('v5CountValue');
      input?.focus();
      if (input?.dataset.editing === 'true') {
        input.select();
      }
    });
  } finally {
    rendering = false;
  }
}

function renderOverallHeader(
  overall,
  workflow,
  pendingCount,
  lastCountedProduct,
  lastCountedLine
) {
  return `
    <article class="card v5-count-shell-head">
      <div class="v5-count-toolbar">
        <div>
          <div class="product-meta" style="font-weight:800;color:var(--accent)">V5 · CONTEO OPERATIVO</div>
          <h3 style="margin:3px 0">Conteo físico por categoría</h3>
          <div class="product-meta">Puedes cambiar de categoría, corregir cualquier conteo guardado, dejar productos pendientes y continuar después.</div>
        </div>
        <div class="v5-count-toolbar-actions">
          ${lastCountedProduct && lastCountedLine ? `
            <button
              class="secondary"
              data-v5-count-action="edit-last"
              data-product-id="${escapeHtml(lastCountedProduct.id)}"
              data-category-id="${escapeHtml(lastCountedProduct.categoryId || '__UNCATEGORIZED__')}"
              type="button"
            >↶ Corregir último · ${escapeHtml(String(lastCountedLine.countedStock))}</button>
          ` : ''}
          ${workflow.activeCategoryId || workflow.mode === COUNT_WORKFLOW_MODES.PENDING
            ? '<button class="secondary" data-v5-count-action="categories" type="button">← Categorías</button>'
            : ''}
          <button class="secondary v5-count-pending-button" data-v5-count-action="pending" type="button">
            Pendientes · ${pendingCount}
          </button>
        </div>
      </div>
      <div class="progress-track count-progress-track" style="margin-top:14px">
        <div style="width:${overall.percent}%"></div>
      </div>
      <div class="v5-count-kpis" style="margin-top:12px">
        <div class="v5-count-kpi"><small>Total</small><strong>${overall.total}</strong></div>
        <div class="v5-count-kpi"><small>Contados</small><strong>${overall.counted}</strong></div>
        <div class="v5-count-kpi"><small>Pendientes</small><strong>${overall.pending}</strong></div>
        <div class="v5-count-kpi"><small>Progreso</small><strong>${overall.percent}%</strong></div>
      </div>
    </article>
  `;
}

function renderCategoryHub({ categoryProgress, overall, pendingProducts }) {
  return `
    <article class="card">
      <div class="v5-count-section-title">
        <div>
          <h3 style="margin:0">Elige qué área contar</h3>
          <div class="product-meta">El progreso de cada categoría queda guardado dentro del mismo conteo.</div>
        </div>
        <span class="badge">${categoryProgress.length} categorías</span>
      </div>

      <div class="v5-count-category-grid" style="margin-top:14px">
        ${categoryProgress.map(row => {
          const percent = row.total
            ? Math.round((row.counted / row.total) * 100)
            : 0;
          return `
            <button
              class="v5-count-category"
              data-v5-count-action="category"
              data-category-id="${escapeHtml(row.categoryId)}"
              type="button"
            >
              <div class="v5-count-category-head">
                <strong>${escapeHtml(row.categoryName)}</strong>
                <span class="badge ${row.complete ? 'status-good' : ''}">${row.counted}/${row.total}</span>
              </div>
              <div class="v5-count-mini-track"><span style="width:${percent}%"></span></div>
              <small>${row.remaining} por recorrer${row.pending ? ` · ${row.pending} pendiente(s)` : ''}</small>
            </button>
          `;
        }).join('')}
      </div>
    </article>

    ${pendingProducts.length ? `
      <article class="card">
        <div class="v5-count-section-title">
          <div>
            <h3 style="margin:0">Pendientes globales</h3>
            <div class="product-meta">Productos saltados: no cuentan como cero ni como contados.</div>
          </div>
          <button class="primary" data-v5-count-action="pending" type="button">Revisar ${pendingProducts.length}</button>
        </div>
      </article>
    ` : ''}

    ${overall.complete ? `
      <article class="card count-finished-card">
        <div class="count-complete-icon">✓</div>
        <h3>Conteo completo</h3>
        <p class="product-meta">Todos los productos activos tienen una existencia física guardada. Puedes corregir cualquier línea antes de cerrar.</p>
        <button class="success count-close-button" data-action="close-document" type="button">Cerrar conteo</button>
      </article>
    ` : ''}
  `;
}

function renderCategoryWorkspace({
  products,
  categories,
  lines,
  documentRecord,
  categoryProgress,
  overall
}) {
  const workflow = getCountWorkflow(documentRecord);
  const selectedCategory = categoryProgress.find(row =>
    row.categoryId === workflow.activeCategoryId
  );

  if (!selectedCategory) {
    return `
      <article class="card">
        <div class="status-warning">La categoría seleccionada ya no existe. Vuelve al selector.</div>
        <button class="primary" data-v5-count-action="categories" type="button">Ver categorías</button>
      </article>
    `;
  }

  const lineByProduct = new Map(
    lines.map(line => [line.productId, line])
  );
  const countedIds = new Set(lineByProduct.keys());
  const pendingIds = new Set(workflow.pendingProductIds);
  const categoryProducts = products.filter(product =>
    (product.categoryId || '__UNCATEGORIZED__') === selectedCategory.categoryId
  );

  const forcedId = appRoot.dataset.v5CountForcedProductId || '';
  let nextProduct = forcedId
    ? categoryProducts.find(product => product.id === forcedId)
    : null;

  if (!nextProduct) {
    delete appRoot.dataset.v5CountForcedProductId;
    nextProduct = selectNextCountProduct({
      products,
      lines,
      metadata: documentRecord.metadata,
      categoryId: selectedCategory.categoryId
    });
  }

  const existingLine = nextProduct
    ? lineByProduct.get(nextProduct.id) || null
    : null;
  const jumpProducts = categoryProducts;
  const recentCounted = lines
    .filter(line => categoryProducts.some(product => product.id === line.productId))
    .slice(-6)
    .reverse();

  return `
    <article class="card">
      <div class="v5-count-section-title">
        <div>
          <div class="product-meta">Área actual</div>
          <h3 style="margin:2px 0">${escapeHtml(selectedCategory.categoryName)}</h3>
          <div class="product-meta">
            ${selectedCategory.counted}/${selectedCategory.total} contados ·
            ${selectedCategory.pending} pendientes ·
            ${selectedCategory.remaining} por recorrer
          </div>
        </div>
        <span class="badge">${selectedCategory.total ? Math.round((selectedCategory.counted / selectedCategory.total) * 100) : 0}%</span>
      </div>

      ${jumpProducts.length ? `
        <label style="display:block;margin-top:12px">
          Buscar o corregir dentro de ${escapeHtml(selectedCategory.categoryName)}
          <input id="v5CountSearch" class="v5-count-search" autocomplete="off" placeholder="Nombre, SAINT o SKU...">
        </label>
        <div class="v5-count-jump-list">
          ${jumpProducts.map(product => {
            const countedLine = lineByProduct.get(product.id) || null;
            const isPending = pendingIds.has(product.id);
            const statusText = countedLine
              ? ` · CONTADO ${escapeHtml(String(countedLine.countedStock))}`
              : isPending
                ? ' · PENDIENTE'
                : ' · SIN CONTAR';
            const actionLabel = countedLine
              ? 'Editar'
              : isPending
                ? 'Contar'
                : 'Ir';

            return `
              <div
                class="v5-count-jump-row"
                data-counted="${countedLine ? 'true' : 'false'}"
                data-v5-count-search-row="${escapeHtml(searchText(product))}"
              >
                <div>
                  <strong>${escapeHtml(product.name)}</strong>
                  <small class="product-meta">${product.saintCode ? 'SAINT ' + escapeHtml(product.saintCode) : ''}${statusText}</small>
                </div>
                <button class="secondary" data-v5-count-action="jump" data-product-id="${escapeHtml(product.id)}" type="button">${actionLabel}</button>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${recentCounted.length ? `
        <details class="v5-count-review">
          <summary>Revisar últimos contados (${recentCounted.length})</summary>
          <div class="v5-count-review-list">
            ${recentCounted.map(line => `
              <div class="v5-count-recent-row">
                <div>
                  <strong>${escapeHtml(line.productName)}</strong>
                  <small class="product-meta">Guardado ${escapeHtml(String(line.countedStock))} · esperado ${escapeHtml(String(line.expectedStock))}</small>
                </div>
                <button class="secondary" data-v5-count-action="jump" data-product-id="${escapeHtml(line.productId)}" type="button">Editar</button>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
    </article>

    ${nextProduct
      ? renderProductCard(
          nextProduct,
          pendingIds.has(nextProduct.id),
          existingLine
        )
      : `
        <article class="card count-finished-card">
          <div class="count-complete-icon">✓</div>
          <h3>Recorrido de ${escapeHtml(selectedCategory.categoryName)} terminado</h3>
          <p class="product-meta">
            ${selectedCategory.pending
              ? `Quedan ${selectedCategory.pending} producto(s) pendientes para revisar después.`
              : 'No quedan productos sin recorrer en esta categoría. Puedes editar cualquier contado desde la lista superior.'}
          </p>
          <div class="v5-count-actions">
            <button class="secondary" data-v5-count-action="categories" type="button">Elegir otra categoría</button>
            ${selectedCategory.pending
              ? '<button class="primary" data-v5-count-action="pending" type="button">Revisar pendientes</button>'
              : ''}
          </div>
        </article>
      `}

    ${overall.complete ? `
      <article class="card count-finished-card">
        <div class="count-complete-icon">✓</div>
        <h3>Conteo general completo</h3>
        <p class="product-meta">Antes de cerrar todavía puedes corregir cualquier producto contado.</p>
        <button class="success count-close-button" data-action="close-document" type="button">Cerrar conteo</button>
      </article>
    ` : ''}
  `;
}

function renderPendingWorkspace({
  products,
  lines,
  documentRecord,
  pendingProducts,
  overall
}) {
  const forcedId = appRoot.dataset.v5CountForcedProductId || '';
  let nextProduct = forcedId
    ? pendingProducts.find(product => product.id === forcedId)
    : null;

  if (!nextProduct) {
    delete appRoot.dataset.v5CountForcedProductId;
    nextProduct = selectNextCountProduct({
      products,
      lines,
      metadata: documentRecord.metadata,
      pendingOnly: true
    });
  }

  return `
    <article class="card">
      <div class="v5-count-section-title">
        <div>
          <h3 style="margin:0">Pendientes</h3>
          <div class="product-meta">Estos productos fueron saltados deliberadamente. Ninguno se interpreta como existencia 0.</div>
        </div>
        <span class="badge status-warning">${pendingProducts.length}</span>
      </div>

      <div class="v5-count-pending-list" style="margin-top:12px">
        ${pendingProducts.length
          ? pendingProducts.map(product => `
              <div class="v5-count-pending-row">
                <div>
                  <strong>${escapeHtml(product.name)}</strong>
                  <small class="product-meta">${product.saintCode ? 'SAINT ' + escapeHtml(product.saintCode) : ''}</small>
                </div>
                <button class="secondary" data-v5-count-action="jump" data-product-id="${escapeHtml(product.id)}" type="button">Contar</button>
              </div>
            `).join('')
          : '<div class="empty compact-empty">No quedan productos pendientes.</div>'}
      </div>
    </article>

    ${nextProduct ? renderProductCard(nextProduct, true, null) : `
      <article class="card count-finished-card">
        <div class="count-complete-icon">✓</div>
        <h3>Sin pendientes</h3>
        <button class="primary" data-v5-count-action="categories" type="button">Volver a categorías</button>
      </article>
    `}

    ${overall.complete ? `
      <article class="card count-finished-card">
        <div class="count-complete-icon">✓</div>
        <h3>Conteo general completo</h3>
        <p class="product-meta">Puedes corregir líneas guardadas desde su categoría antes de cerrar.</p>
        <button class="success count-close-button" data-action="close-document" type="button">Cerrar conteo</button>
      </article>
    ` : ''}
  `;
}

function renderProductCard(product, wasPending, existingLine = null) {
  const editing = Boolean(existingLine);

  return `
    <article class="v5-count-product-card ${editing ? 'v5-count-editing' : ''}">
      <div class="v5-count-product-head">
        <div>
          <div class="product-meta">${editing ? 'Corrigiendo conteo guardado' : wasPending ? 'Pendiente seleccionado' : 'Producto actual'}</div>
          <h2>${escapeHtml(product.name)}</h2>
          <div class="product-meta">
            ${product.saintCode ? 'SAINT ' + escapeHtml(product.saintCode) + ' · ' : ''}
            ${product.sku ? 'SKU ' + escapeHtml(product.sku) + ' · ' : ''}
            ${escapeHtml(product.unitCode || 'UND')}
          </div>
        </div>
        ${editing
          ? '<span class="badge status-warning">EDITANDO</span>'
          : wasPending
            ? '<span class="badge status-warning">PENDIENTE</span>'
            : ''}
      </div>

      ${editing ? `
        <div class="v5-count-edit-note">
          <strong>Este producto ya estaba contado.</strong>
          <span class="product-meta">Guardado ${escapeHtml(String(existingLine.countedStock))} · esperado original ${escapeHtml(String(existingLine.expectedStock))}. La corrección reemplaza solo la línea del borrador; no duplica el producto ni crea movimientos.</span>
        </div>
      ` : ''}

      <label>
        Existencia física
        <input
          id="v5CountValue"
          class="numeric-input v5-count-input"
          inputmode="decimal"
          enterkeyhint="done"
          autocomplete="off"
          data-product-id="${escapeHtml(product.id)}"
          data-editing="${editing ? 'true' : 'false'}"
          placeholder="0"
          value="${editing ? escapeHtml(String(existingLine.countedStock)) : ''}"
        >
      </label>
      <div class="product-meta">Admite expresiones: 12+3, 24/2, (10+5)*2, 12,5. En teléfono usa los operadores inferiores sin perder el teclado numérico.</div>

      ${renderCountMathPad('v5CountValue')}

      <div class="v5-count-actions">
        <button class="primary" data-v5-count-action="save" data-product-id="${escapeHtml(product.id)}" type="button">
          ${editing ? 'Guardar corrección · Enter' : 'Guardar y continuar · Enter'}
        </button>
        ${editing
          ? '<button class="secondary" data-v5-count-action="cancel-edit" type="button">Cancelar corrección</button>'
          : `<button class="secondary" data-v5-count-action="skip" data-product-id="${escapeHtml(product.id)}" type="button">Saltar / dejar pendiente</button>`}
      </div>
    </article>
  `;
}

function renderCountMathPad(targetId) {
  return `
    <div class="math-pad" aria-label="Operaciones matemáticas">
      ${countMathButton(targetId, '+', '+')}
      ${countMathButton(targetId, '-', '−')}
      ${countMathButton(targetId, '*', '×')}
      ${countMathButton(targetId, '/', '÷')}
      ${countMathButton(targetId, '(', '(')}
      ${countMathButton(targetId, ')', ')')}
    </div>
  `;
}

function countMathButton(target, symbol, label) {
  return `
    <button
      data-math-target="${escapeHtml(target)}"
      data-symbol="${escapeHtml(symbol)}"
      type="button"
      aria-label="${escapeHtml(label)}"
    >${escapeHtml(label)}</button>
  `;
}

async function handleV5CountAction(button) {
  const documentId = appRoot.dataset.v5CountDocumentId;
  if (!documentId) throw new Error('No se pudo identificar el conteo activo');

  const action = button.dataset.v5CountAction;

  if (action === 'category') {
    delete appRoot.dataset.v5CountForcedProductId;
    await updateCountWorkflow(documentId, {
      mode: COUNT_WORKFLOW_MODES.CATEGORY,
      activeCategoryId: button.dataset.categoryId
    });
    return renderV5Count(documentId);
  }

  if (action === 'categories') {
    delete appRoot.dataset.v5CountForcedProductId;
    await updateCountWorkflow(documentId, {
      mode: COUNT_WORKFLOW_MODES.CATEGORY,
      activeCategoryId: ''
    });
    return renderV5Count(documentId);
  }

  if (action === 'pending') {
    delete appRoot.dataset.v5CountForcedProductId;
    await updateCountWorkflow(documentId, {
      mode: COUNT_WORKFLOW_MODES.PENDING
    });
    return renderV5Count(documentId);
  }

  if (action === 'edit-last') {
    const productId = button.dataset.productId || '';
    const categoryId = button.dataset.categoryId || '__UNCATEGORIZED__';
    if (!productId) throw new Error('No hay un último conteo para corregir');

    appRoot.dataset.v5CountForcedProductId = productId;
    await updateCountWorkflow(documentId, {
      mode: COUNT_WORKFLOW_MODES.CATEGORY,
      activeCategoryId: categoryId
    });
    return renderV5Count(documentId);
  }

  if (action === 'jump') {
    appRoot.dataset.v5CountForcedProductId =
      button.dataset.productId || '';
    return renderV5Count(documentId);
  }

  if (action === 'cancel-edit') {
    delete appRoot.dataset.v5CountForcedProductId;
    return renderV5Count(documentId);
  }

  if (action === 'skip') {
    delete appRoot.dataset.v5CountForcedProductId;
    await markCountProductPending(
      documentId,
      button.dataset.productId
    );
    return renderV5Count(documentId);
  }

  if (action === 'save') {
    const productId = button.dataset.productId;
    const input = document.getElementById('v5CountValue');
    const countedStock = evaluateNumericExpression(
      input?.value
    );
    const lines = await listDocumentLines(documentId);
    const existingLine = lines.find(line =>
      line.productId === productId
    ) || null;

    await saveDocumentLine({
      documentId,
      productId,
      countedStock,
      ...(existingLine
        ? { expectedStock: existingLine.expectedStock }
        : {})
    });

    await clearCountProductPending(
      documentId,
      productId
    );

    delete appRoot.dataset.v5CountForcedProductId;
    return renderV5Count(documentId);
  }
}

function filterJumpRows(rawQuery) {
  const query = normalizeSearch(rawQuery);
  appRoot.querySelectorAll('[data-v5-count-search-row]')
    .forEach(row => {
      const haystack = row.dataset.v5CountSearchRow || '';
      row.hidden = Boolean(query) && !haystack.includes(query);
    });
}

function searchText(product) {
  return normalizeSearch([
    product?.name,
    product?.saintCode,
    product?.sku,
    product?.barcode
  ].filter(Boolean).join(' '));
}

function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function showLocalError(error) {
  const message = error?.message || String(error);
  console.error('V5-A:', error);
  const host = appRoot.querySelector('.v5-count-shell');
  if (!host) return;

  let box = host.querySelector('.v5-count-local-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'status-danger v5-count-local-error';
    host.prepend(box);
  }
  box.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
