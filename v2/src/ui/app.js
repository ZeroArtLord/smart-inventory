import { createLocalId } from '../core/ids.js';
import { evaluateNumericExpression } from '../core/mathExpression.js';
import { REPLENISHMENT_METHODS } from '../core/catalog.js';
import {
  seedDefaultUnits,
  createProduct,
  listProducts,
  searchProducts
} from '../catalog/catalogService.js';
import {
  readCatalogFile,
  applyCatalogImport
} from '../catalog/catalogExcel.js';
import {
  STORES,
  openDatabase,
  get,
  getAll
} from '../storage/database.js';
import {
  createDocument,
  saveDocumentLine,
  listDocumentLines,
  listDraftDocuments,
  cancelDocument,
  closeDocument
} from '../documents/documentService.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS
} from '../documents/documentTypes.js';
import {
  getReplenishmentSuggestion
} from '../intelligence/replenishmentEngine.js';
import {
  syncNow,
  onSyncStatus
} from '../sync/syncEngine.js';
import {
  listSyncConflicts
} from '../sync/localQueue.js';
import {
  acceptServerConflict,
  reapplyLocalConflict
} from '../sync/conflictResolver.js';
import {
  getDashboardSnapshot
} from './dashboardService.js';
import {
  buildInventoryReport,
  summarizeInventoryReport,
  listExpiringLots,
  summarizeMovements,
  buildProductMovementTotals
} from '../reporting/reportingEngine.js';
import {
  createReplenishment,
  listReplenishments,
  changeReplenishmentStatus,
  reconcileReplenishmentReceipts,
  REPLENISHMENT_STATUS
} from '../replenishment/replenishmentService.js';
import {
  findProductByBarcode,
  supportsCameraBarcodeScanner,
  startCameraBarcodeScanner
} from '../scanner/barcodeScanner.js';
import {
  buildDocumentExportRows,
  downloadCsv,
  downloadXlsx,
  printRows
} from '../export/exportService.js';
import {
  getCurrentSession,
  listWorkspaceMembers,
  createWorkspaceMember,
  updateWorkspaceMember,
  can,
  ROLE_OPTIONS,
  PERMISSION_OPTIONS
} from '../admin/adminClient.js';

const appRoot = document.getElementById('app');
const saveStatus = document.getElementById('saveStatus');

const state = {
  view: 'home',
  products: [],
  activeDocumentId: null,
  activeDocumentType: null,
  selectedProductId: null,
  searchResults: [],
  importPreview: null,
  reportDays: 30,
  reportRows: [],
  session: null,
  members: []
};

const ownerId = getLocalOwnerId();
let syncTimer = null;
let barcodeScannerSession = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    await openDatabase();
    await seedDefaultUnits();
    await refreshProducts();
    bindGlobalEvents();
    registerServiceWorker();
    bindSyncLifecycle();
    await syncAndRefresh({ renderAfter: false });
    await refreshProducts();
    await refreshSession({ silent: true });
    await render();
  } catch (error) {
    renderFatal(error);
  }
}

function bindGlobalEvents() {
  document.getElementById('homeButton').addEventListener('click', () => {
    state.view = 'home';
    state.activeDocumentId = null;
    state.activeDocumentType = null;
    state.selectedProductId = null;
    render();
  });

  document.querySelector('.bottom-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    state.view = button.dataset.view;
    state.activeDocumentId = null;
    state.activeDocumentType = null;
    state.selectedProductId = null;
    render();
  });

  appRoot.addEventListener('click', handleClick);
  appRoot.addEventListener('submit', handleSubmit);
  appRoot.addEventListener('input', handleInput);
  appRoot.addEventListener('change', handleChange);
  appRoot.addEventListener('keydown', handleKeydown);
}

async function render() {
  await refreshSaveStatus();

  switch (state.view) {
    case 'catalog':
      return renderCatalog();
    case 'count':
      return renderDocumentWorkspace(DOCUMENT_TYPES.COUNT);
    case 'entry':
      return renderDocumentWorkspace(DOCUMENT_TYPES.ENTRY);
    case 'supply':
      return renderDocumentWorkspace(DOCUMENT_TYPES.SUPPLY);
    case 'replenishment':
      return renderReplenishmentWorkspace();
    case 'reports':
      return renderReports();
    case 'conflicts':
      return renderConflicts();
    case 'users':
      return renderUsers();
    default:
      return renderHome();
  }
}

async function renderHome() {
  const snapshot = await getDashboardSnapshot();
  const productById = new Map(
    state.products.map(product => [product.id, product])
  );


  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <h1>Almacén</h1>
        <p>Resumen operativo calculado desde movimientos, lotes y trabajo local.</p>
      </div>
      <div class="dashboard-sync">
        ${snapshot.syncConflictCount
          ? `<button class="secondary status-warning" data-open-view="conflicts" type="button">⚠ ${snapshot.syncConflictCount} conflicto(s)</button>`
          : snapshot.pendingSyncCount
            ? `<span class="badge status-warning">${snapshot.pendingSyncCount} pendientes</span>`
            : '<span class="badge status-good">Todo sincronizado</span>'}
      </div>
    </section>

    <section class="grid dashboard-grid">
      ${dashboardMetric(
        snapshot.inventorySummary.products,
        'Productos activos',
        'Catálogo'
      )}
      ${dashboardMetric(
        snapshot.inventorySummary.critical + snapshot.inventorySummary.low,
        'Stock con atención',
        'Mínimos + consumo'
      )}
      ${dashboardMetric(
        snapshot.expiringLots.length,
        'Lotes por vencer',
        'Próximos 30 días'
      )}
      ${dashboardMetric(
        snapshot.movementSummaryToday.supplyCount,
        'Surtidos hoy',
        `${snapshot.movementSummaryToday.movementCount} movimientos hoy`
      )}
    </section>

    <section class="grid dashboard-detail-grid" style="margin-top:16px">
      <article class="card">
        <div class="row">
          <div>
            <h3 style="margin:0">Sugerencias de reposición</h3>
            <div class="product-meta">Prioridad calculada con stock real y mínimos.</div>
          </div>
          <span class="badge">${snapshot.inventorySummary.replenishmentNeeded}</span>
        </div>

        <div class="stack" style="margin-top:12px">
          ${snapshot.lowStock.length
            ? snapshot.lowStock.map(row => `
              <div class="dashboard-list-row">
                <div>
                  <strong>${escapeHtml(row.name)}</strong>
                  <div class="product-meta">
                    Stock ${formatNumber(row.stock)} · Min ${formatNumber(row.minStock)} · Max ${formatNumber(row.maxStock)}
                  </div>
                </div>
                <div class="dashboard-list-end">
                  <strong>${formatNumber(row.suggestedQuantity)}</strong>
                  <small>reponer</small>
                </div>
              </div>
            `).join('')
            : '<div class="empty compact-empty">Sin productos que requieran reposición.</div>'}
        </div>
      </article>

      <article class="card">
        <div class="row">
          <div>
            <h3 style="margin:0">Vencimientos próximos</h3>
            <div class="product-meta">Lotes con existencia restante.</div>
          </div>
          <span class="badge">${snapshot.expiringLots.length}</span>
        </div>

        <div class="stack" style="margin-top:12px">
          ${snapshot.expiringLots.length
            ? snapshot.expiringLots.slice(0, 6).map(lot => {
                const product = productById.get(lot.productId);
                return `
                  <div class="dashboard-list-row">
                    <div>
                      <strong>${escapeHtml(product?.name || lot.productId)}</strong>
                      <div class="product-meta">
                        Lote ${escapeHtml(lot.lotNumber || '—')} · ${formatNumber(lot.remainingQuantity)} restantes
                      </div>
                    </div>
                    <div class="dashboard-list-end ${lot.expired ? 'status-danger' : lot.daysRemaining <= 7 ? 'status-warning' : ''}">
                      <strong>${lot.expired ? 'Vencido' : lot.daysRemaining + ' d'}</strong>
                      <small>${formatShortDate(lot.expiresAt)}</small>
                    </div>
                  </div>
                `;
              }).join('')
            : '<div class="empty compact-empty">Sin vencimientos próximos.</div>'}
        </div>
      </article>

      <article class="card">
        <div class="row">
          <div>
            <h3 style="margin:0">Movimientos recientes</h3>
            <div class="product-meta">El stock se deriva de este historial.</div>
          </div>
          <span class="badge">${snapshot.recentMovements.length}</span>
        </div>

        <div class="stack" style="margin-top:12px">
          ${snapshot.recentMovements.length
            ? snapshot.recentMovements.map(movement => {
                const product = productById.get(movement.productId);
                return `
                  <div class="dashboard-list-row">
                    <div>
                      <strong>${escapeHtml(product?.name || movement.productId)}</strong>
                      <div class="product-meta">
                        ${movementTypeLabel(movement.type)} · ${formatDate(movement.effectiveAt || movement.createdAt)}
                      </div>
                    </div>
                    <div class="dashboard-list-end">
                      <strong>${movementDisplayQuantity(movement)}</strong>
                      <small>${escapeHtml(movement.type)}</small>
                    </div>
                  </div>
                `;
              }).join('')
            : '<div class="empty compact-empty">Todavía no hay movimientos.</div>'}
        </div>
      </article>
    </section>

    <section class="grid dashboard-grid" style="margin-top:16px">
      ${actionCard('count', 'Conteo físico', 'Número + Enter. Ajustes trazables.')}
      ${actionCard('supply', 'Surtido', 'Salida validada y FEFO por lotes cuando aplica.')}
      ${actionCard('entry', 'Entrada', 'Recepción, costo, lote y vencimiento opcionales.')}
      ${actionCard('replenishment', 'Comprar / Pedir', 'Sugerencias, pedidos y mercancía en tránsito.')}
      ${actionCard('reports', 'Reportes', 'Inventario, consumo, vencimientos y movimientos.')}
      ${can(state.session, 'users.manage')
        ? actionCard('users', 'Usuarios y permisos', 'Roles, visibilidad y permisos granulares.')
        : ''}
      ${actionCard('catalog', 'Catálogo', 'Excel, mínimos, máximos y reposición.')}
    </section>
  `;
}

async function renderUsers() {
  if (!state.session) {
    await refreshSession({ silent: true });
  }

  if (!can(state.session, 'users.manage')) {
    appRoot.innerHTML = `
      <section class="hero">
        <h2>Usuarios y permisos</h2>
        <p>Esta sección requiere el permiso users.manage.</p>
      </section>
      <section class="card">
        <div class="empty">No tienes permiso para administrar usuarios.</div>
      </section>
    `;
    return;
  }

  try {
    state.members = await listWorkspaceMembers();
  } catch (error) {
    appRoot.innerHTML = `
      <section class="hero">
        <h2>Usuarios y permisos</h2>
        <p>Administración protegida por la API.</p>
      </section>
      <section class="card">
        <div class="status-danger">${escapeHtml(error.message || String(error))}</div>
      </section>
    `;
    return;
  }

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <h2>Usuarios y permisos</h2>
        <p>La interfaz oculta acciones, pero la API vuelve a validar cada permiso.</p>
      </div>
      <span class="badge">${state.members.length} miembro(s)</span>
    </section>

    <section class="card stack">
      <div>
        <h3 style="margin:0">Agregar usuario</h3>
        <div class="product-meta">
          Puedes preautorizar por email. En Firebase se vinculará al UID en el primer acceso válido.
        </div>
      </div>

      <form id="memberForm" class="user-create-grid">
        <label>
          Nombre
          <input name="displayName" autocomplete="name" placeholder="Nombre visible">
        </label>

        <label>
          Email
          <input name="email" type="email" autocomplete="email" required placeholder="usuario@empresa.com">
        </label>

        <label>
          Rol inicial
          <select name="roleCode">
            ${ROLE_OPTIONS.map(role => `
              <option value="${role.code}" ${role.code === 'WAREHOUSE' ? 'selected' : ''}>
                ${escapeHtml(role.label)}
              </option>
            `).join('')}
          </select>
        </label>

        <button class="primary" type="submit">Agregar miembro</button>
      </form>
    </section>

    <section class="stack" style="margin-top:16px">
      ${state.members.map(member => renderMemberCard(member)).join('')}
    </section>
  `;
}

