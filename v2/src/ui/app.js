import { createLocalId } from '../core/ids.js';
import { evaluateNumericExpression } from '../core/mathExpression.js';
import { REPLENISHMENT_METHODS } from '../core/catalog.js';
import {
  seedDefaultUnits,
  createProduct,
  updateProduct,
  listProducts,
  searchProducts
} from '../catalog/catalogService.js';
import {
  readCatalogFile,
  applyCatalogImport,
  downloadSaintInitialLoadTemplate
} from '../catalog/catalogExcel.js';
import {
  buildProductPayloadFromEditor,
  catalogPresentationSummary,
  catalogQuantityDisplay,
  catalogUnitCode,
  renderCatalogProductEditor
} from '../catalog/catalogUi.js';
import {
  buildSaintInitialLoadDraft,
  enqueueSaintInitialLoad,
  getLocalSaintInitialLoadStatus,
  saintInitialLoadSummary
} from '../catalog/saintInitialLoad.js';
import {
  analyzeCatalogImportConflicts
} from '../catalog/catalogImportGuard.js';
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
  closeDocument,
  createCorrectionDraft
} from '../documents/documentService.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS
} from '../documents/documentTypes.js';
import {
  getReplenishmentSuggestion
} from '../intelligence/replenishmentEngine.js';
import {
  reverseMovement
} from '../inventory/movementService.js';
import {
  listAuditEvents
} from '../audit/auditClient.js';
import {
  syncNow,
  onSyncStatus
} from '../sync/syncEngine.js';
import {
  discoverServerAuthMode,
  bootstrapFirebaseAccess,
  selectFirebaseWorkspace
} from '../auth/authBootstrap.js';
import {
  initializeFirebaseClient,
  loginWithGoogle,
  logoutFirebase,
  refreshFirebaseToken,
  firebaseUserSummary
} from '../auth/firebaseClient.js';
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
  view: readInitialView(),
  products: [],
  activeDocumentId: null,
  activeDocumentType: null,
  selectedProductId: null,
  searchResults: [],
  importPreview: null,
  saintInitialLoadDraft: null,
  editingProductId: null,
  reportDays: 30,
  reportRows: [],
  session: null,
  members: [],
  auditEvents: [],
  authMode: 'dev',
  authUser: null,
  availableWorkspaces: [],
  workspaceReady: false,
  authAccessOffline: false
};

const devOwnerId = getLocalOwnerId();
let syncTimer = null;
let barcodeScannerSession = null;
let installPromptEvent = null;
let authLifecycleReady = false;
let authTransitionInProgress = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    await openDatabase();
    await seedDefaultUnits();
    bindGlobalEvents();
    bindInstallPrompt();
    registerServiceWorker();
    bindSyncLifecycle();

    const authState = await initializeApplicationAuth();

    if (authState === 'signed-out') {
      updateAuthUi();
      return renderAuthGate();
    }

    if (authState === 'workspace-required') {
      updateAuthUi();
      return renderWorkspaceGate();
    }

    await startAuthenticatedApp();
  } catch (error) {
    renderFatal(error);
  }
}

function bindGlobalEvents() {
  document.getElementById('authButton')?.addEventListener('click', () => {
    handleAuthButton().catch(error => showToast(error.message || String(error)));
  });

  document.getElementById('homeButton')?.addEventListener('click', () => {
    openShellView('home').catch(error =>
      showToast(error.message || String(error))
    );
  });

  document.getElementById('mobileMenu')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });

  document.getElementById('sidebarBackdrop')?.addEventListener('click', () => {
    closeMobileSidebar();
  });

  document.querySelectorAll('.app-nav').forEach(nav => {
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-view]');
      if (!button || button.hidden) return;

      openShellView(button.dataset.view).catch(error =>
        showToast(error.message || String(error))
      );
    });
  });

  const globalSearch = document.getElementById('globalSearch');

  globalSearch?.addEventListener('input', event => {
    renderGlobalSearchResults(event.target.value)
      .catch(() => hideGlobalSearchResults());
  });

  globalSearch?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideGlobalSearchResults();
      event.target.blur();
    }
  });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      globalSearch?.focus();
      globalSearch?.select();
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.global-search-wrap')) {
      hideGlobalSearchResults();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeMobileSidebar();
  });

  appRoot.addEventListener('click', handleClick);
  appRoot.addEventListener('submit', handleSubmit);
  appRoot.addEventListener('input', handleInput);
  appRoot.addEventListener('change', handleChange);
  appRoot.addEventListener('keydown', handleKeydown);
}

async function openShellView(view) {
  state.view = view;
  state.activeDocumentId = null;
  state.activeDocumentType = null;
  state.selectedProductId = null;
  state.searchResults = [];
  closeMobileSidebar();
  hideGlobalSearchResults();
  await render();
}

function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
}

async function renderGlobalSearchResults(rawQuery) {
  const container =
    document.getElementById('globalSearchResults');

  if (!container) return;

  const query = String(rawQuery || '').trim();

  if (query.length < 2) {
    hideGlobalSearchResults();
    return;
  }

  const products = await searchProducts(query, {
    limit: 6
  });

  container.innerHTML = products.length
    ? products.map(product => `
      <button
        class="global-search-result"
        data-global-product-id="${escapeHtml(product.id)}"
        type="button"
      >
        <span class="global-result-icon">▣</span>
        <span>
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(product.sku || product.barcode || 'Producto')}</small>
        </span>
        <span class="global-result-action">Catálogo →</span>
      </button>
    `).join('')
    : '<div class="global-search-empty">Sin coincidencias</div>';

  container.hidden = false;

  container.querySelectorAll('[data-global-product-id]').forEach(button => {
    button.addEventListener('click', () => {
      openShellView('catalog').catch(error =>
        showToast(error.message || String(error))
      );
    });
  });
}

function hideGlobalSearchResults() {
  const container =
    document.getElementById('globalSearchResults');

  if (container) {
    container.hidden = true;
    container.innerHTML = '';
  }
}

async function initializeApplicationAuth() {
  const config = await discoverServerAuthMode();
  state.authMode = config.authMode || 'dev';

  if (state.authMode !== 'firebase') {
    state.authUser = null;
    state.availableWorkspaces = [];
    state.workspaceReady = true;
    state.authAccessOffline = false;
    updateAuthUi();
    updateNavigationUi();
    return 'authenticated';
  }

  const user = await initializeFirebaseClient({
    onUserChanged:
      handleFirebaseAuthStateChanged
  });

  state.authUser = firebaseUserSummary(user);
  authLifecycleReady = true;
  updateAuthUi();

  if (!state.authUser) {
    state.availableWorkspaces = [];
    state.workspaceReady = false;
    state.authAccessOffline = false;
    updateNavigationUi();
    return 'signed-out';
  }

  const access = await bootstrapFirebaseAccess({
    uid: state.authUser.uid
  });

  state.availableWorkspaces = access.workspaces || [];
  state.workspaceReady = Boolean(access.selectedWorkspace);
  state.authAccessOffline = Boolean(access.offline);

  if (access.offline && access.selectedWorkspace) {
    state.session = sessionFromCachedAccess(access);
  }

  updateNavigationUi();

  return access.selectedWorkspace
    ? 'authenticated'
    : 'workspace-required';
}

async function startAuthenticatedApp() {
  await refreshProducts();
  await syncAndRefresh({ renderAfter: false });
  await refreshProducts();

  if (navigator.onLine) {
    await refreshSession({ silent: true });
    state.authAccessOffline = false;
  }

  updateAuthUi();
  updateNavigationUi();
  await render();
}

function renderAuthGate() {
  appRoot.innerHTML = `
    <section class="auth-gate">
      <article class="card auth-card stack">
        <div class="auth-mark">S2</div>
        <div>
          <h1>Smart Inventory V2</h1>
          <p class="product-meta">
            Inicia sesión con una cuenta autorizada para este almacén.
          </p>
        </div>

        <button
          class="primary auth-login-button"
          data-action="login-google"
          type="button"
        >Continuar con Google</button>

        <div class="product-meta">
          El acceso al inventario y a la sincronización se valida otra vez en el servidor.
        </div>
      </article>
    </section>
  `;
}

function renderWorkspaceGate() {
  appRoot.innerHTML = `
    <section class="auth-gate">
      <article class="card auth-card stack">
        <div class="auth-mark">S2</div>
        <div>
          <h1>Selecciona el almacén</h1>
          <p class="product-meta">
            Tu cuenta tiene acceso a más de un workspace.
          </p>
        </div>

        <div class="stack">
          ${state.availableWorkspaces.map(workspace => `
            <button
              class="secondary workspace-choice"
              data-action="select-workspace"
              data-workspace-id="${escapeHtml(workspace.id)}"
              type="button"
            >
              <strong>${escapeHtml(workspace.name || workspace.workspaceKey || workspace.id)}</strong>
              <span>
                ${escapeHtml(workspace.roleCode || '')}
                ${workspace.workspaceKey ? ' · ' + escapeHtml(workspace.workspaceKey) : ''}
              </span>
            </button>
          `).join('')}
        </div>

        <button
          class="ghost-button auth-secondary-action"
          data-action="logout-auth"
          type="button"
        >Usar otra cuenta</button>
      </article>
    </section>
  `;
}

async function signInWithGoogle() {
  authTransitionInProgress = true;

  try {
    const user = await loginWithGoogle();

    if (!user) {
      showToast(
        'Abriendo inicio de sesión seguro…'
      );
      return;
    }

    state.authUser =
      firebaseUserSummary(user);

    if (!state.authUser) {
      throw new Error(
        'No se completó el inicio de sesión'
      );
    }

    const access =
      await bootstrapFirebaseAccess({
        uid: state.authUser.uid
      });

    state.availableWorkspaces =
      access.workspaces || [];
    state.workspaceReady =
      Boolean(access.selectedWorkspace);
    state.authAccessOffline =
      Boolean(access.offline);

    updateAuthUi();
    updateNavigationUi();
    showToast('Sesión iniciada');

    if (!access.selectedWorkspace) {
      renderWorkspaceGate();
      return;
    }

    await startAuthenticatedApp();
  } finally {
    authTransitionInProgress = false;
  }
}

async function chooseWorkspace(workspaceId) {
  const allowed = state.availableWorkspaces.some(
    workspace => workspace.id === workspaceId
  );

  if (!allowed) {
    throw new Error('Ese almacén no está autorizado para tu cuenta');
  }

  const previousWorkspaceId =
    state.session?.workspaceId || null;

  await selectFirebaseWorkspace(workspaceId);
  state.workspaceReady = true;
  state.authAccessOffline = false;

  const selected = state.availableWorkspaces.find(
    workspace => workspace.id === workspaceId
  );

  if (selected) {
    state.session = {
      workspaceId,
      userId: state.authUser?.uid || null,
      roleCode: selected.roleCode || null,
      permissions: selected.permissions || [],
      authMode: 'firebase'
    };
  }

  if (previousWorkspaceId !== workspaceId) {
    resetWorkspaceUiState();
  }

  updateNavigationUi();
  showToast('Almacén seleccionado');
  await startAuthenticatedApp();
}

async function handleAuthButton() {
  if (state.authMode !== 'firebase') return;

  if (!state.authUser) {
    return signInWithGoogle();
  }

  authTransitionInProgress = true;

  try {
    await logoutFirebase();
  } finally {
    authTransitionInProgress = false;
  }

  state.authUser = null;
  state.session = null;
  state.availableWorkspaces = [];
  state.workspaceReady = false;
  state.authAccessOffline = false;
  state.products = [];
  state.activeDocumentId = null;
  state.activeDocumentType = null;
  state.selectedProductId = null;
  updateAuthUi();
  showToast('Sesión cerrada');
  renderAuthGate();
}

