import { getCurrentSession, can } from '../admin/adminClient.js';
import { createArea, listAreas, updateArea } from '../areas/areaService.js';
import { listAreaDeliveries } from '../areas/supplyAreaDeliveryService.js';
import { STORES, getAll } from '../storage/database.js';
import { buildAreaConsumptionReport } from '../reporting/areaConsumptionReport.js';

const appRoot = document.getElementById('app');
let enhancing = false;
let areaWriteRunning = false;

if (appRoot) {
  const observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(appRoot, { childList: true, subtree: true });

  appRoot.addEventListener('click', event => {
    handleAreaWorkspaceClick(event).catch(error =>
      showWorkspaceToast(error.message || String(error), 'danger')
    );
  });

  scheduleEnhance();
}

function scheduleEnhance() {
  queueMicrotask(() => enhanceAreaWorkspace().catch(error => {
    console.warn('VIGÍA áreas: no se pudo mejorar la vista.', error);
  }));
}

async function enhanceAreaWorkspace() {
  if (!appRoot || enhancing) return;
  enhancing = true;
  try {
    const title = [...appRoot.querySelectorAll('h2')]
      .map(node => node.textContent.trim())
      .find(Boolean);

    if (title === 'Configuración' && !appRoot.querySelector('.v7-area-settings')) {
      await renderAreaSettings();
    }

    if (title === 'Reportes' && !appRoot.querySelector('.v7-area-report')) {
      await renderAreaReport();
    }
  } finally {
    enhancing = false;
  }
}