function renderMemberCard(member) {
  const permissions = Array.isArray(member.permissions)
    ? member.permissions
    : [];
  const wildcard = permissions.includes('*');

  return `
    <article class="card user-member-card" data-member-card="${escapeHtml(member.userId)}">
      <div class="row user-member-head">
        <div>
          <strong>${escapeHtml(member.displayName || member.email || member.externalAuthId || member.userId)}</strong>
          <div class="product-meta">
            ${escapeHtml(member.email || 'Sin email')} ·
            ${member.externalAuthId ? 'Identidad vinculada' : 'Pendiente de primer acceso'}
          </div>
        </div>
        <span class="badge ${member.membershipActive ? 'status-good' : 'status-warning'}">
          ${member.membershipActive ? 'Activo' : 'Desactivado'}
        </span>
      </div>

      <div class="user-member-controls">
        <label>
          Rol
          <select data-member-role>
            ${ROLE_OPTIONS.map(role => `
              <option value="${role.code}" ${role.code === member.roleCode ? 'selected' : ''}>
                ${escapeHtml(role.label)}
              </option>
            `).join('')}
          </select>
        </label>

        <label class="user-active-toggle">
          <input data-member-active type="checkbox" ${member.membershipActive ? 'checked' : ''}>
          Membresía activa
        </label>

        <button
          class="primary"
          data-action="save-member-role"
          data-user-id="${escapeHtml(member.userId)}"
          type="button"
        >Aplicar rol / estado</button>
      </div>

      <details class="permission-details">
        <summary>
          Permisos granulares
          ${wildcard ? '<span class="badge">Acceso total</span>' : `<span class="badge">${permissions.length}</span>`}
        </summary>

        <div class="permission-grid">
          ${PERMISSION_OPTIONS.map(permission => `
            <label class="permission-option">
              <input
                type="checkbox"
                data-member-permission
                value="${escapeHtml(permission.code)}"
                ${wildcard || permissions.includes(permission.code) ? 'checked' : ''}
              >
              <span>
                <strong>${escapeHtml(permission.label)}</strong>
                <small>${escapeHtml(permission.code)}</small>
              </span>
            </label>
          `).join('')}
        </div>

        <button
          class="secondary"
          data-action="save-member-permissions"
          data-user-id="${escapeHtml(member.userId)}"
          type="button"
        >Guardar permisos personalizados</button>
      </details>
    </article>
  `;
}

async function renderConflicts() {
  const conflicts = await listSyncConflicts();

  appRoot.innerHTML = `
    <section class="hero">
      <h2>Conflictos de sincronización</h2>
      <p>Un cambio llegó desde otro dispositivo antes que el tuyo. Nada se sobrescribe en silencio.</p>
    </section>

    <section class="card stack">
      ${conflicts.length
        ? conflicts.map(item => `
          <div class="conflict-card">
            <div>
              <strong>${escapeHtml(item.entityType)} · ${escapeHtml(item.entityId)}</strong>
              <div class="product-meta">
                Motivo ${escapeHtml(item.conflict?.reason || 'STALE_WRITE')} ·
                Servidor v${item.conflict?.serverVersion ?? '—'} ·
                Tu cambio v${item.conflict?.clientVersion ?? item.payload?.version ?? '—'}
              </div>
            </div>

            <div class="conflict-actions">
              <button
                class="secondary"
                data-action="accept-server-conflict"
                data-id="${escapeHtml(item.id)}"
                type="button"
              >Usar servidor</button>

              <button
                class="primary"
                data-action="reapply-local-conflict"
                data-id="${escapeHtml(item.id)}"
                type="button"
              >Reaplicar mi cambio</button>
            </div>
          </div>
        `).join('')
        : '<div class="empty">No hay conflictos pendientes.</div>'}
    </section>
  `;
}