function handleFirebaseAuthStateChanged(user) {
  const previousUid =
    state.authUser?.uid || null;
  const nextUser =
    firebaseUserSummary(user);

  state.authUser = nextUser;
  updateAuthUi();

  if (
    !authLifecycleReady ||
    authTransitionInProgress
  ) {
    return;
  }

  if (!nextUser) {
    lockAuthenticatedUi();
    showToast('La sesión terminó');
    renderAuthGate();
    return;
  }

  if (previousUid !== nextUser.uid) {
    handleFirebaseAccountTransition(
      nextUser
    ).catch(error => {
      lockAuthenticatedUi();
      showToast(
        error?.message ||
        'No se pudo cambiar la sesión'
      );
      renderAuthGate();
    });
  }
}

async function handleFirebaseAccountTransition(
  user
) {
  state.session = null;
  state.availableWorkspaces = [];
  state.workspaceReady = false;
  state.authAccessOffline = false;
  resetWorkspaceUiState();
  updateNavigationUi();

  const access =
    await bootstrapFirebaseAccess({
      uid: user.uid
    });

  state.availableWorkspaces =
    access.workspaces || [];
  state.workspaceReady =
    Boolean(access.selectedWorkspace);
  state.authAccessOffline =
    Boolean(access.offline);

  if (
    access.offline &&
    access.selectedWorkspace
  ) {
    state.session =
      sessionFromCachedAccess(access);
  }

  if (!access.selectedWorkspace) {
    updateNavigationUi();
    renderWorkspaceGate();
    return;
  }

  await startAuthenticatedApp();
}

function lockAuthenticatedUi() {
  state.session = null;
  state.availableWorkspaces = [];
  state.workspaceReady = false;
  state.authAccessOffline = false;
  resetWorkspaceUiState();
  updateAuthUi();
  updateNavigationUi();
}

function resetWorkspaceUiState() {
  state.products = [];
  state.activeDocumentId = null;
  state.activeDocumentType = null;
  state.selectedProductId = null;
  state.searchResults = [];
  state.importPreview = null;
  state.reportRows = [];
  state.members = [];
  state.auditEvents = [];
  state.importPreview = null;
  state.saintInitialLoadDraft = null;
  state.editingProductId = null;
  state.view = 'home';
}

function updateAuthUi() {
  const userStatus = document.getElementById('authUserStatus');
  const authButton = document.getElementById('authButton');

  if (!userStatus || !authButton) return;

  if (state.authMode !== 'firebase') {
    userStatus.hidden = true;
    authButton.hidden = true;
    return;
  }

  authButton.hidden = false;

  if (state.authUser) {
    userStatus.hidden = false;
    const identityLabel =
      state.authUser.displayName ||
      state.authUser.email ||
      'Usuario';
    const roleLabel =
      state.session?.roleCode === 'GOD'
        ? ' · DIOS 👑'
        : state.session?.roleCode
          ? ' · ' + state.session.roleCode
          : '';

    userStatus.textContent =
      identityLabel + roleLabel;

    const avatar =
      document.getElementById('profileAvatar');

    if (avatar) {
      const initials = identityLabel
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase();

      avatar.textContent =
        state.session?.roleCode === 'GOD'
          ? '👑'
          : initials || 'S2';
    }

    authButton.textContent = 'Salir';
  } else {
    userStatus.hidden = true;
    authButton.textContent = 'Iniciar sesión';

    const avatar =
      document.getElementById('profileAvatar');

    if (avatar) avatar.textContent = 'S2';
  }
}

function sessionFromCachedAccess(access) {
  const workspace = access?.selectedWorkspace;
  if (!workspace) return null;

  return {
    workspaceId: workspace.id,
    userId:
      access.user?.id ||
      access.user?.externalAuthId ||
      state.authUser?.uid ||
      null,
    externalAuthId:
      access.user?.externalAuthId ||
      state.authUser?.uid ||
      null,
    email:
      access.user?.email ||
      state.authUser?.email ||
      null,
    roleCode: workspace.roleCode || null,
    permissions: workspace.permissions || [],
    authMode: 'firebase',
    cachedOffline: true
  };
}

function updateNavigationUi() {
  const homeButton = document.getElementById('homeButton');

  const locked =
    state.authMode === 'firebase' &&
    (!state.authUser || !state.workspaceReady);

  document.body.classList.toggle(
    'auth-locked',
    locked
  );

  document.querySelectorAll('.app-nav').forEach(nav => {
    nav.hidden = locked;

    nav.querySelectorAll('[data-view]').forEach(button => {
      const allowed =
        !locked &&
        canOpenView(button.dataset.view);

      button.hidden = !allowed;

      const active =
        allowed &&
        button.dataset.view === state.view;

      button.classList.toggle('active', active);
      button.setAttribute(
        'aria-current',
        active ? 'page' : 'false'
      );
    });
  });

  if (homeButton) {
    homeButton.hidden = locked;
  }

  if (locked) {
    closeMobileSidebar();
    hideGlobalSearchResults();
  }
}

function hasClientPermission(permission) {
  if (
    state.authMode === 'dev' &&
    !state.session
  ) {
    return true;
  }

  return can(state.session, permission);
}

function hasAnyClientPermission(permissions = []) {
  return permissions.some(
    permission => hasClientPermission(permission)
  );
}

function canOpenView(view) {
  switch (view) {
    case 'home':
    case 'conflicts':
      return true;
    case 'catalog':
      return hasAnyClientPermission([
        'catalog.view',
        'catalog.write'
      ]);
    case 'count':
      return hasClientPermission('count.write');
    case 'entry':
      return hasClientPermission('entry.write');
    case 'supply':
      return hasClientPermission('supply.write');
    case 'replenishment':
      return hasClientPermission('purchases.write');
    case 'reports':
      return hasClientPermission('reports.view');
    case 'alerts':
      return true;
    case 'settings':
      return hasAnyClientPermission([
        'users.manage',
        'audit.view'
      ]);
    case 'users':
      return hasClientPermission('users.manage');
    case 'audit':
      return hasClientPermission('audit.view');
    default:
      return false;
  }
}

function requireClientPermission(
  permission,
  message = null
) {
  if (hasClientPermission(permission)) return;

  const error = new Error(
    message || `Permiso requerido: ${permission}`
  );
  error.code = 'PERMISSION_DENIED';
  throw error;
}

function permissionForDocumentTypeClient(type) {
  switch (type) {
    case DOCUMENT_TYPES.COUNT:
      return 'count.write';
    case DOCUMENT_TYPES.ENTRY:
      return 'entry.write';
    case DOCUMENT_TYPES.SUPPLY:
      return 'supply.write';
    default:
      return 'adjustment.write';
  }
}

function renderAccessDenied(view) {
  appRoot.innerHTML = `
    <section class="hero">
      <h2>Acceso restringido</h2>
      <p>No tienes permiso para abrir esta sección.</p>
    </section>

    <section class="card stack">
      <div class="status-warning">
        Vista solicitada: <strong>${escapeHtml(view || '—')}</strong>
      </div>
      <button
        class="primary"
        data-open-view="home"
        type="button"
      >Volver al inicio</button>
    </section>
  `;
}

function currentOwnerId() {
  if (state.authMode === 'firebase') {
    if (!state.authUser?.uid) {
      throw new Error('Sesión autenticada requerida');
    }
    return state.authUser.uid;
  }

  return devOwnerId;
}

async function render() {
  if (
    state.authMode === 'firebase' &&
    (!state.authUser || !state.workspaceReady)
  ) {
    updateNavigationUi();

    if (!state.authUser) {
      return renderAuthGate();
    }

    return renderWorkspaceGate();
  }

  await refreshSaveStatus();
  updateNavigationUi();

  if (
    state.view !== 'home' &&
    !canOpenView(state.view)
  ) {
    return renderAccessDenied(state.view);
  }

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
    case 'alerts':
      return renderAlerts();
    case 'settings':
      return renderSettings();
    case 'conflicts':
      return renderConflicts();
    case 'users':
      return renderUsers();
    case 'audit':
      return renderAudit();
    default:
      return renderHome();
  }
}