async function renderAreaSettings() {
  const [session, areas] = await Promise.all([
    getCurrentSession().catch(() => null),
    listAreas({ includeInactive: true, refresh: navigator.onLine })
  ]);
  const writable = can(session, 'catalog.write');

  const card = document.createElement('section');
  card.className = 'card v7-area-settings';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <div class="v7-area-eyebrow">CONSUMO INTERNO</div>
        <h3>Áreas del negocio</h3>
        <p>Define los destinos usados en Surtido. Desactivar conserva todo el histórico.</p>
      </div>
      <span class="badge">${areas.filter(area => area.active !== false).length} activa(s)</span>
    </div>

    ${writable ? `
      <div class="v7-area-create">
        <label>
          Nueva área
          <input data-area-new-name maxlength="80" placeholder="Ej. Cocina, Barra, Lavandería...">
        </label>
        <button class="primary" data-area-workspace-action="create" type="button">＋ Agregar área</button>
      </div>
      <div class="v7-area-suggestions">
        <span>Sugeridas:</span>
        ${['Mantenimiento','Lavandería','Cocina','Barra','Cafetería','Meseros']
          .filter(name => !areas.some(area => area.name.toLowerCase() === name.toLowerCase()))
          .map(name => `<button class="ghost-button" data-area-workspace-action="quick-create" data-area-name="${escapeHtml(name)}" type="button">＋ ${escapeHtml(name)}</button>`)
          .join('') || '<small>Ya agregaste todas las sugeridas.</small>'}
      </div>
    ` : `
      <div class="v7-area-readonly-note">Tu usuario puede consultar las áreas, pero no administrarlas.</div>
    `}

    <div class="v7-area-settings-list">
      ${areas.length
        ? areas.map((area, index) => renderAreaSettingRow(area, index, writable)).join('')
        : '<div class="empty compact-empty">Todavía no hay áreas. Al crear la primera, Surtido activará automáticamente la distribución.</div>'}
    </div>

    <div class="v7-area-footnote">
      <strong>Importante:</strong> un área no maneja stock propio. Solo clasifica el consumo de cada entrega física.
    </div>
  `;

  const host = appRoot.querySelector('.settings-grid-v2') || appRoot;
  host.appendChild(card);
}

function renderAreaSettingRow(area, index, writable) {
  return `
    <div class="v7-area-setting-row" data-area-setting-id="${escapeHtml(area.id)}">
      <span class="v7-area-order">${index + 1}</span>
      <label>
        Nombre
        <input data-area-setting-name value="${escapeHtml(area.name)}" maxlength="80" ${writable ? '' : 'disabled'}>
      </label>
      <label>
        Orden
        <input data-area-setting-order inputmode="numeric" value="${Number(area.sortOrder || 0)}" ${writable ? '' : 'disabled'}>
      </label>
      <label class="v7-area-active-toggle">
        <input data-area-setting-active type="checkbox" ${area.active !== false ? 'checked' : ''} ${writable ? '' : 'disabled'}>
        <span>${area.active !== false ? 'Activa' : 'Inactiva'}</span>
      </label>
      ${writable ? `<button class="secondary" data-area-workspace-action="save" type="button">Guardar</button>` : ''}
    </div>
  `;
}

async function renderAreaReport() {
  const days = Math.max(1, Number(document.getElementById('reportDays')?.value || 30));
  const from = new Date(Date.now() - days * 86400000);
  const [session, areas, areaDeliveries, movements, lots, products] = await Promise.all([
    getCurrentSession().catch(() => null),
    listAreas({ includeInactive: true, refresh: navigator.onLine }),
    listAreaDeliveries({ from, refresh: navigator.onLine }),
    getAll(STORES.MOVEMENTS),
    getAll(STORES.LOTS),
    getAll(STORES.PRODUCTS)
  ]);

  const report = buildAreaConsumptionReport({
    areaDeliveries,
    movements,
    lots,
    products,
    areas,
    from,
    to: new Date()
  });
  const canViewCosts = can(session, 'costs.view');
  const useCostBars = canViewCosts && report.knownCost > 0;
  const maxBar = Math.max(
    1,
    ...report.rows.map(row => useCostBars ? row.knownCost : row.allocationCount)
  );

  const card = document.createElement('section');
  card.className = 'card v7-area-report';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <div class="v7-area-eyebrow">NUEVO · CONSUMO POR ÁREA</div>
        <h3>¿Quién está gastando más?</h3>
        <p>Distribuciones reales de Surtido durante los últimos ${days} días.</p>
      </div>
      <span class="badge">${report.deliveryCount} entrega(s)</span>
    </div>

    <div class="v7-area-report-kpis">
      <div><small>Áreas con consumo</small><strong>${report.rows.length}</strong></div>
      <div><small>Productos distribuidos</small><strong>${report.trackedDeliveryLines}</strong></div>
      ${canViewCosts
        ? `<div><small>Costo registrado</small><strong>${formatMoney(report.knownCost)}</strong></div>
           <div><small>Cobertura de costo</small><strong>${format(report.costCoveragePercent)}%</strong></div>`
        : `<div><small>Asignaciones</small><strong>${report.rows.reduce((sum,row)=>sum+row.allocationCount,0)}</strong></div>
           <div><small>Costos</small><strong>Sin permiso</strong></div>`}
    </div>

    ${report.rows.length ? `
      <div class="v7-area-report-layout">
        <div class="v7-area-bars">
          ${report.rows.map((row, index) => `
            <button class="v7-area-bar-row" data-area-report-toggle="${escapeHtml(row.areaId)}" type="button">
              <span class="v7-area-rank">${index + 1}</span>
              <span class="v7-area-bar-copy">
                <strong>${escapeHtml(row.areaName)}</strong>
                <small>${row.deliveryCount} entrega(s) · ${row.allocationCount} asignación(es)</small>
                <span class="v7-area-bar-track"><i style="width:${Math.max(3, ((useCostBars ? row.knownCost : row.allocationCount) / maxBar) * 100)}%"></i></span>
              </span>
              <span class="v7-area-bar-value">
                <strong>${useCostBars ? formatMoney(row.knownCost) : row.allocationCount}</strong>
                <small>${useCostBars ? `${format(row.costCoveragePercent)}% costo cubierto` : 'asignaciones'}</small>
              </span>
            </button>
            <div class="v7-area-report-detail" data-area-report-detail="${escapeHtml(row.areaId)}" ${index === 0 ? '' : 'hidden'}>
              <div class="v7-area-detail-head">
                <strong>Principales productos · ${escapeHtml(row.areaName)}</strong>
                ${row.areaActive === false ? '<span class="badge">Área inactiva</span>' : ''}
              </div>
              ${row.products.slice(0, 8).map(product => `
                <div class="v7-area-product-row">
                  <span>${escapeHtml(product.productName)}</span>
                  <span>${format(product.quantity)} u.</span>
                  ${canViewCosts
                    ? `<strong>${formatMoney(product.knownCost)}</strong>`
                    : '<strong>—</strong>'}
                </div>
              `).join('') || '<div class="empty compact-empty">Sin detalle.</div>'}
            </div>
          `).join('')}
        </div>

        <aside class="v7-area-report-note">
          <strong>${useCostBars ? 'Ranking por costo registrado' : 'Ranking por actividad'}</strong>
          <p>${useCostBars
            ? 'El valor monetario usa los costos de lote disponibles. Si falta costo en parte del surtido, VIGÍA lo indica con la cobertura y no inventa valores.'
            : 'Todavía no hay costos suficientes para ordenar por dinero. El gráfico usa asignaciones reales por área sin mezclar unidades distintas.'}</p>
          <small>Los surtidos anteriores a esta función no se asignan retroactivamente.</small>
        </aside>
      </div>
    ` : `
      <div class="v7-area-report-empty">
        <strong>Aún no hay consumo por áreas en este período.</strong>
        <span>Configura las áreas y registra la próxima entrega desde Surtido; el reporte empezará a llenarse solo.</span>
      </div>
    `}
  `;

  const host = appRoot.querySelector('.report-visual-grid');
  if (host) host.insertAdjacentElement('afterend', card);
  else appRoot.appendChild(card);
}