async function renderReports() {
  const [movements, lots] = await Promise.all([
    getAll(STORES.MOVEMENTS),
    getAll(STORES.LOTS)
  ]);

  const now = new Date();
  const from = new Date(
    now.getTime() - (Number(state.reportDays || 30) * 86400000)
  );

  const inventoryRows = buildInventoryReport(
    state.products,
    movements,
    { now }
  );
  const inventorySummary = summarizeInventoryReport(inventoryRows);
  const movementSummary = summarizeMovements(movements, {
    from,
    to: now
  });
  const movementTotals = buildProductMovementTotals(movements, {
    from,
    to: now
  });
  const expiringLots = listExpiringLots(lots, {
    now,
    withinDays: 30,
    includeExpired: true
  });

  const productById = new Map(
    state.products.map(product => [product.id, product])
  );

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <h2>Reportes</h2>
        <p>Datos calculados desde movimientos reales. Nada de stock editable.</p>
      </div>
      <div class="report-actions">
        <label class="report-filter">
          Periodo
          <select id="reportDays">
            <option value="7" ${state.reportDays === 7 ? 'selected' : ''}>7 días</option>
            <option value="30" ${state.reportDays === 30 ? 'selected' : ''}>30 días</option>
            <option value="90" ${state.reportDays === 90 ? 'selected' : ''}>90 días</option>
          </select>
        </label>
        <button class="secondary" data-action="export-report" data-format="csv" type="button">CSV</button>
        <button class="secondary" data-action="export-report" data-format="xlsx" type="button">Excel</button>
        <button class="primary" data-action="export-report" data-format="print" type="button">Imprimir / PDF</button>
      </div>
    </section>

    <section class="grid dashboard-grid">
      ${dashboardMetric(
        inventorySummary.products,
        'Productos',
        'Activos'
      )}
      ${dashboardMetric(
        inventorySummary.critical,
        'Stock crítico',
        'Requiere atención'
      )}
      ${dashboardMetric(
        movementSummary.entryCount,
        'Entradas',
        `Últimos ${state.reportDays} días`
      )}
      ${dashboardMetric(
        movementSummary.supplyCount,
        'Surtidos',
        `Últimos ${state.reportDays} días`
      )}
    </section>

    <section class="card" style="margin-top:16px">
      <div class="row">
        <div>
          <h3 style="margin:0">Inventario actual</h3>
          <div class="product-meta">Stock, mínimos, máximos, cobertura y tendencia.</div>
        </div>
        <span class="badge">${inventoryRows.length}</span>
      </div>

      <div class="report-table-wrap">
        <table class="report-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Stock</th>
              <th>Min</th>
              <th>Max</th>
              <th>Tránsito</th>
              <th>Sugerencia</th>
              <th>Cobertura</th>
              <th>Tendencia</th>
            </tr>
          </thead>
          <tbody>
            ${inventoryRows.map(row => `
              <tr>
                <td>
                  <strong>${escapeHtml(row.name)}</strong>
                  <div class="product-meta">${escapeHtml(row.sku || '')}</div>
                </td>
                <td>${formatNumber(row.stock)}</td>
                <td>${formatNumber(row.minStock)}</td>
                <td>${formatNumber(row.maxStock)}</td>
                <td>${formatNumber(row.pendingInbound)}</td>
                <td>${formatNumber(row.suggestedQuantity)}</td>
                <td>${row.coverageDays === null ? '—' : formatNumber(row.coverageDays) + ' d'}</td>
                <td>${trendLabel(row)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <div class="operation-layout" style="margin-top:16px">
      <section class="card stack">
        <div class="row">
          <div>
            <h3 style="margin:0">Mayor movimiento</h3>
            <div class="product-meta">Surtido real del periodo seleccionado.</div>
          </div>
        </div>

        ${movementTotals.length
          ? movementTotals.slice(0, 10).map(row => {
              const product = productById.get(row.productId);
              return `
                <div class="dashboard-list-row">
                  <div>
                    <strong>${escapeHtml(product?.name || row.productId)}</strong>
                    <div class="product-meta">
                      Entradas ${formatNumber(row.entry)} · Surtidos ${formatNumber(row.supply)} · Ajustes ${formatSigned(row.adjustment)}
                    </div>
                  </div>
                  <div class="dashboard-list-end">
                    <strong>${formatNumber(row.supply)}</strong>
                    <small>surtido</small>
                  </div>
                </div>
              `;
            }).join('')
          : '<div class="empty compact-empty">Sin movimientos en el periodo.</div>'}
      </section>

      <section class="card stack">
        <div class="row">
          <div>
            <h3 style="margin:0">Vencimientos</h3>
            <div class="product-meta">Lotes vencidos o próximos 30 días.</div>
          </div>
          <span class="badge">${expiringLots.length}</span>
        </div>

        ${expiringLots.length
          ? expiringLots.slice(0, 10).map(lot => {
              const product = productById.get(lot.productId);
              return `
                <div class="dashboard-list-row">
                  <div>
                    <strong>${escapeHtml(product?.name || lot.productId)}</strong>
                    <div class="product-meta">
                      Lote ${escapeHtml(lot.lotNumber || '—')} · ${formatNumber(lot.remainingQuantity)} restantes
                    </div>
                  </div>
                  <div class="dashboard-list-end ${lot.expired ? 'status-danger' : lot.daysRemaining <= 7 ? 'status-warning' : ''}">
                    <strong>${lot.expired ? 'Vencido' : lot.daysRemaining + ' d'}</strong>
                    <small>${formatShortDate(lot.expiresAt)}</small>
                  </div>
                </div>
              `;
            }).join('')
          : '<div class="empty compact-empty">Sin vencimientos próximos.</div>'}
      </section>
    </div>
  `;
}

async function renderCatalog() {
  await refreshProducts();

  appRoot.innerHTML = `
    <section class="hero">
      <h2>Catálogo</h2>
      <p>Base maestra del inventario. Importa Excel con vista previa antes de tocar el catálogo.</p>
    </section>

    <section class="card stack" style="margin-bottom:16px">
      <div>
        <h3 style="margin:0">Importar catálogo desde Excel</h3>
        <p class="product-meta" style="margin-bottom:0">
          Acepta .xlsx, .xls y .csv. Detecta Producto, SKU, código de barras, mínimos, máximos, categoría y unidad.
        </p>
      </div>

      <label>
        Archivo
        <input id="catalogImportFile" type="file" accept=".xlsx,.xls,.csv">
      </label>

      <div class="product-meta">
        Seguridad V2: una columna de Existencia puede leerse para validar el archivo, pero <strong>no modifica el stock</strong>.
        La existencia real entra por Conteo o movimientos trazables.
      </div>

      ${state.importPreview ? renderCatalogImportPreview(state.importPreview) : ''}
    </section>

    <div class="operation-layout">
      <form id="productForm" class="card stack">
        <h3 style="margin:0">Nuevo producto</h3>

        <label>
          Nombre
          <input name="name" autocomplete="off" required>
        </label>

        <div class="row">
          <label>
            SKU / Código interno
            <input name="sku" autocomplete="off">
          </label>
          <label>
            Código de barras
            <input name="barcode" inputmode="numeric" autocomplete="off">
          </label>
        </div>

        <div class="row">
          <label>
            Mínimo semanal
            <input name="minStock" value="0" inputmode="decimal">
          </label>
          <label>
            Máximo semanal
            <input name="maxStock" value="0" inputmode="decimal">
          </label>
        </div>

        <label>
          Reposición
          <select name="replenishmentMethod">
            <option value="${REPLENISHMENT_METHODS.BOTH}">Compra o pedido</option>
            <option value="${REPLENISHMENT_METHODS.PURCHASE}">Compra</option>
            <option value="${REPLENISHMENT_METHODS.ORDER}">Pedido</option>
            <option value="${REPLENISHMENT_METHODS.NONE}">Sin reposición automática</option>
          </select>
        </label>

        <button class="primary" type="submit">Agregar producto</button>
      </form>

      <section class="card">
        <div class="row">
          <h3 style="margin:0">Productos</h3>
          <span class="badge">${state.products.length}</span>
        </div>
        <div class="stack" style="margin-top:12px">
          ${state.products.length
            ? state.products.map(product => `
              <div>
                <strong>${escapeHtml(product.name)}</strong>
                <div class="product-meta">
                  Min ${product.minStock} · Max ${product.maxStock || '—'} · ${escapeHtml(replenishmentLabel(product.replenishmentMethod))}
                </div>
              </div>
            `).join('')
            : '<div class="empty">Todavía no hay productos.</div>'}
        </div>
      </section>
    </div>
  `;
}

async function renderReplenishmentWorkspace() {
  const snapshot = await getDashboardSnapshot({
    lowStockLimit: 1000
  });
  const items = await listReplenishments();
  const actionableSuggestions = snapshot.lowStock.filter(
    row => Number(row.suggestedQuantity || 0) > 0
  );

  appRoot.innerHTML = `
    <section class="hero">
      <h2>Compras, pedidos y tránsito</h2>
      <p>Una compra/pedido pendiente reduce la recomendación, pero nunca aumenta el stock físico.</p>
    </section>

    <div class="operation-layout">
      <section class="card stack">
        <div class="row">
          <div>
            <h3 style="margin:0">Sugerencias</h3>
            <div class="product-meta">Calculadas con stock real + mercancía ya pedida.</div>
          </div>
          <span class="badge">${snapshot.inventorySummary.replenishmentNeeded}</span>
        </div>

        ${actionableSuggestions.length
          ? actionableSuggestions.map(row => {
              const product = state.products.find(item => item.id === row.productId);
              return `
                <div class="dashboard-list-row">
                  <div>
                    <strong>${escapeHtml(row.name)}</strong>
                    <div class="product-meta">
                      Stock ${formatNumber(row.stock)} · En tránsito ${formatNumber(row.pendingInbound)} ·
                      Min ${formatNumber(row.minStock)} · Max ${formatNumber(row.maxStock)}
                    </div>
                  </div>
                  <div class="replenishment-actions">
                    <span class="badge">${formatNumber(row.suggestedQuantity)} sugeridos</span>
                    ${renderReplenishmentCreateButtons(product, row.suggestedQuantity)}
                  </div>
                </div>
              `;
            }).join('')
          : '<div class="empty compact-empty">No hay sugerencias pendientes.</div>'}
      </section>

      <section class="card stack">
        <div class="row">
          <div>
            <h3 style="margin:0">Compras / pedidos</h3>
            <div class="product-meta">Borradores, realizados, en tránsito y recibidos.</div>
          </div>
          <span class="badge">${items.length}</span>
        </div>

        ${items.length
          ? items.map(item => `
            <div class="replenishment-card">
              <div class="row">
                <div>
                  <strong>${escapeHtml(item.productName || item.productId)}</strong>
                  <div class="product-meta">
                    ${item.method === 'PURCHASE' ? 'Compra' : 'Pedido'} ·
                    ${formatNumber(item.requestedQuantity)} solicitados ·
                    ${formatNumber(item.pendingQuantity)} pendientes
                  </div>
                </div>
                <span class="badge">${replenishmentStatusLabel(item.status)}</span>
              </div>

              ${item.expectedAt
                ? `<div class="product-meta">Llegada esperada: ${formatShortDate(item.expectedAt)}</div>`
                : ''}

              <div class="row replenishment-buttons">
                ${renderReplenishmentStatusButtons(item)}
              </div>
            </div>
          `).join('')
          : '<div class="empty compact-empty">Todavía no hay compras o pedidos.</div>'}
      </section>
    </div>
  `;
}

async function renderDocumentWorkspace(type) {
  if (!state.activeDocumentId || state.activeDocumentType !== type) {
    const drafts = await listDraftDocuments({ ownerId, type });
    const allDocuments = await getAll(STORES.DOCUMENTS);
    const closedDocuments = allDocuments
      .filter(document => document.type === type)
      .filter(document =>
        document.status !== DOCUMENT_STATUS.DRAFT &&
        document.status !== DOCUMENT_STATUS.CANCELLED
      )
      .sort((a, b) =>
        String(b.closedAt || b.updatedAt || '').localeCompare(
          String(a.closedAt || a.updatedAt || '')
        )
      )
      .slice(0, 10);

    appRoot.innerHTML = `
      <section class="hero">
        <h2>${documentTitle(type)}</h2>
        <p>${documentSubtitle(type)}</p>
      </section>

      <section class="card stack">
        <button class="primary" data-action="new-document" data-type="${type}" type="button">
          Nuevo ${documentTitle(type).toLowerCase()}
        </button>

        ${drafts.length
          ? `
            <div>
              <strong>Continuar trabajo</strong>
              <div class="stack" style="margin-top:8px">
                ${drafts.map(document => `
                  <div class="row">
                    <button class="secondary" style="flex:1" data-action="open-document" data-id="${escapeHtml(document.id)}" data-type="${type}" type="button">
                      ${escapeHtml(document.id)} · ${formatDate(document.updatedAt)}
                    </button>
                    <button class="danger" data-action="cancel-document" data-id="${escapeHtml(document.id)}" type="button">
                      Cancelar
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          `
          : '<div class="empty">No hay borradores pendientes.</div>'}
      </section>

      ${closedDocuments.length ? `
        <section class="card stack" style="margin-top:16px">
          <div class="row">
            <div>
              <strong>Documentos cerrados</strong>
              <div class="product-meta">Imprime, guarda como PDF o exporta sin modificar inventario.</div>
            </div>
            <span class="badge">${closedDocuments.length}</span>
          </div>

          ${closedDocuments.map(document => `
            <div class="closed-document-row">
              <div>
                <strong>${escapeHtml(document.id)}</strong>
                <div class="product-meta">
                  ${escapeHtml(document.status)} · ${formatDate(document.closedAt || document.updatedAt)}
                </div>
              </div>
              <div class="document-export-actions">
                <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="csv" type="button">CSV</button>
                <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="xlsx" type="button">Excel</button>
                <button class="primary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="print" type="button">Imprimir / PDF</button>
              </div>
            </div>
          `).join('')}
        </section>
      ` : ''}
    `;
    return;
  }

  if (type === DOCUMENT_TYPES.COUNT) {
    return renderCountWorkspace();
  }

  return renderCartWorkspace(type);
}

async function renderCountWorkspace() {
  await refreshProducts();

  const lines = await listDocumentLines(state.activeDocumentId);
  const countedIds = new Set(lines.map(line => line.productId));
  const nextProduct = state.products.find(product => !countedIds.has(product.id));
  const percent = state.products.length
    ? Math.round((lines.length / state.products.length) * 100)
    : 0;

  appRoot.innerHTML = `
    <section class="hero">
      <h2>Conteo físico</h2>
      <p>${lines.length} de ${state.products.length} productos.</p>
    </section>

    <div class="card stack">
      <div class="progress-track"><div style="width:${percent}%"></div></div>
      <div class="row">
        <span class="badge">${percent}%</span>
        <span class="product-meta">${escapeHtml(state.activeDocumentId)}</span>
      </div>
    </div>

    ${nextProduct ? renderCountProduct(nextProduct) : `
      <section class="card stack" style="margin-top:16px">
        <h3 style="margin:0">Conteo completo</h3>
        <p class="product-meta">Todas las líneas están guardadas. Al cerrar se generarán únicamente los ajustes necesarios.</p>
        <button class="success" data-action="close-document" type="button">Cerrar conteo</button>
      </section>
    `}

    ${lines.length ? `
      <section class="card" style="margin-top:16px">
        <strong>Últimos contados</strong>
        <div class="stack" style="margin-top:10px">
          ${lines.slice(-8).reverse().map(line => `
            <div class="cart-line">
              <div>
                <strong>${escapeHtml(line.productName)}</strong>
                <div class="product-meta">Esperado ${line.expectedStock} · Contado ${line.countedStock}</div>
              </div>
              <span class="badge">${formatSigned(line.difference)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    ` : ''}
  `;

  requestAnimationFrame(() => {
    document.getElementById('countValue')?.focus();
  });
}

function renderCountProduct(product) {
  return `
    <section class="card stack" style="margin-top:16px">
      <div>
        <h3 class="product-title">${escapeHtml(product.name)}</h3>
        <div class="product-meta">
          Mínimo ${product.minStock} · Máximo ${product.maxStock || '—'}
        </div>
      </div>

      <label>
        Existencia física
        <input
          id="countValue"
          class="numeric-input"
          inputmode="decimal"
          autocomplete="off"
          data-product-id="${escapeHtml(product.id)}"
          placeholder="0"
        >
      </label>

      ${mathPad('countValue')}

      <button
        class="primary"
        data-action="save-count"
        data-product-id="${escapeHtml(product.id)}"
        type="button"
      >
        Guardar y siguiente
      </button>

      <small class="product-meta">Puedes escribir 12+4-2 y presionar Enter.</small>
    </section>
  `;
}

async function renderCartWorkspace(type) {
  const lines = await listDocumentLines(state.activeDocumentId);
  const documentRecord = await get(STORES.DOCUMENTS, state.activeDocumentId);
  const linkedReplenishment = documentRecord?.metadata?.replenishmentId
    ? await get(
        STORES.REPLENISHMENTS,
        documentRecord.metadata.replenishmentId
      )
    : null;
  const selectedProductId = linkedReplenishment?.productId ||
    state.selectedProductId;
  const selected = state.products.find(
    product => product.id === selectedProductId
  );

  appRoot.innerHTML = `
    <section class="hero">
      <h2>${documentTitle(type)}</h2>
      <p>${escapeHtml(state.activeDocumentId)}</p>
    </section>

    <div class="operation-layout">
      <section class="card stack">
        ${linkedReplenishment ? `
          <div class="status-warning">
            Recepción vinculada a ${linkedReplenishment.method === 'PURCHASE' ? 'Compra' : 'Pedido'}.
            Pendiente: <strong>${formatNumber(linkedReplenishment.pendingQuantity)}</strong>.
            Solo puede recibirse ${escapeHtml(linkedReplenishment.productName || linkedReplenishment.productId)}.
          </div>
        ` : `
          <div class="scanner-search-row">
            <label>
              Buscar producto
              <input id="productSearch" autocomplete="off" placeholder="Nombre, alias, SKU o código">
            </label>

            <button
              class="secondary scanner-button"
              data-action="open-barcode-scanner"
              type="button"
              ${supportsCameraBarcodeScanner() ? '' : 'disabled'}
              title="${supportsCameraBarcodeScanner()
                ? 'Abrir cámara'
                : 'La cámara requiere HTTPS y navegador compatible'}"
            >▣ Escanear</button>
          </div>

          <div class="product-meta">
            Los lectores USB/Bluetooth también funcionan: escanea y presiona Enter.
          </div>
          <div id="searchResults" class="search-results"></div>
        `}

        ${selected ? `
          <div class="card" style="box-shadow:none">
            <strong>${escapeHtml(selected.name)}</strong>
            <div class="product-meta">
              Min ${selected.minStock} · Max ${selected.maxStock || '—'}
            </div>
          </div>

          <label>
            Cantidad
            <input id="operationQuantity" class="numeric-input" inputmode="decimal" autocomplete="off" placeholder="0">
          </label>

          ${mathPad('operationQuantity')}

          ${type === DOCUMENT_TYPES.ENTRY ? `
            <div class="row">
              <label>
                Costo unitario opcional
                <input id="unitCost" inputmode="decimal" autocomplete="off">
              </label>
              <label>
                Lote opcional
                <input id="lotNumber" autocomplete="off">
              </label>
            </div>
            <label>
              Vencimiento opcional
              <input id="expiresAt" type="date">
            </label>
          ` : ''}

          <button class="primary" data-action="add-line" data-type="${type}" type="button">
            Agregar
          </button>
        ` : '<div class="empty">Busca y selecciona un producto.</div>'}
      </section>

      <section class="card stack">
        <div class="row">
          <h3 style="margin:0">${type === DOCUMENT_TYPES.SUPPLY ? 'Surtido' : 'Entrada'}</h3>
          <span class="badge">${lines.length} líneas</span>
        </div>

        <div>
          ${lines.length
            ? lines.map(line => `
              <div class="cart-line">
                <div>
                  <strong>${escapeHtml(line.productName)}</strong>
                  <div class="product-meta">
                    ${line.lotNumber ? 'Lote ' + escapeHtml(line.lotNumber) : ''}
                    ${line.expiresAt ? ' · Vence ' + formatDate(line.expiresAt) : ''}
                  </div>
                </div>
                <strong>${line.quantity}</strong>
              </div>
            `).join('')
            : '<div class="empty">Carrito vacío.</div>'}
        </div>

        ${lines.length
          ? '<button class="success" data-action="close-document" type="button">Cerrar documento</button>'
          : ''}
      </section>
    </div>
  `;

  requestAnimationFrame(() => {
    if (selected) document.getElementById('operationQuantity')?.focus();
    else document.getElementById('productSearch')?.focus();
  });
}

async function handleClick(event) {
  const viewButton = event.target.closest('[data-open-view]');
  if (viewButton) {
    state.view = viewButton.dataset.openView;
    return render();
  }

  const mathButton = event.target.closest('[data-math-target]');
  if (mathButton) {
    insertMathSymbol(mathButton.dataset.mathTarget, mathButton.dataset.symbol);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;

  try {
    switch (button.dataset.action) {
      case 'new-document':
        return startDocument(button.dataset.type);
      case 'open-document':
        state.activeDocumentId = button.dataset.id;
        state.activeDocumentType = button.dataset.type;
        state.selectedProductId = null;
        return render();
      case 'cancel-document':
        return cancelDraft(button.dataset.id);
      case 'save-count':
        return saveCount(button.dataset.productId);
      case 'select-product':
        state.selectedProductId = button.dataset.productId;
        state.searchResults = [];
        return render();
      case 'add-line':
        return addOperationLine(button.dataset.type);
      case 'close-document':
        return finishDocument();
      case 'apply-catalog-import':
        return applyCatalogPreview();
      case 'create-replenishment':
        return createReplenishmentFromSuggestion(button);
      case 'set-replenishment-status':
        return setReplenishmentStatus(button.dataset.id, button.dataset.status);
      case 'receive-replenishment':
        return startReplenishmentEntry(button.dataset.id);
      case 'accept-server-conflict':
        return resolveConflict(button.dataset.id, 'SERVER');
      case 'reapply-local-conflict':
        return resolveConflict(button.dataset.id, 'LOCAL');
      case 'open-barcode-scanner':
        return openBarcodeScanner();
      case 'close-barcode-scanner':
        return closeBarcodeScanner();
      case 'export-report':
        return exportCurrentReport(button.dataset.format);
      case 'export-document':
        return exportClosedDocument(
          button.dataset.id,
          button.dataset.format
        );
      case 'save-member-role':
        return saveMemberRole(button.dataset.userId);
      case 'save-member-permissions':
        return saveMemberPermissions(button.dataset.userId);
    }
  } catch (error) {
    showToast(error.message || String(error));
  }
}

function exportCurrentReport(format) {
  const rows = (state.reportRows || []).map(row => ({
    Producto: row.name,
    SKU: row.sku || '',
    Stock: row.stock,
    Mínimo: row.minStock,
    Máximo: row.maxStock,
    'En tránsito': row.pendingInbound,
    Sugerencia: row.suggestedQuantity,
    'Cobertura días': row.coverageDays ?? '',
    'Consumo diario': row.estimatedDailyConsumption,
    'Consumo ajustado': row.adjustedDailyConsumption,
    Tendencia: row.trendDirection,
    'Cambio tendencia %': row.trendPercentChange ?? '',
    Confianza: row.consumptionConfidence
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `smart_inventory_inventario_${stamp}`;

  if (format === 'csv') {
    downloadCsv(rows, filename);
    showToast('Reporte CSV generado');
    return;
  }

  if (format === 'xlsx') {
    downloadXlsx(rows, filename, {
      sheetName: 'Inventario'
    });
    showToast('Reporte Excel generado');
    return;
  }

  if (format === 'print') {
    printRows({
      title: 'Smart Inventory V2 · Inventario actual',
      subtitle: `Periodo analítico: últimos ${state.reportDays} días`,
      rows,
      meta: [
        {
          label: 'Generado',
          value: formatDate(new Date().toISOString())
        },
        {
          label: 'Productos',
          value: rows.length
        }
      ]
    });
    return;
  }

  throw new Error('Formato de exportación no soportado');
}

async function exportClosedDocument(documentId, format) {
  const documentRecord = await get(
    STORES.DOCUMENTS,
    documentId
  );

  if (!documentRecord) {
    throw new Error('Documento no encontrado');
  }

  if (documentRecord.status === DOCUMENT_STATUS.DRAFT) {
    throw new Error('Primero debes cerrar el documento');
  }

  const lines = await listDocumentLines(documentId);
  const rows = buildDocumentExportRows(
    documentRecord,
    lines
  );
  const prefix = documentTitle(documentRecord.type)
    .toLowerCase()
    .replace(/\s+/g, '-');
  const filename = `smart_inventory_${prefix}_${documentId}`;

  if (format === 'csv') {
    downloadCsv(rows, filename);
    showToast('Documento CSV generado');
    return;
  }

  if (format === 'xlsx') {
    downloadXlsx(rows, filename, {
      sheetName: documentTitle(documentRecord.type)
    });
    showToast('Documento Excel generado');
    return;
  }

  if (format === 'print') {
    printRows({
      title: `Smart Inventory V2 · ${documentTitle(documentRecord.type)}`,
      subtitle: documentRecord.id,
      rows,
      meta: [
        {
          label: 'Estado',
          value: documentRecord.status
        },
        {
          label: 'Cerrado',
          value: formatDate(
            documentRecord.closedAt || documentRecord.updatedAt
          )
        },
        {
          label: 'Referencia',
          value: documentRecord.reference || '—'
        },
        {
          label: 'Destino',
          value: documentRecord.destinationId || '—'
        }
      ]
    });
    return;
  }

  throw new Error('Formato de exportación no soportado');
}

async function openBarcodeScanner() {
  closeBarcodeScanner();

  const overlay = document.createElement('div');
  overlay.className = 'scanner-overlay';
  overlay.id = 'barcodeScannerOverlay';
  overlay.innerHTML = `
    <section class="scanner-dialog" role="dialog" aria-modal="true" aria-label="Escáner de código de barras">
      <div class="row">
        <div>
          <strong>Escanear código</strong>
          <div class="product-meta">Apunta la cámara al código de barras.</div>
        </div>
        <button
          class="danger scanner-close"
          data-action="close-barcode-scanner"
          type="button"
        >Cerrar</button>
      </div>

      <div class="scanner-video-wrap">
        <video id="barcodeScannerVideo"></video>
        <div class="scanner-guide"></div>
      </div>

      <div id="scannerStatus" class="product-meta">
        Iniciando cámara…
      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  const video = document.getElementById('barcodeScannerVideo');
  const status = document.getElementById('scannerStatus');

  try {
    barcodeScannerSession = await startCameraBarcodeScanner({
      videoElement: video,
      onCode: async code => {
        const product = findProductByBarcode(state.products, code);

        if (!product) {
          if (status) {
            status.textContent = `Código ${code} no existe en el catálogo.`;
            status.className = 'status-warning';
          }
          return;
        }

        state.selectedProductId = product.id;
        state.searchResults = [];
        closeBarcodeScanner();
        showToast(`Escaneado: ${product.name}`);
        await render();
      },
      onError: error => {
        if (status) {
          status.textContent =
            error?.message || 'No se pudo leer el código.';
          status.className = 'status-warning';
        }
      }
    });

    if (status) {
      status.textContent = 'Cámara activa · buscando código…';
      status.className = 'status-good';
    }
  } catch (error) {
    if (status) {
      status.textContent = error?.message || String(error);
      status.className = 'status-danger';
    }
  }
}

function closeBarcodeScanner() {
  try {
    barcodeScannerSession?.stop?.();
  } catch (_) {}

  barcodeScannerSession = null;
  document.getElementById('barcodeScannerOverlay')?.remove();
}

async function handleSubmit(event) {
  if (event.target.id === 'memberForm') {
    event.preventDefault();

    try {
      const form = new FormData(event.target);
      await createWorkspaceMember({
        displayName: form.get('displayName'),
        email: form.get('email'),
        roleCode: form.get('roleCode')
      });

      showToast('Usuario agregado al almacén');
      state.members = await listWorkspaceMembers();
      await render();
    } catch (error) {
      showToast(error.message || String(error));
    }
    return;
  }

  if (event.target.id !== 'productForm') return;
  event.preventDefault();

  try {
    const form = new FormData(event.target);
    const minStock = evaluateNumericExpression(form.get('minStock'));
    const maxStock = evaluateNumericExpression(form.get('maxStock'));

    await createProduct({
      name: form.get('name'),
      sku: form.get('sku'),
      barcode: form.get('barcode'),
      minStock,
      maxStock,
      replenishmentMethod: form.get('replenishmentMethod')
    });

    await refreshProducts();
    showToast('Producto guardado');
    scheduleSync();
    await render();
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function handleChange(event) {
  if (event.target.id === 'reportDays') {
    state.reportDays = Number(event.target.value || 30);
    return render();
  }

  if (event.target.id !== 'catalogImportFile') return;

  const file = event.target.files?.[0];
  state.importPreview = null;
  if (!file) return render();

  try {
    showToast('Leyendo archivo…');
    state.importPreview = await readCatalogFile(file);
    await render();
  } catch (error) {
    showToast(error.message || String(error));
    await render();
  }
}

async function handleInput(event) {
  if (event.target.id !== 'productSearch') return;

  const query = event.target.value;
  state.searchResults = query.trim()
    ? await searchProducts(query, { limit: 8 })
    : [];

  const container = document.getElementById('searchResults');
  if (!container) return;

  container.innerHTML = state.searchResults.map(product => `
    <button
      class="search-result"
      data-action="select-product"
      data-product-id="${escapeHtml(product.id)}"
      type="button"
    >
      <strong>${escapeHtml(product.name)}</strong>
      <div class="product-meta">${escapeHtml(product.sku || product.barcode || '')}</div>
    </button>
  `).join('');
}

async function handleKeydown(event) {
  if (event.key !== 'Enter') return;

  if (event.target.id === 'countValue') {
    event.preventDefault();
    return saveCount(event.target.dataset.productId);
  }

  if (event.target.id === 'operationQuantity') {
    event.preventDefault();
    return addOperationLine(state.activeDocumentType);
  }

  if (event.target.id === 'productSearch' && state.searchResults.length) {
    event.preventDefault();
    state.selectedProductId = state.searchResults[0].id;
    state.searchResults = [];
    return render();
  }
}

async function saveMemberRole(userId) {
  const card = document.querySelector(
    `[data-member-card="${cssEscape(userId)}"]`
  );
  if (!card) throw new Error('Miembro no encontrado en pantalla');

  const roleCode = card.querySelector('[data-member-role]')?.value;
  const active = Boolean(
    card.querySelector('[data-member-active]')?.checked
  );

  await updateWorkspaceMember(userId, {
    roleCode,
    active
  });

  showToast('Rol y estado actualizados');
  state.members = await listWorkspaceMembers();
  await refreshSession({ silent: true });
  await render();
}

async function saveMemberPermissions(userId) {
  const card = document.querySelector(
    `[data-member-card="${cssEscape(userId)}"]`
  );
  if (!card) throw new Error('Miembro no encontrado en pantalla');

  const roleCode = card.querySelector('[data-member-role]')?.value;
  const active = Boolean(
    card.querySelector('[data-member-active]')?.checked
  );
  const permissions = [...card.querySelectorAll('[data-member-permission]:checked')]
    .map(input => input.value);

  await updateWorkspaceMember(userId, {
    roleCode,
    permissions,
    active
  });

  showToast('Permisos personalizados guardados');
  state.members = await listWorkspaceMembers();
  await refreshSession({ silent: true });
  await render();
}

async function refreshSession({ silent = false } = {}) {
  try {
    state.session = await getCurrentSession();
    return state.session;
  } catch (error) {
    state.session = null;
    if (!silent) throw error;
    return null;
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\async function applyCatalogPreview() {');
}

async function applyCatalogPreview() {
  const preview = state.importPreview;
  if (!preview?.rows?.length) {
    throw new Error('No hay filas válidas para importar');
  }

  const message =
    `¿Importar ${preview.rows.length} producto(s)? ` +
    'Los existentes se actualizarán por SKU, código de barras o nombre.';

  if (!confirm(message)) return;

  const result = await applyCatalogImport(preview);
  await refreshProducts();
  state.importPreview = null;

  showToast(
    `Importación lista · ${result.created} nuevos · ${result.updated} actualizados`
  );

  scheduleSync(100);
  await render();
}

async function resolveConflict(conflictId, resolution) {
  if (resolution === 'SERVER') {
    if (!confirm('¿Descartar tu cambio local y conservar la versión del servidor?')) {
      return;
    }

    await acceptServerConflict(conflictId);
    showToast('Conflicto resuelto usando servidor');
  } else {
    if (!confirm('¿Reaplicar tu cambio sobre la versión actual del servidor?')) {
      return;
    }

    await reapplyLocalConflict(conflictId);
    showToast('Cambio local rebasado y listo para sincronizar');
    scheduleSync(100);
  }

  await refreshProducts();
  await render();
}

async function createReplenishmentFromSuggestion(button) {
  const requestedQuantity = Number(button.dataset.quantity || 0);
  if (!(requestedQuantity > 0)) {
    throw new Error('La sugerencia no tiene cantidad para reponer');
  }

  await createReplenishment({
    productId: button.dataset.productId,
    method: button.dataset.method,
    requestedQuantity,
    ownerId,
    sourceSuggestion: {
      quantity: requestedQuantity,
      createdAt: new Date().toISOString()
    }
  });

  showToast('Compra/pedido creado como borrador');
  scheduleSync();
  await render();
}

async function setReplenishmentStatus(id, status) {
  await changeReplenishmentStatus(id, status, {
    userId: ownerId
  });

  showToast('Estado actualizado');
  scheduleSync();
  await render();
}

async function startReplenishmentEntry(replenishmentId) {
  const item = await get(STORES.REPLENISHMENTS, replenishmentId);
  if (!item) throw new Error('Compra/pedido no encontrado');

  if (!(Number(item.pendingQuantity) > 0)) {
    throw new Error('No queda mercancía pendiente por recibir');
  }

  const document = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId,
    supplierId: item.supplierId || null,
    metadata: {
      replenishmentId: item.id,
      replenishmentProductId: item.productId
    }
  });

  state.view = 'entry';
  state.activeDocumentId = document.id;
  state.activeDocumentType = DOCUMENT_TYPES.ENTRY;
  state.selectedProductId = item.productId;

  showToast('Entrada vinculada al pedido');
  scheduleSync();
  await render();
}

async function startDocument(type) {
  if (state.products.length === 0) {
    state.view = 'catalog';
    showToast('Primero agrega o importa productos');
    return render();
  }

  if (type === DOCUMENT_TYPES.COUNT) {
    const existingDrafts = await listDraftDocuments({
      ownerId,
      type: DOCUMENT_TYPES.COUNT
    });

    if (existingDrafts.length > 0) {
      const existing = existingDrafts[0];
      state.activeDocumentId = existing.id;
      state.activeDocumentType = type;
      state.selectedProductId = null;
      showToast('Continuando conteo pendiente');
      return render();
    }
  }

  const document = await createDocument({
    type,
    ownerId
  });

  state.activeDocumentId = document.id;
  state.activeDocumentType = type;
  state.selectedProductId = null;
  showToast('Borrador creado');
  scheduleSync();
  await render();
}

async function saveCount(productId) {
  const input = document.getElementById('countValue');
  if (!input) return;

  const countedStock = evaluateNumericExpression(input.value);

  const line = await saveDocumentLine({
    documentId: state.activeDocumentId,
    productId,
    countedStock
  });

  const product = state.products.find(item => item.id === productId);
  const suggestion = getReplenishmentSuggestion(product, {
    stock: countedStock,
    dailyConsumption: 0
  });

  if (suggestion.suggestedQuantity > 0) {
    showToast(`Guardado · sugerencia mínima: ${suggestion.suggestedQuantity}`);
  } else {
    showToast('Guardado');
  }

  scheduleSync();
  await render();
}

async function addOperationLine(type) {
  const activeDocument = await get(
    STORES.DOCUMENTS,
    state.activeDocumentId
  );
  const linkedReplenishment = activeDocument?.metadata?.replenishmentId
    ? await get(
        STORES.REPLENISHMENTS,
        activeDocument.metadata.replenishmentId
      )
    : null;

  const productId = linkedReplenishment?.productId ||
    state.selectedProductId;

  if (!productId) throw new Error('Selecciona un producto');

  const quantityInput = document.getElementById('operationQuantity');
  const quantity = evaluateNumericExpression(quantityInput?.value);

  if (!(quantity > 0)) throw new Error('La cantidad debe ser mayor que cero');

  const lines = await listDocumentLines(state.activeDocumentId);
  const lotNumber = type === DOCUMENT_TYPES.ENTRY
    ? document.getElementById('lotNumber')?.value?.trim() || ''
    : '';

  const existing = lines.find(line =>
    line.productId === productId &&
    (type !== DOCUMENT_TYPES.ENTRY || (line.lotNumber || '') === lotNumber)
  );

  const accumulatedQuantity = Number(existing?.quantity || 0) + quantity;

  if (
    linkedReplenishment &&
    accumulatedQuantity > Number(linkedReplenishment.pendingQuantity || 0)
  ) {
    throw new Error(
      `Solo quedan ${linkedReplenishment.pendingQuantity} pendientes por recibir`
    );
  }

  const data = {
    id: existing?.id,
    documentId: state.activeDocumentId,
    productId,
    quantity: accumulatedQuantity
  };

  if (type === DOCUMENT_TYPES.ENTRY) {
    const unitCostRaw = document.getElementById('unitCost')?.value?.trim();
    data.unitCost = unitCostRaw
      ? evaluateNumericExpression(unitCostRaw)
      : null;
    data.lotNumber = lotNumber;
    data.expiresAt = document.getElementById('expiresAt')?.value || null;
  }

  await saveDocumentLine(data);

  state.selectedProductId = null;
  showToast('Línea guardada');
  scheduleSync();
  await render();
}

async function cancelDraft(documentId) {
  if (!confirm('¿Cancelar este borrador? No afectará el inventario y quedará registrado en el historial.')) {
    return;
  }

  await cancelDocument(documentId, { userId: ownerId });

  if (state.activeDocumentId === documentId) {
    state.activeDocumentId = null;
    state.activeDocumentType = null;
    state.selectedProductId = null;
  }

  showToast('Borrador cancelado');
  scheduleSync();
  await render();
}

async function finishDocument() {
  const label = documentTitle(state.activeDocumentType).toLowerCase();
  if (!confirm(`¿Cerrar ${label}? Después del cierre ya afecta el inventario.`)) {
    return;
  }

  const result = await closeDocument(state.activeDocumentId, { userId: ownerId });

  if (
    result.document?.type === DOCUMENT_TYPES.ENTRY &&
    result.document?.metadata?.replenishmentId
  ) {
    await reconcileReplenishmentReceipts();
  }

  state.activeDocumentId = null;
  state.activeDocumentType = null;
  state.selectedProductId = null;

  showToast(`Cerrado · ${result.movements?.length || 0} movimientos generados`);
  scheduleSync();
  await render();
}

function mathPad(targetId) {
  return `
    <div class="math-pad" aria-label="Operaciones matemáticas">
      ${mathButton(targetId, '+', '+')}
      ${mathButton(targetId, '-', '−')}
      ${mathButton(targetId, '*', '×')}
      ${mathButton(targetId, '/', '÷')}
      ${mathButton(targetId, '(', '(')}
      ${mathButton(targetId, ')', ')')}
    </div>
  `;
}

function mathButton(target, symbol, label) {
  return `
    <button
      data-math-target="${target}"
      data-symbol="${symbol}"
      type="button"
      aria-label="${label}"
    >${label}</button>
  `;
}

function insertMathSymbol(targetId, symbol) {
  const input = document.getElementById(targetId);
  if (!input) return;

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + symbol + input.value.slice(end);
  input.focus();
  const cursor = start + symbol.length;
  input.setSelectionRange(cursor, cursor);
}

function renderCatalogImportPreview(preview) {
  const rows = preview.rows || [];
  const errors = preview.errors || [];
  const warnings = preview.warnings || [];

  return `
    <div class="stack" style="border-top:1px solid var(--border);padding-top:12px">
      <div class="row">
        <div>
          <strong>${escapeHtml(preview.fileName || 'Archivo')}</strong>
          <div class="product-meta">
            Hoja ${escapeHtml(preview.sheetName || '—')}
          </div>
        </div>
        <span class="badge">${rows.length} válidos</span>
        <span class="badge">${errors.length} errores</span>
      </div>

      ${warnings.length ? `
        <div class="stack">
          ${warnings.slice(0, 8).map(warning => `
            <div class="status-warning">⚠ ${escapeHtml(warning)}</div>
          `).join('')}
        </div>
      ` : ''}

      ${errors.length ? `
        <details>
          <summary><strong>Ver errores (${errors.length})</strong></summary>
          <div class="stack" style="margin-top:8px">
            ${errors.slice(0, 20).map(error => `
              <div class="status-danger">${escapeHtml(error)}</div>
            `).join('')}
            ${errors.length > 20
              ? `<div class="product-meta">…y ${errors.length - 20} errores más.</div>`
              : ''}
          </div>
        </details>
      ` : ''}

      ${rows.length ? `
        <div>
          <strong>Vista previa</strong>
          <div class="stack" style="margin-top:8px">
            ${rows.slice(0, 10).map(row => `
              <div class="cart-line">
                <div>
                  <strong>${escapeHtml(row.name)}</strong>
                  <div class="product-meta">
                    ${row.sku ? 'SKU ' + escapeHtml(row.sku) + ' · ' : ''}
                    Min ${row.minStock} · Max ${row.maxStock || '—'} ·
                    ${escapeHtml(row.unitCode)}
                    ${row.categoryName ? ' · ' + escapeHtml(row.categoryName) : ''}
                  </div>
                </div>
                <span class="badge">Fila ${row.excelRow}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <button class="success" data-action="apply-catalog-import" type="button">
          Importar ${rows.length} producto(s)
        </button>
      ` : '<div class="empty">No hay filas válidas para importar.</div>'}
    </div>
  `;
}

function trendLabel(row) {
  if (row.trendConfidence === 'INSUFFICIENT') {
    return '<span class="product-meta">Sin historial</span>';
  }

  const arrow = row.trendDirection === 'UP'
    ? '↑'
    : row.trendDirection === 'DOWN'
      ? '↓'
      : '→';

  const className = row.trendDirection === 'UP'
    ? 'status-warning'
    : row.trendDirection === 'DOWN'
      ? 'status-good'
      : '';

  const percent = row.trendPercentChange === null
    ? ''
    : ' ' + formatSigned(row.trendPercentChange) + '%';

  return `<span class="${className}"><strong>${arrow}${percent}</strong></span>`;
}

function renderReplenishmentCreateButtons(product, quantity) {
  if (!product || !(Number(quantity) > 0)) return '';

  const method = product.replenishmentMethod;

  if (method === REPLENISHMENT_METHODS.NONE) {
    return '<span class="product-meta">Sin reposición automática</span>';
  }

  const buttons = [];

  if (
    method === REPLENISHMENT_METHODS.PURCHASE ||
    method === REPLENISHMENT_METHODS.BOTH
  ) {
    buttons.push(`
      <button
        class="secondary"
        data-action="create-replenishment"
        data-product-id="${escapeHtml(product.id)}"
        data-method="PURCHASE"
        data-quantity="${Number(quantity)}"
        type="button"
      >Compra</button>
    `);
  }

  if (
    method === REPLENISHMENT_METHODS.ORDER ||
    method === REPLENISHMENT_METHODS.BOTH
  ) {
    buttons.push(`
      <button
        class="secondary"
        data-action="create-replenishment"
        data-product-id="${escapeHtml(product.id)}"
        data-method="ORDER"
        data-quantity="${Number(quantity)}"
        type="button"
      >Pedido</button>
    `);
  }

  return buttons.join('');
}

function renderReplenishmentStatusButtons(item) {
  const buttons = [];

  if (item.status === REPLENISHMENT_STATUS.DRAFT) {
    buttons.push(`
      <button
        class="primary"
        data-action="set-replenishment-status"
        data-id="${escapeHtml(item.id)}"
        data-status="${REPLENISHMENT_STATUS.ORDERED}"
        type="button"
      >Confirmar pedido</button>
    `);
  }

  if (item.status === REPLENISHMENT_STATUS.ORDERED) {
    buttons.push(`
      <button
        class="secondary"
        data-action="set-replenishment-status"
        data-id="${escapeHtml(item.id)}"
        data-status="${REPLENISHMENT_STATUS.IN_TRANSIT}"
        type="button"
      >Marcar en tránsito</button>
    `);
  }

  if (
    item.status === REPLENISHMENT_STATUS.ORDERED ||
    item.status === REPLENISHMENT_STATUS.IN_TRANSIT ||
    item.status === REPLENISHMENT_STATUS.PARTIALLY_RECEIVED
  ) {
    buttons.push(`
      <button
        class="success"
        data-action="receive-replenishment"
        data-id="${escapeHtml(item.id)}"
        type="button"
      >Recibir</button>
    `);
  }

  if (
    item.status !== REPLENISHMENT_STATUS.RECEIVED &&
    item.status !== REPLENISHMENT_STATUS.CANCELLED
  ) {
    buttons.push(`
      <button
        class="danger"
        data-action="set-replenishment-status"
        data-id="${escapeHtml(item.id)}"
        data-status="${REPLENISHMENT_STATUS.CANCELLED}"
        type="button"
      >Cancelar</button>
    `);
  }

  return buttons.join('');
}

function replenishmentStatusLabel(status) {
  switch (status) {
    case REPLENISHMENT_STATUS.DRAFT:
      return 'Borrador';
    case REPLENISHMENT_STATUS.ORDERED:
      return 'Realizado';
    case REPLENISHMENT_STATUS.IN_TRANSIT:
      return 'En tránsito';
    case REPLENISHMENT_STATUS.PARTIALLY_RECEIVED:
      return 'Recibido parcial';
    case REPLENISHMENT_STATUS.RECEIVED:
      return 'Recibido';
    case REPLENISHMENT_STATUS.CANCELLED:
      return 'Cancelado';
    default:
      return status || '—';
  }
}

function dashboardMetric(value, label, detail) {
  return `
    <div class="card dashboard-metric">
      <strong>${formatNumber(value)}</strong>
      <div class="dashboard-metric-label">${escapeHtml(label)}</div>
      <div class="product-meta">${escapeHtml(detail)}</div>
    </div>
  `;
}

function movementTypeLabel(type) {
  switch (type) {
    case 'ENTRY':
      return 'Entrada';
    case 'SUPPLY':
      return 'Surtido';
    case 'ADJUSTMENT':
      return 'Ajuste';
    case 'REVERSAL':
      return 'Reverso';
    case 'TRANSFER':
      return 'Transferencia';
    default:
      return type || 'Movimiento';
  }
}

function movementDisplayQuantity(movement) {
  if (movement.type === 'ADJUSTMENT' || movement.type === 'REVERSAL') {
    return formatSigned(movement.delta);
  }

  const quantity = Number(movement.quantity || 0);
  if (movement.type === 'SUPPLY') return '-' + formatNumber(quantity);
  return '+' + formatNumber(quantity);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';

  return new Intl.NumberFormat('es', {
    maximumFractionDigits: 3
  }).format(number);
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('es', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function actionCard(view, title, subtitle) {
  return `
    <button class="card action-card" data-open-view="${view}" type="button">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </button>
  `;
}

async function refreshProducts() {
  state.products = await listProducts();
}

async function refreshSaveStatus() {
  const pending = await getPendingSyncCount();
  saveStatus.textContent = pending
    ? `✓ Local · ${pending} pendientes de servidor`
    : '✓ Guardado local';
}

async function getPendingSyncCount() {
  const items = await getAll(STORES.SYNC_QUEUE);
  return items.filter(item =>
    item.status === 'PENDING' ||
    item.status === 'FAILED' ||
    item.status === 'CONFLICT'
  ).length;
}

function getLocalOwnerId() {
  // Identidad lógica temporal para poder continuar el mismo trabajo
  // desde varios dispositivos durante el desarrollo.
  // En producción será reemplazada por el UID autenticado.
  const key = 'smart_inventory_v2_dev_user_key';
  let id = localStorage.getItem(key);

  if (!id) {
    id = 'almacenista-dev';
    localStorage.setItem(key, id);
  }

  return id;
}

function replenishmentLabel(method) {
  switch (method) {
    case REPLENISHMENT_METHODS.PURCHASE:
      return 'Compra';
    case REPLENISHMENT_METHODS.ORDER:
      return 'Pedido';
    case REPLENISHMENT_METHODS.BOTH:
      return 'Compra o pedido';
    case REPLENISHMENT_METHODS.NONE:
      return 'Sin reposición automática';
    default:
      return method || '—';
  }
}

function documentTitle(type) {
  switch (type) {
    case DOCUMENT_TYPES.COUNT:
      return 'Conteo';
    case DOCUMENT_TYPES.ENTRY:
      return 'Entrada';
    case DOCUMENT_TYPES.SUPPLY:
      return 'Surtido';
    default:
      return 'Documento';
  }
}

function documentSubtitle(type) {
  switch (type) {
    case DOCUMENT_TYPES.COUNT:
      return 'Cuenta producto por producto. Cada Enter se guarda inmediatamente.';
    case DOCUMENT_TYPES.ENTRY:
      return 'Registra mercancía recibida con costo, lote y vencimiento opcionales.';
    case DOCUMENT_TYPES.SUPPLY:
      return 'Prepara la salida interna como un carrito y ciérrala cuando esté lista.';
    default:
      return '';
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es');
}

function formatSigned(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
  refreshSaveStatus().catch(() => {});
}

function bindSyncLifecycle() {
  onSyncStatus(status => {
    if (!saveStatus) return;

    switch (status.state) {
      case 'syncing':
        saveStatus.textContent = '↻ Sincronizando…';
        break;
      case 'synced':
        saveStatus.textContent = '☁ Sincronizado';
        break;
      case 'offline':
        saveStatus.textContent = '✓ Guardado local · sin conexión';
        break;
      case 'disabled':
        saveStatus.textContent = '✓ Guardado local · sync desactivado';
        break;
      case 'conflict':
        saveStatus.textContent = '⚠ Conflicto pendiente de revisión';
        break;
      case 'error':
        saveStatus.textContent = '✓ Guardado local · servidor pendiente';
        break;
    }
  });

  window.addEventListener('online', () => {
    syncAndRefresh({ renderAfter: true }).catch(() => {});
  });

  window.addEventListener('offline', () => {
    refreshSaveStatus().catch(() => {});
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncAndRefresh({ renderAfter: true }).catch(() => {});
    }
  });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    syncAndRefresh({ renderAfter: true }).catch(() => {});
  }, 15000);
}

function scheduleSync(delay = 350) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncAndRefresh({ renderAfter: false }).catch(() => {});
  }, delay);
}

async function syncAndRefresh({ renderAfter = false } = {}) {
  const result = await syncNow({
    localUserId: ownerId,
    displayName: 'Usuario local'
  });

  if (result?.ok && result.pulled > 0) {
    await refreshProducts();

    const reconciled = await reconcileReplenishmentReceipts();
    if (reconciled.length > 0) scheduleSync(100);

    if (renderAfter && canAutoRefresh()) await render();
  }

  await refreshSaveStatus();
  return result;
}

function canAutoRefresh() {
  const active = document.activeElement;
  if (!active) return true;

  const tag = active.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return false;
  }

  return true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  navigator.serviceWorker.register('./sw.js').catch(error => {
    console.warn('Service Worker no disponible:', error);
  });
}

function renderFatal(error) {
  console.error(error);
  saveStatus.textContent = 'Error de inicio';
  appRoot.innerHTML = `
    <section class="card">
      <h2>No se pudo iniciar Smart Inventory V2</h2>
      <p>${escapeHtml(error?.message || String(error))}</p>
    </section>
  `;
}