async function renderHome() {
  const snapshot = await getDashboardSnapshot();
  const productById = new Map(
    state.products.map(product => [product.id, product])
  );

  const currentWorkspace =
    state.availableWorkspaces.find(
      workspace =>
        workspace.id === state.session?.workspaceId
    ) ||
    state.availableWorkspaces[0] ||
    null;

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          ${escapeHtml(currentWorkspace?.name || 'Almacén principal')}
        </div>
        <h1>Dashboard</h1>
        <p>Visión operativa del almacén en tiempo real, calculada desde movimientos y lotes.</p>
      </div>
      <div class="dashboard-sync">
        ${state.availableWorkspaces.length > 1
          ? '<button class="secondary" data-action="show-workspace-picker" type="button">Cambiar almacén</button>'
          : ''}
        ${installPromptEvent
          ? '<button class="secondary" data-action="install-pwa" type="button">Instalar app</button>'
          : ''}
        ${snapshot.syncConflictCount
          ? `<button class="secondary status-warning" data-open-view="conflicts" type="button">⚠ ${snapshot.syncConflictCount} conflicto(s)</button>`
          : snapshot.pendingSyncCount
            ? `<span class="badge status-warning">${snapshot.pendingSyncCount} pendientes</span>`
            : navigator.onLine
              ? '<span class="badge status-good">● Todo sincronizado</span>'
              : '<span class="badge status-warning">Modo offline</span>'}
        <button class="primary" data-open-view="count" type="button">＋ Nuevo conteo</button>
      </div>
    </section>

    <section class="grid dashboard-grid">
      ${dashboardMetric(
        snapshot.inventorySummary.products,
        'Productos',
        'Activos en catálogo'
      )}
      ${dashboardMetric(
        snapshot.inventorySummary.critical + snapshot.inventorySummary.low,
        'Stock bajo',
        'Requieren atención'
      )}
      ${dashboardMetric(
        snapshot.expiringLots.length,
        'Por vencer',
        'Próximos 30 días'
      )}
      ${dashboardMetric(
        snapshot.movementSummaryToday.supplyCount,
        'Surtidos hoy',
        `${snapshot.movementSummaryToday.movementCount} movimientos`
      )}
    </section>

    <section class="grid dashboard-detail-grid" style="margin-top:16px">
      <article class="card dashboard-section-card">
        <div class="section-head">
          <div>
            <h3>🛒 Sugerencias de compra y pedido</h3>
            <p>Stock real, mínimos, máximos y mercancía en tránsito.</p>
          </div>
          <span class="badge">${snapshot.inventorySummary.replenishmentNeeded}</span>
        </div>

        <div class="stack">
          ${snapshot.lowStock.length
            ? snapshot.lowStock.slice(0, 6).map(row => `
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

        ${canOpenView('replenishment') ? `
          <button
            class="secondary"
            data-open-view="replenishment"
            type="button"
            style="width:100%;margin-top:10px"
          >Ver compras y pedidos</button>
        ` : ''}
      </article>

      <article class="card dashboard-section-card">
        <div class="section-head">
          <div>
            <h3>◷ Vencimientos próximos</h3>
            <p>Rotación FEFO con existencia restante.</p>
          </div>
          <span class="badge">${snapshot.expiringLots.length}</span>
        </div>

        <div class="stack">
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

      <article class="card dashboard-section-card">
        <div class="section-head">
          <div>
            <h3>⇅ Movimientos recientes</h3>
            <p>Historial del que se deriva el stock.</p>
          </div>
          <span class="badge">${snapshot.recentMovements.length}</span>
        </div>

        <div class="stack">
          ${snapshot.recentMovements.length
            ? snapshot.recentMovements.slice(0, 6).map(movement => {
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

    <section class="dashboard-wide-grid">
      <article class="card">
        <div class="section-head">
          <div>
            <h3>⚡ Acciones rápidas</h3>
            <p>Lo que más usa el almacén, a un toque.</p>
          </div>
        </div>

        <div class="grid quick-action-grid">
          ${canOpenView('count')
            ? actionCard('count', '☑ Conteo físico', 'Número + Enter · ajustes trazables.')
            : ''}
          ${canOpenView('supply')
            ? actionCard('supply', '↑ Surtido', 'Salida interna validada y FEFO.')
            : ''}
          ${canOpenView('entry')
            ? actionCard('entry', '↓ Entrada', 'Recepción, costo, lote y vencimiento.')
            : ''}
          ${canOpenView('replenishment')
            ? actionCard('replenishment', '↻ Comprar / Pedir', 'Sugerencias y mercancía en tránsito.')
            : ''}
          ${canOpenView('catalog')
            ? actionCard('catalog', '◫ Catálogo', 'Productos, mínimos, máximos y Excel.')
            : ''}
          ${canOpenView('reports')
            ? actionCard('reports', '▥ Reportes', 'Inventario, consumo y vencimientos.')
            : ''}
          ${canOpenView('users')
            ? actionCard('users', '♙ Usuarios', 'Roles y permisos granulares.')
            : ''}
          ${canOpenView('audit')
            ? actionCard('audit', '◎ Auditoría', 'Quién hizo qué y cuándo.')
            : ''}
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h3>✓ Estado del sistema</h3>
            <p>Sesión, sincronización y trabajo local-first.</p>
          </div>
        </div>

        <div class="dashboard-status-panel">
          <div class="status-tile">
            <div class="status-tile-icon">☁</div>
            <div>
              <strong>${navigator.onLine ? 'Conectado al servidor' : 'Trabajando offline'}</strong>
              <small>${snapshot.pendingSyncCount ? snapshot.pendingSyncCount + ' cambio(s) pendiente(s)' : 'Sin cambios pendientes'}</small>
            </div>
          </div>

          <div class="status-tile">
            <div class="status-tile-icon">🔐</div>
            <div>
              <strong>Firebase · ${escapeHtml(state.session?.roleCode || 'sesión')}</strong>
              <small>${state.authUser?.email ? escapeHtml(state.authUser.email) : 'Identidad protegida'}</small>
            </div>
          </div>

          <div class="status-tile">
            <div class="status-tile-icon">▣</div>
            <div>
              <strong>${escapeHtml(currentWorkspace?.name || 'Almacén principal')}</strong>
              <small>${escapeHtml(currentWorkspace?.workspaceKey || 'workspace activo')}</small>
            </div>
          </div>

          <div class="status-tile">
            <div class="status-tile-icon">↺</div>
            <div>
              <strong>${snapshot.syncConflictCount ? snapshot.syncConflictCount + ' conflicto(s)' : 'Sin conflictos'}</strong>
              <small>Los cambios nunca se sobrescriben en silencio</small>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;
}

async function renderAlerts() {
  const snapshot = await getDashboardSnapshot({
    lowStockLimit: 1000
  });

  const productById = new Map(
    state.products.map(product => [product.id, product])
  );

  const criticalRows = snapshot.lowStock
    .filter(row => Number(row.stock || 0) < Number(row.minStock || 0))
    .slice(0, 12);

  const expiring = snapshot.expiringLots.slice(0, 12);

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Atención operativa
        </div>
        <h2>Alertas</h2>
        <p>Situaciones derivadas de stock, vencimientos y sincronización que requieren revisión.</p>
      </div>
      <div class="dashboard-sync">
        <span class="badge ${criticalRows.length ? 'status-warning' : 'status-good'}">
          ${criticalRows.length} stock
        </span>
        <span class="badge ${expiring.length ? 'status-warning' : 'status-good'}">
          ${expiring.length} vencimiento(s)
        </span>
        <span class="badge ${snapshot.syncConflictCount ? 'status-danger' : 'status-good'}">
          ${snapshot.syncConflictCount} conflicto(s)
        </span>
      </div>
    </section>

    <div class="alerts-grid-v2">
      <section class="card alert-panel-v2">
        <div class="section-head">
          <div>
            <h3>Stock crítico / bajo</h3>
            <p>Productos por debajo del mínimo configurado.</p>
          </div>
          <span class="badge">${criticalRows.length}</span>
        </div>

        <div class="alert-list-v2">
          ${criticalRows.length
            ? criticalRows.map(row => `
              <div class="alert-row-v2 stock">
                <div class="alert-icon-v2">!</div>
                <div>
                  <strong>${escapeHtml(row.name)}</strong>
                  <small>
                    Stock ${formatNumber(row.stock)} ·
                    mínimo ${formatNumber(row.minStock)} ·
                    sugerencia ${formatNumber(row.suggestedQuantity)}
                  </small>
                </div>
                ${canOpenView('replenishment') ? `
                  <button
                    class="secondary"
                    data-open-view="replenishment"
                    type="button"
                  >Resolver</button>
                ` : ''}
              </div>
            `).join('')
            : '<div class="empty compact-empty">No hay productos bajo mínimo.</div>'}
        </div>
      </section>

      <section class="card alert-panel-v2">
        <div class="section-head">
          <div>
            <h3>Vencimientos</h3>
            <p>Lotes vencidos o dentro de los próximos 30 días.</p>
          </div>
          <span class="badge">${expiring.length}</span>
        </div>

        <div class="alert-list-v2">
          ${expiring.length
            ? expiring.map(lot => {
                const product = productById.get(lot.productId);
                return `
                  <div class="alert-row-v2 expiry">
                    <div class="alert-icon-v2">◷</div>
                    <div>
                      <strong>${escapeHtml(product?.name || lot.productId)}</strong>
                      <small>
                        Lote ${escapeHtml(lot.lotNumber || '—')} ·
                        ${formatNumber(lot.remainingQuantity)} restante(s)
                      </small>
                    </div>
                    <span class="badge ${lot.expired ? 'status-danger' : lot.daysRemaining <= 7 ? 'status-warning' : ''}">
                      ${lot.expired ? 'Vencido' : lot.daysRemaining + ' d'}
                    </span>
                  </div>
                `;
              }).join('')
            : '<div class="empty compact-empty">Sin vencimientos próximos.</div>'}
        </div>
      </section>

      <section class="card alert-panel-v2 system-alert-panel">
        <div class="section-head">
          <div>
            <h3>Sistema</h3>
            <p>Estado de trabajo local-first y conflictos.</p>
          </div>
        </div>

        <div class="system-status-list-v2">
          <div>
            <span class="system-status-dot ${navigator.onLine ? 'ok' : 'warning'}"></span>
            <div>
              <strong>${navigator.onLine ? 'Conectado' : 'Sin conexión'}</strong>
              <small>${snapshot.pendingSyncCount} cambio(s) pendiente(s)</small>
            </div>
          </div>

          <div>
            <span class="system-status-dot ${snapshot.syncConflictCount ? 'danger' : 'ok'}"></span>
            <div>
              <strong>${snapshot.syncConflictCount ? 'Conflictos pendientes' : 'Sin conflictos'}</strong>
              <small>Los cambios no se sobrescriben en silencio.</small>
            </div>
          </div>

          ${snapshot.syncConflictCount ? `
            <button class="secondary" data-open-view="conflicts" type="button">
              Revisar conflictos
            </button>
          ` : ''}
        </div>
      </section>
    </div>
  `;
}

async function renderSettings() {
  const currentWorkspace =
    state.availableWorkspaces.find(
      workspace =>
        workspace.id === state.session?.workspaceId
    ) ||
    state.availableWorkspaces[0] ||
    null;

  const pending = await getPendingSyncCount();

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Workspace y sistema
        </div>
        <h2>Configuración</h2>
        <p>Estado operativo y decisiones de arquitectura. Los cambios sensibles siguen protegidos.</p>
      </div>
      <span class="badge status-good">Producción protegida</span>
    </section>

    <div class="settings-grid-v2">
      <section class="card">
        <div class="section-head">
          <div>
            <h3>General</h3>
            <p>Workspace y sesión actual.</p>
          </div>
        </div>

        <div class="settings-list-v2">
          <div class="settings-row-v2">
            <div>
              <strong>Almacén principal</strong>
              <small>${escapeHtml(currentWorkspace?.name || 'Almacén principal')}</small>
            </div>
            <span class="badge">${escapeHtml(currentWorkspace?.workspaceKey || 'activo')}</span>
          </div>

          <div class="settings-row-v2">
            <div>
              <strong>Rol actual</strong>
              <small>${escapeHtml(state.authUser?.email || 'Sesión local')}</small>
            </div>
            <span class="badge ${state.session?.roleCode === 'GOD' ? 'god-badge' : ''}">
              ${state.session?.roleCode === 'GOD' ? 'DIOS 👑' : escapeHtml(state.session?.roleCode || '—')}
            </span>
          </div>

          <div class="settings-row-v2">
            <div>
              <strong>Autenticación</strong>
              <small>Firebase Authentication con validación del servidor.</small>
            </div>
            <span class="badge status-good">Activa</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <h3>Sincronización</h3>
            <p>Cliente local-first y backend.</p>
          </div>
        </div>

        <div class="settings-list-v2">
          <div class="settings-row-v2">
            <div>
              <strong>Estado de red</strong>
              <small>${navigator.onLine ? 'El dispositivo tiene conectividad.' : 'El dispositivo trabaja offline.'}</small>
            </div>
            <span class="badge ${navigator.onLine ? 'status-good' : 'status-warning'}">
              ${navigator.onLine ? 'Online' : 'Offline'}
            </span>
          </div>

          <div class="settings-row-v2">
            <div>
              <strong>Trabajo pendiente</strong>
              <small>Cambios locales esperando sincronización.</small>
            </div>
            <span class="badge ${pending ? 'status-warning' : 'status-good'}">${pending}</span>
          </div>

          <div class="settings-row-v2">
            <div>
              <strong>Intervalo visible</strong>
              <small>Sincronización automática mientras la app está activa.</small>
            </div>
            <span class="badge">15 s</span>
          </div>
        </div>
      </section>

      <section class="card settings-saint-card">
        <div class="section-head">
          <div>
            <h3>SAINT Enterprise · Fase 26</h3>
            <p>Integración final deliberadamente congelada hasta completar piloto y despliegue.</p>
          </div>
          <span class="badge">Planificado</span>
        </div>

        <div class="saint-rules-grid">
          <div>
            <strong>1 · Validación</strong>
            <span>SKU ↔ código SAINT debe estar verificado.</span>
          </div>
          <div>
            <strong>2 · EN ESPERA</strong>
            <span>Smart Inventory no postea automáticamente.</span>
          </div>
          <div>
            <strong>3 · Antiduplicado</strong>
            <span>Referencia externa persistida y reenvíos bloqueados.</span>
          </div>
        </div>

        <button class="secondary" type="button" disabled>
          Configurar en ETAPA 26
        </button>
      </section>
    </div>
  `;
}

async function renderAudit() {
  if (!state.session) {
    await refreshSession({ silent: true });
  }

  if (!can(state.session, 'audit.view')) {
    appRoot.innerHTML = `
      <section class="hero">
        <h2>Auditoría</h2>
        <p>Esta sección requiere el permiso audit.view.</p>
      </section>
      <section class="card"><div class="empty">Sin permiso de auditoría.</div></section>
    `;
    return;
  }

  try {
    state.auditEvents = await listAuditEvents({ limit: 150 });
  } catch (error) {
    appRoot.innerHTML = `
      <section class="hero">
        <h2>Auditoría</h2>
        <p>Historial protegido por el servidor.</p>
      </section>
      <section class="card"><div class="status-danger">${escapeHtml(error.message || String(error))}</div></section>
    `;
    return;
  }

  const localMovements = await getAll(STORES.MOVEMENTS);
  const reversedIds = new Set(
    localMovements
      .filter(movement => movement.reversedMovementId)
      .map(movement => movement.reversedMovementId)
  );
  const reversibleAdjustments = localMovements
    .filter(movement => movement.type === 'ADJUSTMENT')
    .filter(movement => !reversedIds.has(movement.id))
    .sort((a, b) =>
      String(b.effectiveAt || b.createdAt).localeCompare(
        String(a.effectiveAt || a.createdAt)
      )
    )
    .slice(0, 12);

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <h2>Auditoría</h2>
        <p>Registro del servidor y compensaciones controladas de ajustes.</p>
      </div>
      <span class="badge">${state.auditEvents.length} eventos</span>
    </section>

    <div class="operation-layout">
      <section class="card stack">
        <div>
          <h3 style="margin:0">Eventos recientes</h3>
          <div class="product-meta">La API registra escrituras sincronizadas y operaciones administrativas.</div>
        </div>

        ${state.auditEvents.length
          ? state.auditEvents.map(item => `
            <div class="audit-row">
              <div>
                <strong>${escapeHtml(auditActionLabel(item.action))}</strong>
                <div class="product-meta">
                  ${escapeHtml(item.entityType || 'sistema')}
                  ${item.entityId ? ' · ' + escapeHtml(item.entityId) : ''}
                </div>
              </div>
              <div class="audit-row-end">
                <strong>${formatDate(item.createdAt)}</strong>
                <small>${escapeHtml(item.userId || 'sistema')}</small>
              </div>
            </div>
          `).join('')
          : '<div class="empty">Todavía no hay eventos auditados.</div>'}
      </section>

      <section class="card stack">
        <div>
          <h3 style="margin:0">Compensar ajustes</h3>
          <div class="product-meta">
            No se edita el movimiento original. Se crea un REVERSAL trazable.
          </div>
        </div>

        ${reversibleAdjustments.length
          ? reversibleAdjustments.map(movement => {
              const product = state.products.find(item => item.id === movement.productId);
              return `
                <div class="audit-adjustment-row">
                  <div>
                    <strong>${escapeHtml(product?.name || movement.productId)}</strong>
                    <div class="product-meta">
                      ${formatSigned(movement.delta)} · ${formatDate(movement.effectiveAt || movement.createdAt)}
                    </div>
                  </div>
                  <button
                    class="danger"
                    data-action="reverse-adjustment"
                    data-id="${escapeHtml(movement.id)}"
                    type="button"
                  >Compensar</button>
                </div>
              `;
            }).join('')
          : '<div class="empty">No hay ajustes pendientes de compensación.</div>'}
      </section>
    </div>
  `;
}

function auditActionLabel(action) {
  if (!action) return 'Evento';
  return String(action)
    .replace(/^SYNC_/, 'Sincronización ')
    .replace(/_/g, ' ');
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

  const activeMembers = state.members.filter(
    member => member.membershipActive
  ).length;
  const godMembers = state.members.filter(
    member => member.roleCode === 'GOD'
  ).length;

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Seguridad y acceso
        </div>
        <h2>Usuarios y permisos</h2>
        <p>Roles, membresías y permisos granulares validados nuevamente por la API.</p>
      </div>
      <div class="dashboard-sync">
        <span class="badge">${activeMembers} activos</span>
        ${godMembers ? `<span class="badge god-badge">👑 ${godMembers} DIOS</span>` : ''}
      </div>
    </section>

    <section class="grid user-summary-grid">
      <article class="card user-summary-card">
        <span>Miembros</span>
        <strong>${state.members.length}</strong>
        <small>registrados en el workspace</small>
      </article>
      <article class="card user-summary-card">
        <span>Activos</span>
        <strong>${activeMembers}</strong>
        <small>con acceso al almacén</small>
      </article>
      <article class="card user-summary-card">
        <span>Cuenta maestra</span>
        <strong>${godMembers ? 'DIOS 👑' : '—'}</strong>
        <small>protección jerárquica activa</small>
      </article>
    </section>

    <section class="card user-create-panel">
      <div class="section-head">
        <div>
          <h3>＋ Agregar usuario</h3>
          <p>Preautoriza por email. Firebase vincula el UID en el primer acceso válido.</p>
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

    <section class="user-member-grid">
      ${state.members.map(member => renderMemberCard(member)).join('')}
    </section>
  `;
}

function renderMemberCard(member) {
  const permissions = Array.isArray(member.permissions)
    ? member.permissions
    : [];
  const wildcard = permissions.includes('*');
  const identity =
    member.displayName ||
    member.email ||
    member.externalAuthId ||
    member.userId;
  const initials = String(identity || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();

  return `
    <article
      class="card user-member-card ${member.roleCode === 'GOD' ? 'user-member-god' : ''}"
      data-member-card="${escapeHtml(member.userId)}"
    >
      <div class="user-member-head-v2">
        <div class="user-avatar-v2">
          ${member.roleCode === 'GOD' ? '👑' : escapeHtml(initials)}
        </div>

        <div class="user-member-identity">
          <strong>${escapeHtml(identity)}</strong>
          <small>
            ${escapeHtml(member.email || 'Sin email')} ·
            ${member.externalAuthId ? 'Identidad vinculada' : 'Pendiente de primer acceso'}
          </small>
        </div>

        <div class="user-badges-v2">
          <span class="badge ${member.membershipActive ? 'status-good' : 'status-warning'}">
            ${member.membershipActive ? 'Activo' : 'Desactivado'}
          </span>
          <span class="badge ${member.roleCode === 'GOD' ? 'god-badge' : ''}">
            ${member.roleCode === 'GOD' ? 'DIOS 👑' : escapeHtml(member.roleCode)}
          </span>
        </div>
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
          ${wildcard
            ? '<span class="badge status-good">Acceso total</span>'
            : `<span class="badge">${permissions.length}</span>`}
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

  const topMovement = movementTotals
    .slice()
    .sort((a, b) =>
      Number(b.supply || 0) - Number(a.supply || 0)
    )
    .slice(0, 6);

  const maxSupply = Math.max(
    1,
    ...topMovement.map(row => Number(row.supply || 0))
  );

  state.reportRows = inventoryRows;

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Inteligencia operativa
        </div>
        <h2>Reportes</h2>
        <p>Análisis calculado desde movimientos reales, sin stock editable.</p>
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

        ${hasClientPermission('reports.export') ? `
          <button class="secondary" data-action="export-report" data-format="csv" type="button">CSV</button>
          <button class="secondary" data-action="export-report" data-format="xlsx" type="button">Excel</button>
          <button class="primary" data-action="export-report" data-format="print" type="button">Imprimir / PDF</button>
        ` : '<span class="product-meta">Exportación no autorizada</span>'}
      </div>
    </section>

    <section class="grid dashboard-grid report-kpi-grid">
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

    <section class="report-visual-grid">
      <article class="card">
        <div class="section-head">
          <div>
            <h3>Productos con mayor consumo</h3>
            <p>Surtidos acumulados del periodo.</p>
          </div>
        </div>

        <div class="report-bars-v2">
          ${topMovement.length
            ? topMovement.map(row => {
                const product = productById.get(row.productId);
                const width = Math.max(
                  4,
                  Math.round(
                    (Number(row.supply || 0) / maxSupply) * 100
                  )
                );

                return `
                  <div class="report-bar-row-v2">
                    <div class="report-bar-label">
                      <strong>${escapeHtml(product?.name || row.productId)}</strong>
                      <small>${formatNumber(row.supply)} surtido</small>
                    </div>
                    <div class="report-bar-track-v2">
                      <span style="width:${width}%"></span>
                    </div>
                    <strong>${formatNumber(row.supply)}</strong>
                  </div>
                `;
              }).join('')
            : '<div class="empty compact-empty">Sin movimientos en el periodo.</div>'}
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h3>◷ Vencimientos próximos</h3>
            <p>Lotes vencidos o en los próximos 30 días.</p>
          </div>
          <span class="badge">${expiringLots.length}</span>
        </div>

        <div class="report-expiry-list">
          ${expiringLots.length
            ? expiringLots.slice(0, 8).map(lot => {
                const product = productById.get(lot.productId);
                const urgencyClass = lot.expired
                  ? 'danger'
                  : lot.daysRemaining <= 7
                    ? 'warning'
                    : 'normal';

                return `
                  <div class="report-expiry-row ${urgencyClass}">
                    <div>
                      <strong>${escapeHtml(product?.name || lot.productId)}</strong>
                      <small>
                        Lote ${escapeHtml(lot.lotNumber || '—')} ·
                        ${formatNumber(lot.remainingQuantity)} restantes
                      </small>
                    </div>
                    <span>
                      ${lot.expired ? 'Vencido' : lot.daysRemaining + ' d'}
                    </span>
                  </div>
                `;
              }).join('')
            : '<div class="empty compact-empty">Sin vencimientos próximos.</div>'}
        </div>
      </article>
    </section>

    <section class="card report-inventory-card">
      <div class="section-head">
        <div>
          <h3>Inventario actual</h3>
          <p>Stock, mínimos, máximos, tránsito, sugerencia y cobertura.</p>
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
                <td class="catalog-stock-value">${formatNumber(row.stock)}</td>
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
  `;
}

async function renderCatalog() {
  await refreshProducts();

  const canWriteCatalog =
    hasClientPermission('catalog.write');
  const movements = await getAll(STORES.MOVEMENTS);
  const categories = await getAll(STORES.CATEGORIES);
  const categoryById = new Map(
    categories.map(category => [
      category.id,
      category
    ])
  );
  const inventoryRows = buildInventoryReport(
    state.products,
    movements,
    { now: new Date() }
  );
  const rowByProductId = new Map(
    inventoryRows.map(row => [row.productId, row])
  );
  const initialLoadStatus =
    await getLocalSaintInitialLoadStatus();
  const initialLoadSummary =
    state.saintInitialLoadDraft
      ? saintInitialLoadSummary(
          state.saintInitialLoadDraft
        )
      : null;
  const editingProduct =
    state.editingProductId
      ? state.products.find(
          product => product.id === state.editingProductId
        ) || null
      : null;

  if (state.editingProductId && !editingProduct) {
    state.editingProductId = null;
  }

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Base maestra
        </div>
        <h2>Catálogo</h2>
        <p>Productos, códigos, stock derivado, mínimos, máximos y método de reposición.</p>
      </div>
      <div class="dashboard-sync">
        <span class="badge">${state.products.length} producto(s)</span>
        ${canWriteCatalog
          ? '<span class="badge status-good">Edición habilitada</span>'
          : '<span class="badge">Solo consulta</span>'}
      </div>
    </section>

    <div class="catalog-workspace-v2">
      <section class="card catalog-table-card">
        <div class="catalog-toolbar-v2">
          <label class="catalog-search-v2">
            <span>⌕</span>
            <input
              id="catalogLocalSearch"
              placeholder="Buscar nombre, SKU o código..."
              autocomplete="off"
            >
          </label>
          <span class="badge">${inventoryRows.length}</span>
        </div>

        <div class="catalog-table-wrap-v2">
          <table class="catalog-table-v2">
            <thead>
              <tr>
                <th>Producto</th>
                <th>SKU</th>
                <th>Stock</th>
                <th>Mín.</th>
                <th>Máx.</th>
                <th>Unidad</th>
                <th>Reposición</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody id="catalogRows">
              ${state.products.length
                ? state.products.map(product => {
                    const row = rowByProductId.get(product.id);
                    const stock = Number(row?.stock || 0);
                    const min = Number(product.minStock || 0);
                    const max = Number(product.maxStock || 0);
                    const status = min > 0 && stock < min
                      ? (stock <= Math.max(0, min * .5) ? 'Crítico' : 'Bajo')
                      : 'Normal';
                    const statusClass = status === 'Crítico'
                      ? 'critical'
                      : status === 'Bajo'
                        ? 'low'
                        : 'ok';

                    return `
                      <tr
                        data-catalog-filter="${escapeHtml(
                          [product.name, product.sku, product.barcode]
                            .filter(Boolean)
                            .join(' ')
                            .toLowerCase()
                        )}"
                      >
                        <td>
                          <div class="catalog-product-cell">
                            <div class="catalog-product-icon">▣</div>
                            <div>
                              <strong>${escapeHtml(product.name)}</strong>
                              <small>${escapeHtml(product.barcode || 'Sin código de barras')}</small>
                              <small>${escapeHtml(
                                product.categoryId
                                  ? categoryById.get(product.categoryId)?.name || 'Categoría desconocida'
                                  : 'Sin categoría'
                              )}</small>
                              <small>${escapeHtml(catalogPresentationSummary(product))}</small>
                              ${canWriteCatalog ? `
                                <button
                                  class="catalog-edit-link"
                                  data-action="edit-product"
                                  data-product-id="${escapeHtml(product.id)}"
                                  type="button"
                                >Editar</button>
                              ` : ''}
                            </div>
                          </div>
                        </td>
                        <td>${escapeHtml(product.sku || '—')}</td>
                        <td class="catalog-stock-value">${renderCatalogQuantity(product, stock)}</td>
                        <td>${renderCatalogQuantity(product, min)}</td>
                        <td>${max > 0 ? renderCatalogQuantity(product, max) : '—'}</td>
                        <td>${escapeHtml(catalogUnitCode(product))}</td>
                        <td>${escapeHtml(replenishmentLabel(product.replenishmentMethod))}</td>
                        <td>
                          <span class="catalog-status ${statusClass}">
                            <span></span>${status}
                          </span>
                        </td>
                      </tr>
                    `;
                  }).join('')
                : '<tr><td colspan="8"><div class="empty">Todavía no hay productos.</div></td></tr>'}
            </tbody>
          </table>
        </div>

        <div id="catalogMobileList" class="catalog-mobile-list">
          ${state.products.length
            ? state.products.map(product => {
                const row = rowByProductId.get(product.id);
                const stock = Number(row?.stock || 0);
                const min = Number(product.minStock || 0);
                const status = min > 0 && stock < min
                  ? (stock <= Math.max(0, min * .5) ? 'critical' : 'low')
                  : 'ok';
                const statusLabel = status === 'critical'
                  ? 'Crítico'
                  : status === 'low'
                    ? 'Bajo'
                    : 'Normal';

                return `
                  <article
                    class="catalog-mobile-card"
                    data-catalog-filter="${escapeHtml(
                      [product.name, product.sku, product.barcode]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase()
                    )}"
                  >
                    <div class="catalog-mobile-head">
                      <div class="catalog-product-icon">▣</div>
                      <div>
                        <strong>${escapeHtml(product.name)}</strong>
                        <small>${escapeHtml(product.sku || product.barcode || 'Sin código')}</small>
                        <small>${escapeHtml(
                          product.categoryId
                            ? categoryById.get(product.categoryId)?.name || 'Categoría desconocida'
                            : 'Sin categoría'
                        )}</small>
                        <small>${escapeHtml(catalogPresentationSummary(product))}</small>
                        ${canWriteCatalog ? `
                          <button
                            class="catalog-edit-link"
                            data-action="edit-product"
                            data-product-id="${escapeHtml(product.id)}"
                            type="button"
                          >Editar</button>
                        ` : ''}
                      </div>
                      <span class="catalog-status ${status}"><span></span>${statusLabel}</span>
                    </div>
                    <div class="catalog-mobile-stats">
                      <div><small>Stock</small>${renderCatalogQuantity(product, stock)}</div>
                      <div><small>Mín.</small>${renderCatalogQuantity(product, product.minStock || 0)}</div>
                      <div><small>Máx.</small>${product.maxStock ? renderCatalogQuantity(product, product.maxStock) : '<strong>—</strong>'}</div>
                    </div>
                    <div class="product-meta">
                      ${escapeHtml(catalogUnitCode(product))} ·
                      ${escapeHtml(replenishmentLabel(product.replenishmentMethod))}
                    </div>
                  </article>
                `;
              }).join('')
            : '<div class="empty">Todavía no hay productos.</div>'}
        </div>
      </section>

      <aside class="catalog-side-v2">
        ${canWriteCatalog ? `
          ${renderCatalogProductEditor(
            editingProduct,
            categories
          )}

          <section class="card stack catalog-import-card">
            <div class="section-head">
              <div>
                <h3>⇧ Carga de catálogo SAINT</h3>
                <p>Depura productos, empaques y mínimos/máximos antes de importar.</p>
              </div>
              <button
                class="secondary"
                data-action="download-saint-template"
                type="button"
              >Descargar plantilla</button>
            </div>

            <label class="import-zone-v2">
              <span class="import-zone-icon">⇧</span>
              <strong>Seleccionar archivo</strong>
              <small>.xlsx, .xls o .csv</small>
              <input
                id="catalogImportFile"
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
              >
            </label>

            <div class="catalog-safety-note">
              <strong>Stock protegido.</strong>
              La Existencia SAINT se conserva solo como referencia para el futuro movimiento de apertura. Importar catálogo nunca pisa stock.
            </div>

            ${state.importPreview ? renderCatalogImportPreview(state.importPreview) : ''}
          </section>

          ${renderSaintInitialLoadCard({
            draft: state.saintInitialLoadDraft,
            summary: initialLoadSummary,
            status: initialLoadStatus,
            hasMovements: movements.length > 0
          })}
        ` : `
          <section class="card">
            <strong>Modo consulta</strong>
            <p class="product-meta">Puedes revisar el catálogo, pero no modificarlo.</p>
          </section>
        `}
      </aside>
    </div>
  `;

  const catalogSearch =
    document.getElementById('catalogLocalSearch');

  catalogSearch?.addEventListener('input', event => {
    const query = String(event.target.value || '')
      .trim()
      .toLowerCase();

    document
      .querySelectorAll('[data-catalog-filter]')
      .forEach(item => {
        const haystack =
          item.dataset.catalogFilter || '';
        item.hidden =
          Boolean(query) &&
          !haystack.includes(query);
      });
  });
}