async function handleAreaWorkspaceClick(event) {
  const actionButton = event.target.closest('[data-area-workspace-action]');
  if (actionButton) {
    if (areaWriteRunning) return;
    areaWriteRunning = true;
    try {
      if (actionButton.dataset.areaWorkspaceAction === 'create') {
        const input = appRoot.querySelector('[data-area-new-name]');
        const name = input?.value?.trim();
        if (!name) throw new Error('Escribe el nombre del área');
        await createArea({ name });
        showWorkspaceToast(`Área ${name} creada.`, 'success');
      }

      if (actionButton.dataset.areaWorkspaceAction === 'quick-create') {
        const name = actionButton.dataset.areaName;
        await createArea({ name });
        showWorkspaceToast(`Área ${name} creada.`, 'success');
      }

      if (actionButton.dataset.areaWorkspaceAction === 'save') {
        const row = actionButton.closest('[data-area-setting-id]');
        await updateArea(row.dataset.areaSettingId, {
          name: row.querySelector('[data-area-setting-name]').value.trim(),
          sortOrder: Number(row.querySelector('[data-area-setting-order]').value || 0),
          active: row.querySelector('[data-area-setting-active]').checked
        });
        showWorkspaceToast('Área actualizada.', 'success');
      }

      appRoot.querySelector('.v7-area-settings')?.remove();
      await renderAreaSettings();
    } finally {
      areaWriteRunning = false;
    }
    return;
  }

  const reportToggle = event.target.closest('[data-area-report-toggle]');
  if (reportToggle) {
    const id = reportToggle.dataset.areaReportToggle;
    const detail = appRoot.querySelector(`[data-area-report-detail="${cssEscape(id)}"]`);
    if (detail) detail.hidden = !detail.hidden;
  }
}

function showWorkspaceToast(message, tone = 'success') {
  document.querySelector('.v7-area-workspace-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast v7-area-workspace-toast v7-area-toast-${tone}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function format(value) {
  return Number(value || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