async function renderReplenishmentWorkspace() {
  const snapshot = await getDashboardSnapshot({
    lowStockLimit: 1000
  });
  const items = await listReplenishments();
  const actionableSuggestions = snapshot.lowStock.filter(
    row => Number(row.suggestedQuantity || 0) > 0
  );

  const inTransitCount = items.filter(item =>
    [
      REPLENISHMENT_STATUS.ORDERED,
      REPLENISHMENT_STATUS.IN_TRANSIT,
      REPLENISHMENT_STATUS.PARTIALLY_RECEIVED
    ].includes(item.status)
  ).length;

  const pendingUnits = items.reduce(
    (sum, item) => sum + Number(item.pendingQuantity || 0),
    0
  );

  appRoot.innerHTML = `
    <section class="hero dashboard-hero">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Reposición inteligente
        </div>
        <h2>Comprar / Pedir</h2>
        <p>El tránsito reduce la sugerencia, pero nunca altera el stock físico hasta recibir mercancía.</p>
      </div>
      <div class="dashboard-sync">
        <span class="badge">${actionableSuggestions.length} sugerencia(s)</span>
        <span class="badge">${inTransitCount} en proceso</span>
      </div>
    </section>

    <section class="grid replenish-kpi-grid">
      <article class="card replenish-kpi">
        <small>Necesitan reposición</small>
        <strong>${snapshot.inventorySummary.replenishmentNeeded}</strong>
        <span>según stock y mínimos</span>
      </article>
      <article class="card replenish-kpi">
        <small>Compras / pedidos</small>
        <strong>${items.length}</strong>
        <span>registrados</span>
      </article>
      <article class="card replenish-kpi">
        <small>Unidades pendientes</small>
        <strong>${formatNumber(pendingUnits)}</strong>
        <span>todavía no son stock</span>
      </article>
    </section>

    <div class="replenish-layout-v2">
      <section class="card">
        <div class="section-head">
          <div>
            <h3>🛒 Sugerencias</h3>
            <p>Calculadas con stock real + mercancía en tránsito.</p>
          </div>
          <span class="badge">${actionableSuggestions.length}</span>
        </div>

        <div class="replenish-suggestion-list">
          ${actionableSuggestions.length
            ? actionableSuggestions.map(row => {
                const product = state.products.find(
                  item => item.id === row.productId
                );

                return `
                  <article class="replenish-suggestion-card">
                    <div>
                      <strong>${escapeHtml(row.name)}</strong>
                      <small>
                        Stock ${formatNumber(row.stock)} ·
                        Tránsito ${formatNumber(row.pendingInbound)} ·
                        Min ${formatNumber(row.minStock)} ·
                        Max ${formatNumber(row.maxStock)}
                      </small>
                    </div>

                    <div class="replenish-qty-box">
                      <small>Sugerido</small>
                      <strong>${formatNumber(row.suggestedQuantity)}</strong>
                    </div>

                    <div class="replenishment-actions">
                      ${renderReplenishmentCreateButtons(
                        product,
                        row.suggestedQuantity
                      )}
                    </div>
                  </article>
                `;
              }).join('')
            : '<div class="empty compact-empty">No hay sugerencias pendientes.</div>'}
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <h3>Compras / pedidos</h3>
            <p>Borrador → realizado → tránsito → recibido.</p>
          </div>
          <span class="badge">${items.length}</span>
        </div>

        <div class="replenishment-list-v2">
          ${items.length
            ? items.map(item => `
              <article class="replenishment-card">
                <div class="replenishment-card-head-v2">
                  <div>
                    <strong>${escapeHtml(item.productName || item.productId)}</strong>
                    <small>
                      ${item.method === 'PURCHASE' ? 'Compra' : 'Pedido'} ·
                      ${formatNumber(item.requestedQuantity)} solicitados
                    </small>
                  </div>
                  <span class="badge">${replenishmentStatusLabel(item.status)}</span>
                </div>

                <div class="replenishment-progress-v2">
                  <div>
                    <small>Pendiente</small>
                    <strong>${formatNumber(item.pendingQuantity)}</strong>
                  </div>
                  <div>
                    <small>Recibido</small>
                    <strong>${formatNumber(
                      Number(item.requestedQuantity || 0) -
                      Number(item.pendingQuantity || 0)
                    )}</strong>
                  </div>
                  <div>
                    <small>Llegada</small>
                    <strong>${item.expectedAt
                      ? formatShortDate(item.expectedAt)
                      : '—'}</strong>
                  </div>
                </div>

                <div class="replenishment-buttons">
                  ${renderReplenishmentStatusButtons(item)}
                </div>
              </article>
            `).join('')
            : '<div class="empty compact-empty">Todavía no hay compras o pedidos.</div>'}
        </div>
      </section>
    </div>
  `;
}

async function renderDocumentWorkspace(type) {
  if (!state.activeDocumentId || state.activeDocumentType !== type) {
    const drafts = await listDraftDocuments({
      ownerId: currentOwnerId(),
      type
    });
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

    const icon = type === DOCUMENT_TYPES.COUNT
      ? '☑'
      : type === DOCUMENT_TYPES.ENTRY
        ? '↓'
        : '↑';

    appRoot.innerHTML = `
      <section class="hero dashboard-hero">
        <div>
          <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
            ${type === DOCUMENT_TYPES.COUNT
              ? 'Inventario físico'
              : type === DOCUMENT_TYPES.ENTRY
                ? 'Recepción'
                : 'Salida interna'}
          </div>
          <h2>${documentTitle(type)}</h2>
          <p>${documentSubtitle(type)}</p>
        </div>
        <button
          class="primary"
          data-action="new-document"
          data-type="${type}"
          type="button"
        >
          ＋ Nuevo ${documentTitle(type).toLowerCase()}
        </button>
      </section>

      <div class="document-landing-grid">
        <section class="card document-start-card">
          <div class="document-start-icon">${icon}</div>
          <div>
            <h3>Empezar ${documentTitle(type).toLowerCase()}</h3>
            <p>
              ${type === DOCUMENT_TYPES.COUNT
                ? 'Recorre el catálogo producto por producto y guarda cada cantidad inmediatamente.'
                : type === DOCUMENT_TYPES.ENTRY
                  ? 'Agrega mercancía recibida con trazabilidad de lote, costo y vencimiento.'
                  : 'Prepara un carrito interno y valida el stock real antes de cerrar.'}
            </p>
          </div>
          <button
            class="primary"
            data-action="new-document"
            data-type="${type}"
            type="button"
          >
            Comenzar ahora
          </button>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <h3>Continuar trabajo</h3>
              <p>Borradores recuperables.</p>
            </div>
            <span class="badge">${drafts.length}</span>
          </div>

          <div class="draft-list-v2">
            ${drafts.length
              ? drafts.map(document => `
                <div class="draft-row-v2">
                  <div class="draft-icon-v2">${icon}</div>
                  <div>
                    <strong>${escapeHtml(document.id)}</strong>
                    <small>${formatDate(document.updatedAt)}</small>
                  </div>
                  <div class="draft-actions-v2">
                    <button
                      class="secondary"
                      data-action="open-document"
                      data-id="${escapeHtml(document.id)}"
                      data-type="${type}"
                      type="button"
                    >Continuar</button>
                    <button
                      class="danger"
                      data-action="cancel-document"
                      data-id="${escapeHtml(document.id)}"
                      type="button"
                    >×</button>
                  </div>
                </div>
              `).join('')
              : '<div class="empty compact-empty">No hay borradores pendientes.</div>'}
          </div>
        </section>
      </div>

      ${closedDocuments.length ? `
        <section class="card document-history-card">
          <div class="section-head">
            <div>
              <h3>Historial reciente</h3>
              <p>Exporta o imprime documentos cerrados sin modificar inventario.</p>
            </div>
            <span class="badge">${closedDocuments.length}</span>
          </div>

          <div class="document-history-list">
            ${closedDocuments.map(document => `
              <div class="closed-document-row">
                <div class="history-doc-title">
                  <div class="history-doc-icon">${icon}</div>
                  <div>
                    <strong>${escapeHtml(document.id)}</strong>
                    <small>
                      ${escapeHtml(document.status)} ·
                      ${formatDate(document.closedAt || document.updatedAt)}
                    </small>
                  </div>
                </div>

                <div class="document-export-actions">
                  <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="csv" type="button">CSV</button>
                  <button class="secondary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="xlsx" type="button">Excel</button>
                  <button class="primary" data-action="export-document" data-id="${escapeHtml(document.id)}" data-format="print" type="button">Imprimir / PDF</button>
                  ${document.status === DOCUMENT_STATUS.CLOSED &&
                    !document.metadata?.correctionDraftId &&
                    canCorrectDocument(type)
                      ? `<button
                          class="danger"
                          data-action="correct-document"
                          data-id="${escapeHtml(document.id)}"
                          data-type="${escapeHtml(type)}"
                          type="button"
                        >Corregir</button>`
                      : ''}
                  ${document.metadata?.correctionDraftId
                    ? '<span class="badge status-warning">Con corrección</span>'
                    : ''}
                </div>
              </div>
            `).join('')}
          </div>
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

  const equalCount = lines.filter(line =>
    Number(line.difference || 0) === 0
  ).length;
  const positiveCount = lines.filter(line =>
    Number(line.difference || 0) > 0
  ).length;
  const negativeCount = lines.filter(line =>
    Number(line.difference || 0) < 0
  ).length;

  appRoot.innerHTML = `
    <section class="hero dashboard-hero count-page-head">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          Conteo activo
        </div>
        <h2>Conteo físico</h2>
        <p>Producto → cantidad → Enter → siguiente. Cada línea queda guardada inmediatamente.</p>
      </div>
      <div class="dashboard-sync">
        <span class="badge">${lines.length} de ${state.products.length}</span>
        <span class="badge ${percent === 100 ? 'status-good' : ''}">${percent}%</span>
      </div>
    </section>

    <div class="count-workspace-v2">
      <section class="count-main-column">
        <article class="card count-progress-card">
          <div class="section-head">
            <div>
              <h3>Conteo General</h3>
              <p>${escapeHtml(state.activeDocumentId)}</p>
            </div>
            <span class="badge">${percent}% completado</span>
          </div>
          <div class="progress-track count-progress-track">
            <div style="width:${percent}%"></div>
          </div>
        </article>

        ${nextProduct ? renderCountProduct(nextProduct) : `
          <article class="card count-finished-card">
            <div class="count-complete-icon">✓</div>
            <h3>Conteo completo</h3>
            <p class="product-meta">
              Todas las líneas están guardadas. Al cerrar se generan únicamente los ajustes necesarios.
            </p>
            <button class="success count-close-button" data-action="close-document" type="button">
              Cerrar conteo
            </button>
          </article>
        `}
      </section>

      <aside class="count-side-column">
        <article class="card">
          <div class="section-head">
            <div>
              <h3>Últimos contados</h3>
              <p>Guardados inmediatamente.</p>
            </div>
          </div>

          <div class="recent-list-v2">
            ${lines.length
              ? lines.slice(-7).reverse().map(line => {
                  const difference = Number(line.difference || 0);
                  const deltaClass = difference > 0
                    ? 'delta-positive'
                    : difference < 0
                      ? 'delta-negative'
                      : 'delta-neutral';

                  return `
                    <div class="recent-count-item">
                      <div>
                        <strong>${escapeHtml(line.productName)}</strong>
                        <small>
                          Esperado ${formatNumber(line.expectedStock)} ·
                          Contado ${formatNumber(line.countedStock)}
                        </small>
                      </div>
                      <span class="${deltaClass}">${formatSigned(difference)}</span>
                    </div>
                  `;
                }).join('')
              : '<div class="empty compact-empty">Todavía no has contado productos.</div>'}
          </div>
        </article>

        <article class="card count-summary-card">
          <div class="section-head">
            <div>
              <h3>Resumen del conteo</h3>
              <p>Estado acumulado del borrador.</p>
            </div>
          </div>

          <div class="summary-list-v2">
            <div><span>Productos contados</span><strong>${lines.length}</strong></div>
            <div><span>Sin diferencia</span><strong>${equalCount}</strong></div>
            <div><span>Sobrantes</span><strong class="status-good">${positiveCount}</strong></div>
            <div><span>Faltantes</span><strong class="status-danger">${negativeCount}</strong></div>
          </div>

          ${!nextProduct && lines.length
            ? '<button class="success count-close-button" data-action="close-document" type="button">Cerrar conteo</button>'
            : ''}
        </article>
      </aside>
    </div>
  `;

  requestAnimationFrame(() => {
    document.getElementById('countValue')?.focus();
  });
}

function renderCountProduct(product) {
  return `
    <article class="count-product-v2">
      <div class="count-product-head">
        <div class="count-product-icon">▣</div>
        <div>
          <div class="product-meta">Producto actual</div>
          <h2>${escapeHtml(product.name)}</h2>
          <div class="product-meta">
            ${product.sku ? 'SKU ' + escapeHtml(product.sku) + ' · ' : ''}
            ${product.barcode ? 'Código ' + escapeHtml(product.barcode) : ''}
          </div>
        </div>
      </div>

      <div class="count-meta-v2">
        <span>Mínimo <strong>${formatNumber(product.minStock)}</strong></span>
        <span>Máximo <strong>${formatNumber(product.maxStock || 0)}</strong></span>
        <span>Unidad <strong>${escapeHtml(product.unitCode || 'UND')}</strong></span>
      </div>

      <label class="count-value-label">
        Existencia física
        <input
          id="countValue"
          class="numeric-input count-input-v2"
          inputmode="decimal"
          autocomplete="off"
          data-product-id="${escapeHtml(product.id)}"
          placeholder="0"
        >
      </label>

      <div class="product-meta count-help">
        Puedes escribir expresiones como 12+3, 24/2, (10+5)*2 o 12,5.
      </div>

      ${mathPad('countValue')}

      <button
        class="primary count-save-button"
        data-action="save-count"
        data-product-id="${escapeHtml(product.id)}"
        type="button"
      >
        Guardar y siguiente · Enter
      </button>
    </article>
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
  const isEntry = type === DOCUMENT_TYPES.ENTRY;

  const totalQuantity = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0),
    0
  );
  const lotCount = lines.filter(line =>
    Boolean(line.lotNumber)
  ).length;
  const expiringCount = lines.filter(line =>
    Boolean(line.expiresAt)
  ).length;

  appRoot.innerHTML = `
    <section class="hero dashboard-hero document-page-head">
      <div>
        <div class="product-meta" style="font-weight:800;color:var(--accent);margin-bottom:5px">
          ${isEntry ? 'Recepción de mercancía' : 'Salida interna'}
        </div>
        <h2>${documentTitle(type)}</h2>
        <p>${isEntry
          ? 'Recepción con cantidades, costo, lote y vencimiento opcionales.'
          : 'Carrito validado contra stock real y FEFO cuando corresponde.'}</p>
      </div>
      <div class="dashboard-sync">
        <span class="badge">Borrador</span>
        <span class="badge">${lines.length} línea(s)</span>
      </div>
    </section>

    <div class="document-workspace-v2">
      <section class="card document-editor-card">
        <div class="section-head">
          <div>
            <h3>${isEntry ? 'Documento de entrada' : 'Surtido'}</h3>
            <p>${escapeHtml(state.activeDocumentId)}</p>
          </div>
          <span class="badge">Local-first</span>
        </div>

        ${linkedReplenishment ? `
          <div class="document-linked-note">
            <strong>Recepción vinculada</strong>
            <span>
              ${linkedReplenishment.method === 'PURCHASE' ? 'Compra' : 'Pedido'} ·
              pendiente ${formatNumber(linkedReplenishment.pendingQuantity)} ·
              ${escapeHtml(linkedReplenishment.productName || linkedReplenishment.productId)}
            </span>
          </div>
        ` : `
          <div class="scanner-search-row document-product-search">
            <label>
              Buscar producto
              <input
                id="productSearch"
                autocomplete="off"
                placeholder="Nombre, SKU, alias o código de barras"
              >
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
            También puedes usar lector USB/Bluetooth y presionar Enter.
          </div>
          <div id="searchResults" class="search-results"></div>
        `}

        ${selected ? `
          <div class="selected-product-v2">
            <div class="selected-product-icon">▣</div>
            <div>
              <strong>${escapeHtml(selected.name)}</strong>
              <small>
                ${selected.sku ? 'SKU ' + escapeHtml(selected.sku) + ' · ' : ''}
                Min ${formatNumber(selected.minStock)} ·
                Max ${formatNumber(selected.maxStock || 0)}
              </small>
            </div>
          </div>

          <label class="document-quantity-label">
            Cantidad
            <input
              id="operationQuantity"
              class="numeric-input document-quantity-input"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
            >
          </label>

          ${mathPad('operationQuantity')}

          ${isEntry ? `
            <div class="document-extra-fields">
              <label>
                Costo unitario opcional
                <input id="unitCost" inputmode="decimal" autocomplete="off">
              </label>
              <label>
                Lote opcional
                <input id="lotNumber" autocomplete="off">
              </label>
              <label>
                Vencimiento opcional
                <input id="expiresAt" type="date">
              </label>
            </div>
          ` : ''}

          <button class="primary document-add-line" data-action="add-line" data-type="${type}" type="button">
            ＋ Agregar al documento
          </button>
        ` : `
          <div class="document-empty-product">
            <div class="document-empty-icon">⌕</div>
            <strong>Selecciona un producto</strong>
            <span>Busca por nombre, SKU o escanea un código.</span>
          </div>
        `}
      </section>

      <aside class="document-summary-column">
        <article class="card">
          <div class="section-head">
            <div>
              <h3>Resumen</h3>
              <p>Validación previa al cierre.</p>
            </div>
          </div>

          <div class="summary-list-v2">
            <div><span>Productos / líneas</span><strong>${lines.length}</strong></div>
            <div><span>Unidades</span><strong>${formatNumber(totalQuantity)}</strong></div>
            ${isEntry ? `
              <div><span>Lotes</span><strong>${lotCount}</strong></div>
              <div><span>Con vencimiento</span><strong>${expiringCount}</strong></div>
            ` : `
              <div><span>Tipo</span><strong>Surtido interno</strong></div>
              <div><span>Stock</span><strong class="status-good">Validación al cerrar</strong></div>
            `}
          </div>

          ${lines.length
            ? `<button class="success document-close-button" data-action="close-document" type="button">
                Cerrar ${isEntry ? 'entrada' : 'surtido'}
              </button>`
            : ''}
        </article>

        <article class="card document-lines-card">
          <div class="section-head">
            <div>
              <h3>Líneas del documento</h3>
              <p>Trabajo guardado localmente.</p>
            </div>
            <span class="badge">${lines.length}</span>
          </div>

          <div class="document-line-list">
            ${lines.length
              ? lines.map(line => `
                <div class="document-line-v2">
                  <div class="document-line-icon">▣</div>
                  <div>
                    <strong>${escapeHtml(line.productName)}</strong>
                    <small>
                      ${line.lotNumber ? 'Lote ' + escapeHtml(line.lotNumber) : 'Sin lote'}
                      ${line.expiresAt ? ' · vence ' + formatShortDate(line.expiresAt) : ''}
                    </small>
                  </div>
                  <span>${formatNumber(line.quantity)}</span>
                </div>
              `).join('')
              : '<div class="empty compact-empty">El documento está vacío.</div>'}
          </div>
        </article>

        ${type === DOCUMENT_TYPES.SUPPLY ? `
          <article class="card saint-card-v2">
            <div class="saint-mark">S</div>
            <div>
              <strong>Preparado para SAINT</strong>
              <p>La integración final enviará descargos EN ESPERA. Nunca se postea automáticamente.</p>
            </div>
            <button class="secondary" type="button" disabled>Fase 26 · pendiente</button>
          </article>
        ` : ''}
      </aside>
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
      case 'edit-product':
        state.editingProductId = button.dataset.productId;
        return render();
      case 'cancel-product-edit':
        state.editingProductId = null;
        return render();
      case 'download-saint-template':
        downloadSaintInitialLoadTemplate();
        showToast('Plantilla SAINT generada');
        return;
      case 'apply-saint-initial-load':
        return applySaintInitialLoadDraft();
      case 'discard-saint-initial-load':
        state.saintInitialLoadDraft = null;
        return render();
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
      case 'install-pwa':
        return installPwa();
      case 'reverse-adjustment':
        return reverseAdjustment(button.dataset.id);
      case 'login-google':
        return signInWithGoogle();
      case 'logout-auth':
        return handleAuthButton();
      case 'select-workspace':
        return chooseWorkspace(button.dataset.workspaceId);
      case 'show-workspace-picker':
        state.workspaceReady = false;
        updateNavigationUi();
        return renderWorkspaceGate();
      case 'correct-document':
        return correctClosedDocument(
          button.dataset.id,
          button.dataset.type
        );
    }
  } catch (error) {
    showToast(error.message || String(error));
  }
}

function exportCurrentReport(format) {
  requireClientPermission(
    'reports.export',
    'No tienes permiso para exportar reportes'
  );

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
    requireClientPermission('catalog.write');

    const form = new FormData(event.target);
    const productId = String(form.get('productId') || '').trim();
    const existingProduct = productId
      ? state.products.find(product => product.id === productId) || null
      : null;
    const payload = buildProductPayloadFromEditor(
      form,
      existingProduct
    );

    if (existingProduct) {
      await updateProduct(existingProduct.id, payload);
      showToast('Producto actualizado');
    } else {
      await createProduct(payload);
      showToast('Producto guardado');
    }

    state.editingProductId = null;
    await refreshProducts();
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

    const preview =
      await readCatalogFile(file);

    const guard =
      analyzeCatalogImportConflicts(
        preview.rows || [],
        state.products || []
      );

    state.importPreview = {
      ...preview,
      errors: [
        ...new Set([
          ...(preview.errors || []),
          ...guard.errors
        ])
      ],
      warnings: [
        ...new Set([
          ...(preview.warnings || []),
          ...guard.warnings
        ])
      ]
    };

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

async function reverseAdjustment(movementId) {
  requireClientPermission('adjustment.write');

  const reason = prompt(
    'Motivo de la compensación del ajuste:',
    'Corrección autorizada'
  );

  if (reason === null) return;
  if (reason.trim().length < 4) {
    throw new Error('Indica un motivo de al menos 4 caracteres');
  }

  if (!confirm('¿Crear un movimiento compensatorio? El original permanecerá intacto.')) {
    return;
  }

  await reverseMovement(movementId, {
    userId: currentOwnerId(),
    reason: reason.trim()
  });

  showToast('Compensación creada');
  scheduleSync(100);
  await render();
}

async function saveMemberRole(userId) {
  requireClientPermission('users.manage');

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
  requireClientPermission('users.manage');

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
  const previousSession = state.session;

  try {
    state.session = await getCurrentSession();
    return state.session;
  } catch (error) {
    if (!silent) {
      state.session = null;
      throw error;
    }

    state.session = previousSession;
    return null;
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, '\\$&');
}

async function applyCatalogPreview() {
  requireClientPermission('catalog.write');

  const preview = state.importPreview;
  if (!preview?.rows?.length) {
    throw new Error('No hay filas válidas para importar');
  }

  if (preview.errors?.length) {
    throw new Error(
      `Corrige los ${preview.errors.length} error(es) antes de importar`
    );
  }

  const message =
    `¿Importar ${preview.rows.length} producto(s)? ` +
    'Los existentes se actualizarán por SKU, código de barras o nombre. La existencia SAINT NO se aplicará todavía.';

  if (!confirm(message)) return;

  const result = await applyCatalogImport(preview);
  await refreshProducts();

  const initialLoadStatus =
    await getLocalSaintInitialLoadStatus();

  const missingInitialStockRows =
    preview.hasInitialStockColumn
      ? preview.rows.filter(
          row =>
            row.saintInitialStock === null ||
            row.saintInitialStock === undefined
        ).length
      : 0;

  const canPrepareInitialLoad =
    !initialLoadStatus &&
    preview.hasInitialStockColumn &&
    missingInitialStockRows === 0;

  state.saintInitialLoadDraft =
    canPrepareInitialLoad
      ? buildSaintInitialLoadDraft(
          preview,
          state.products
        )
      : null;

  state.importPreview = null;

  const baseMessage =
    `Catálogo listo · ${result.created} nuevos · ${result.updated} actualizados`;

  const loadMessage =
    initialLoadStatus
      ? ' · apertura SAINT ya existente'
      : !preview.hasInitialStockColumn
        ? ' · sin columna de existencia'
        : missingInitialStockRows > 0
          ? ` · apertura no preparada: ${missingInitialStockRows} fila(s) sin existencia`
          : ' · existencia inicial preparada';

  showToast(baseMessage + loadMessage);

  scheduleSync(100);
  await render();
}

async function applySaintInitialLoadDraft() {
  requireClientPermission('catalog.write');
  requireClientPermission('adjustment.write');

  const draft = state.saintInitialLoadDraft;
  if (!draft?.rows?.length) {
    throw new Error(
      'No hay una carga inicial SAINT preparada'
    );
  }

  if (!navigator.onLine) {
    throw new Error(
      'La carga inicial requiere conexión al servidor'
    );
  }

  const alreadyApplied =
    await getLocalSaintInitialLoadStatus();

  if (alreadyApplied) {
    state.saintInitialLoadDraft = null;
    throw new Error(
      'La existencia inicial SAINT ya fue aplicada'
    );
  }

  const localMovements =
    await getAll(STORES.MOVEMENTS);

  if (localMovements.length > 0) {
    throw new Error(
      'La carga inicial solo puede aplicarse con el almacén sin movimientos previos'
    );
  }

  if (!confirm(
    '¿APLICAR EXISTENCIA INICIAL SAINT? Esta operación es única: creará un documento de ajuste de apertura y después no podrá repetirse en este almacén.'
  )) {
    return;
  }

  const typedConfirmation = prompt(
    'Confirmación final. Escribe exactamente APLICAR SAINT para continuar.'
  );

  if (
    String(typedConfirmation || '')
      .trim()
      .toUpperCase() !==
    'APLICAR SAINT'
  ) {
    showToast('Carga inicial cancelada');
    return;
  }

  showToast(
    'Sincronizando catálogo antes de la apertura…'
  );

  const catalogSync = await syncAndRefresh({
    renderAfter: false
  });

  if (!catalogSync?.ok) {
    throw catalogSync?.error ||
      new Error(
        'No se pudo sincronizar el catálogo antes de la carga inicial'
      );
  }

  const pending = await getPendingSyncCount();
  if (pending > 0) {
    throw new Error(
      'Todavía existen cambios pendientes de sincronización'
    );
  }

  const syncedStatus =
    await getLocalSaintInitialLoadStatus();

  if (syncedStatus) {
    state.saintInitialLoadDraft = null;
    showToast(
      'La existencia inicial ya estaba aplicada en el servidor'
    );
    return render();
  }

  const syncedMovements =
    await getAll(STORES.MOVEMENTS);

  if (syncedMovements.length > 0) {
    throw new Error(
      'Después de sincronizar aparecieron movimientos previos. La carga inicial quedó bloqueada.'
    );
  }

  await enqueueSaintInitialLoad(draft);

  showToast(
    'Aplicando existencia inicial SAINT…'
  );

  const result = await syncAndRefresh({
    renderAfter: false
  });

  if (!result?.ok) {
    throw result?.error ||
      new Error(
        'No se pudo aplicar la existencia inicial'
      );
  }

  const status =
    await getLocalSaintInitialLoadStatus();

  if (!status) {
    throw new Error(
      'El servidor confirmó la operación pero el documento de apertura no llegó al dispositivo'
    );
  }

  state.saintInitialLoadDraft = null;
  await refreshProducts();

  showToast(
    `Carga inicial aplicada · ${status.positiveStockCount} producto(s) con existencia`
  );

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
  requireClientPermission('purchases.write');

  const requestedQuantity = Number(button.dataset.quantity || 0);
  if (!(requestedQuantity > 0)) {
    throw new Error('La sugerencia no tiene cantidad para reponer');
  }

  await createReplenishment({
    productId: button.dataset.productId,
    method: button.dataset.method,
    requestedQuantity,
    ownerId: currentOwnerId(),
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
  requireClientPermission('purchases.write');

  await changeReplenishmentStatus(id, status, {
    userId: currentOwnerId()
  });

  showToast('Estado actualizado');
  scheduleSync();
  await render();
}

async function startReplenishmentEntry(replenishmentId) {
  requireClientPermission('purchases.write');
  requireClientPermission('entry.write');

  const item = await get(STORES.REPLENISHMENTS, replenishmentId);
  if (!item) throw new Error('Compra/pedido no encontrado');

  if (!(Number(item.pendingQuantity) > 0)) {
    throw new Error('No queda mercancía pendiente por recibir');
  }

  const document = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: currentOwnerId(),
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
  requireClientPermission(
    permissionForDocumentTypeClient(type)
  );

  if (state.products.length === 0) {
    state.view = 'catalog';
    showToast('Primero agrega o importa productos');
    return render();
  }

  if (type === DOCUMENT_TYPES.COUNT) {
    const existingDrafts = await listDraftDocuments({
      ownerId: currentOwnerId(),
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
    ownerId: currentOwnerId()
  });

  state.activeDocumentId = document.id;
  state.activeDocumentType = type;
  state.selectedProductId = null;
  showToast('Borrador creado');
  scheduleSync();
  await render();
}

async function saveCount(productId) {
  requireClientPermission('count.write');

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
  requireClientPermission(
    permissionForDocumentTypeClient(type)
  );

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

async function correctClosedDocument(documentId, type) {
  if (!canCorrectDocument(type)) {
    throw new Error(
      'No tienes permisos suficientes para compensar este documento'
    );
  }

  const reason = prompt(
    'Motivo de la corrección:',
    'Corrección autorizada'
  );

  if (reason === null) return;

  if (reason.trim().length < 4) {
    throw new Error('Indica un motivo de al menos 4 caracteres');
  }

  if (!confirm(
    'Se crearán movimientos compensatorios y un nuevo borrador. El documento original permanecerá intacto. ¿Continuar?'
  )) {
    return;
  }

  const result = await createCorrectionDraft(documentId, {
    userId: currentOwnerId(),
    reason: reason.trim()
  });

  state.view = viewForDocumentType(result.draft.type);
  state.activeDocumentId = result.draft.id;
  state.activeDocumentType = result.draft.type;
  state.selectedProductId = null;

  showToast(
    result.reused
      ? 'Continuando corrección existente'
      : `Corrección creada · ${result.reversals.length} compensación(es)`
  );

  scheduleSync(100);
  await render();
}

function canCorrectDocument(type) {
  if (!can(state.session, 'adjustment.write')) return false;

  const permission = type === DOCUMENT_TYPES.COUNT
    ? 'count.write'
    : type === DOCUMENT_TYPES.ENTRY
      ? 'entry.write'
      : type === DOCUMENT_TYPES.SUPPLY
        ? 'supply.write'
        : null;

  return Boolean(permission && can(state.session, permission));
}

function viewForDocumentType(type) {
  if (type === DOCUMENT_TYPES.COUNT) return 'count';
  if (type === DOCUMENT_TYPES.ENTRY) return 'entry';
  if (type === DOCUMENT_TYPES.SUPPLY) return 'supply';
  return 'home';
}

async function cancelDraft(documentId) {
  if (!confirm('¿Cancelar este borrador? No afectará el inventario y quedará registrado en el historial.')) {
    return;
  }

  await cancelDocument(documentId, { userId: currentOwnerId() });

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
  requireClientPermission(
    permissionForDocumentTypeClient(
      state.activeDocumentType
    )
  );

  const label = documentTitle(state.activeDocumentType).toLowerCase();
  if (!confirm(`¿Cerrar ${label}? Después del cierre ya afecta el inventario.`)) {
    return;
  }

  const result = await closeDocument(state.activeDocumentId, {
    userId: currentOwnerId()
  });

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

function renderSaintInitialLoadCard({
  draft,
  summary,
  status,
  hasMovements
}) {
  if (status) {
    return `
      <section class="card stack saint-initial-load-card">
        <div class="section-head">
          <div>
            <h3>✓ Existencia inicial aplicada</h3>
            <p>Baseline productivo SAINT registrado de forma trazable.</p>
          </div>
          <span class="badge status-good">Cerrado</span>
        </div>

        <div class="catalog-initial-load-grid">
          <div>
            <small>Productos</small>
            <strong>${formatNumber(status.productCount)}</strong>
          </div>
          <div>
            <small>Con existencia</small>
            <strong>${formatNumber(status.positiveStockCount)}</strong>
          </div>
        </div>

        <div class="product-meta">
          Documento ${escapeHtml(status.documentId || '—')} ·
          ${status.appliedAt ? formatDate(status.appliedAt) : 'fecha no disponible'}
        </div>

        <div class="catalog-safety-note">
          Las importaciones futuras de catálogo no pueden sobrescribir este stock.
        </div>
      </section>
    `;
  }

  if (!draft) {
    return `
      <section class="card stack saint-initial-load-card">
        <div class="section-head">
          <div>
            <h3>Existencia inicial SAINT</h3>
            <p>Pendiente de preparar.</p>
          </div>
          <span class="badge status-warning">Pendiente</span>
        </div>

        <div class="product-meta">
          Carga la plantilla/exportación SAINT. Primero se importa el catálogo; después se habilita la apertura de stock una sola vez.
        </div>
      </section>
    `;
  }

  return `
    <section class="card stack saint-initial-load-card">
      <div class="section-head">
        <div>
          <h3>Existencia inicial preparada</h3>
          <p>Revisa antes de crear el movimiento de apertura.</p>
        </div>
        <span class="badge status-warning">Sin aplicar</span>
      </div>

      <div class="catalog-initial-load-grid">
        <div>
          <small>Productos</small>
          <strong>${formatNumber(summary?.productCount || 0)}</strong>
        </div>
        <div>
          <small>Con existencia</small>
          <strong>${formatNumber(summary?.positiveStockCount || 0)}</strong>
        </div>
        <div>
          <small>Existencia 0</small>
          <strong>${formatNumber(summary?.zeroStockCount || 0)}</strong>
        </div>
      </div>

      <div class="saint-opening-preview">
        <strong>Muestra de existencia a aplicar</strong>
        <div class="stack">
          ${draft.rows.slice(0, 8).map(row => `
            <div class="cart-line">
              <div>
                <strong>${escapeHtml(row.name || row.sourceCode || row.productId)}</strong>
                <div class="product-meta">
                  ${row.sourceCode ? 'SAINT ' + escapeHtml(row.sourceCode) + ' · ' : ''}
                  ${row.sourceRow ? 'fila ' + escapeHtml(row.sourceRow) : ''}
                </div>
              </div>
              <span class="badge">
                ${formatNumber(row.quantity)} ${escapeHtml(row.unitCode || 'UND')}
              </span>
            </div>
          `).join('')}
          ${draft.rows.length > 8
            ? `<div class="product-meta">…y ${draft.rows.length - 8} producto(s) más.</div>`
            : ''}
        </div>
      </div>

      ${hasMovements
        ? `
          <div class="status-danger">
            ✕ Este dispositivo ya tiene movimientos. La apertura está bloqueada para evitar mezclar historia previa con la existencia SAINT.
          </div>
        `
        : `
          <div class="status-warning">
            ⚠ Al confirmar se creará un ADJUSTMENT de apertura trazable. Esta operación solo se permite una vez por almacén y requiere escribir “APLICAR SAINT”.
          </div>
        `}

      <div class="row">
        <button
          class="secondary"
          data-action="discard-saint-initial-load"
          type="button"
        >Descartar preparación</button>
        <button
          class="success"
          data-action="apply-saint-initial-load"
          type="button"
          ${hasMovements ? 'disabled' : ''}
        >Aplicar existencia inicial</button>
      </div>
    </section>
  `;
}

function renderCatalogImportPreview(preview) {
  const rows = preview.rows || [];
  const errors = preview.errors || [];
  const warnings = preview.warnings || [];
  const missingInitialStockRows =
    preview.hasInitialStockColumn
      ? rows.filter(
          row =>
            row.saintInitialStock === null ||
            row.saintInitialStock === undefined
        ).length
      : 0;

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
        ${preview.skippedRows
          ? `<span class="badge">${preview.skippedRows} omitidos</span>`
          : ''}
        <span class="badge">${errors.length} errores</span>
        ${preview.hasInitialStockColumn
          ? missingInitialStockRows
            ? `<span class="badge status-warning">Existencia incompleta</span>`
            : `<span class="badge status-good">Existencia SAINT lista</span>`
          : `<span class="badge">Sin existencia SAINT</span>`}
      </div>

      ${warnings.length ? `
        <div class="stack">
          ${warnings.slice(0, 8).map(warning => `
            <div class="status-warning">⚠ ${escapeHtml(warning)}</div>
          `).join('')}
        </div>
      ` : ''}

      ${preview.hasInitialStockColumn && missingInitialStockRows > 0 ? `
        <div class="status-warning">
          ⚠ Hay ${missingInitialStockRows} producto(s) sin Existencia SAINT explícita. El catálogo sí puede importarse, pero la apertura de stock no se preparará hasta que cada fila tenga un valor; escribe 0 cuando corresponda.
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
                    Min ${formatNumber(row.minStock)} ${escapeHtml(row.unitCode)} ·
                    Max ${row.maxStock ? formatNumber(row.maxStock) + ' ' + escapeHtml(row.unitCode) : '—'} ·
                    ${escapeHtml(catalogPresentationSummary(row))}
                    ${row.saintInitialStock !== null && row.saintInitialStock !== undefined
                      ? ' · SAINT ' + formatNumber(row.saintInitialStock) + ' ' + escapeHtml(row.unitCode)
                      : ''}
                    ${row.categoryName ? ' · ' + escapeHtml(row.categoryName) : ''}
                  </div>
                </div>
                <span class="badge">Fila ${row.excelRow}</span>
              </div>
            `).join('')}
          </div>
        </div>

        ${errors.length
          ? `
            <div class="status-danger">
              ✕ Importación bloqueada. Corrige todos los errores del archivo antes de modificar el catálogo.
            </div>
          `
          : `
            <button class="success" data-action="apply-catalog-import" type="button">
              Importar ${rows.length} producto(s)
            </button>
          `}
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

function renderCatalogQuantity(product, quantity) {
  const display = catalogQuantityDisplay(
    product,
    Number(quantity || 0)
  );

  return `
    <span class="catalog-quantity">
      <strong>${escapeHtml(display.baseText)}</strong>
      ${display.humanText
        ? `<small>${escapeHtml(display.humanText)}</small>`
        : ''}
    </span>
  `;
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
    localUserId: currentOwnerId(),
    displayName:
      state.authUser?.displayName ||
      state.authUser?.email ||
      'Usuario local'
  });

  if (
    !result?.ok &&
    state.authMode === 'firebase' &&
    result?.error?.code === 'AUTH_TOKEN_INVALID'
  ) {
    const recovery =
      await recoverFirebaseSessionAfterTokenError();

    if (recovery.recovered) {
      state.authAccessOffline = false;
      scheduleSync(500);
      await refreshSaveStatus();
      return {
        ...result,
        recoveredAuth: true
      };
    }

    if (recovery.confirmedInvalid) {
      lockAuthenticatedUi();
      await logoutFirebase().catch(() => {});
      state.authUser = null;
      updateAuthUi();

      if (renderAfter) {
        renderAuthGate();
      }

      await refreshSaveStatus();
      return result;
    }

    state.authAccessOffline = true;
    await refreshSaveStatus();
    return result;
  }

  if (
    !result?.ok &&
    state.authMode === 'firebase' &&
    result?.error?.code === 'WORKSPACE_ACCESS_DENIED'
  ) {
    lockAuthenticatedUi();

    if (renderAfter) {
      renderAuthGate();
    }

    await refreshSaveStatus();
    return result;
  }

  if (result?.ok) {
    if (state.authMode === 'firebase' && navigator.onLine) {
      const liveSession = await refreshSession({
        silent: true
      });

      if (liveSession) {
        state.authAccessOffline = false;
      }
    }

    if (result.pulled > 0) {
      await refreshProducts();

      const reconciled = await reconcileReplenishmentReceipts();
      if (reconciled.length > 0) scheduleSync(100);

      if (renderAfter && canAutoRefresh()) await render();
    }
  }

  await refreshSaveStatus();
  return result;
}

async function recoverFirebaseSessionAfterTokenError() {
  if (!state.authUser) {
    return {
      recovered: false,
      confirmedInvalid: true
    };
  }

  try {
    await refreshFirebaseToken();

    const liveSession = await getCurrentSession();
    state.session = liveSession;
    state.workspaceReady = Boolean(
      liveSession?.workspaceId
    );

    return {
      recovered: Boolean(liveSession),
      confirmedInvalid: false
    };
  } catch (error) {
    const code = String(error?.code || '');

    const confirmedInvalid = [
      'AUTH_TOKEN_INVALID',
      'AUTH_SESSION_MISSING',
      'auth/user-disabled',
      'auth/user-token-expired',
      'auth/invalid-user-token',
      'auth/user-not-found'
    ].includes(code);

    return {
      recovered: false,
      confirmedInvalid,
      error
    };
  }
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

function readInitialView() {
  try {
    const requested = new URLSearchParams(window.location.search).get('view');
    const allowed = new Set([
      'home',
      'count',
      'supply',
      'entry',
      'replenishment',
      'catalog',
      'reports',
      'alerts',
      'settings',
      'users',
      'audit',
      'conflicts'
    ]);

    return allowed.has(requested) ? requested : 'home';
  } catch (_) {
    return 'home';
  }
}

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPromptEvent = event;

    if (state.view === 'home' && canAutoRefresh()) {
      render().catch(() => {});
    }
  });

  window.addEventListener('appinstalled', () => {
    installPromptEvent = null;
    showToast('Smart Inventory instalado');
  });
}

async function installPwa() {
  if (!installPromptEvent) {
    showToast('La instalación no está disponible en este navegador');
    return;
  }

  const prompt = installPromptEvent;
  installPromptEvent = null;
  await prompt.prompt();
  await prompt.userChoice.catch(() => null);
  await render();
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
