import {
  STORES,
  openDatabase,
  getAll
} from '../storage/database.js';
import {
  calculatePendingInboundByProduct
} from '../replenishment/replenishmentService.js';
import {
  buildInventoryReport
} from '../reporting/reportingEngine.js';

let observer = null;
let timer = null;
let running = false;

document.addEventListener('DOMContentLoaded', () => {
  initializeVigiaIntelligenceUi().catch(error => {
    console.warn(
      'VIGÍA Intelligence UI no disponible:',
      error
    );
  });
});

async function initializeVigiaIntelligenceUi() {
  await openDatabase();

  const app = document.getElementById('app');
  if (!app) return;

  observer = new MutationObserver(scheduleEnhancement);
  observer.observe(app, {
    childList: true,
    subtree: true
  });

  scheduleEnhancement();
}

function scheduleEnhancement() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    enhanceCurrentView().catch(error => {
      console.warn(
        'No se pudo enriquecer la vista con VIGÍA Intelligence:',
        error
      );
    });
  }, 120);
}

async function enhanceCurrentView() {
  if (running) return;

  const app = document.getElementById('app');
  if (!app) return;

  const view = detectView(app);
  if (!view) return;

  if (
    app.querySelector(
      `[data-vigia-intelligence-panel="${view}"]`
    )
  ) {
    return;
  }

  running = true;

  try {
    const rows = await loadIntelligenceRows();

    if (detectView(app) !== view) return;

    if (view === 'replenishment') {
      renderReplenishmentIntelligence(app, rows);
      return;
    }

    if (view === 'reports') {
      renderReportIntelligence(app, rows);
      return;
    }

    if (view === 'home') {
      renderHomeIntelligence(app, rows);
    }
  } finally {
    running = false;
  }
}

function detectView(app) {
  const heading = [...app.querySelectorAll('h1,h2')]
    .map(node => node.textContent?.trim())
    .filter(Boolean);

  if (heading.includes('Comprar / Pedir')) {
    return 'replenishment';
  }

  if (heading.includes('Reportes')) {
    return 'reports';
  }

  if (heading.includes('Dashboard')) {
    return 'home';
  }

  return null;
}

async function loadIntelligenceRows() {
  const [products, movements, replenishments] =
    await Promise.all([
      getAll(STORES.PRODUCTS),
      getAll(STORES.MOVEMENTS),
      getAll(STORES.REPLENISHMENTS)
    ]);

  const pendingInboundByProduct =
    calculatePendingInboundByProduct(
      replenishments
    );

  return buildInventoryReport(
    products,
    movements,
    {
      now: new Date(),
      pendingInboundByProduct
    }
  );
}

function renderReplenishmentIntelligence(app, rows) {
  const actionable = rows.filter(
    row => Number(row.suggestedQuantity || 0) > 0
  );

  const panel = document.createElement('section');
  panel.className = 'card stack';
  panel.dataset.vigiaIntelligencePanel =
    'replenishment';

  panel.innerHTML = `
    <div class="section-head">
      <div>
        <div class="product-meta" style="font-weight:800">
          VIGÍA · Inventory Intelligence
        </div>
        <h3 style="margin:4px 0 0">Por qué VIGÍA recomienda reponer</h3>
        <p>
          Demanda aprendida, tendencia, temporada, cobertura,
          límites manuales y mercancía en tránsito.
        </p>
      </div>
      <span class="badge">
        ${actionable.length} recomendación(es)
      </span>
    </div>

    <div class="stack">
      ${actionable.length
        ? actionable
          .slice(0, 20)
          .map(renderIntelligenceCard)
          .join('')
        : `
          <div class="empty compact-empty">
            No hay reposiciones sugeridas por VIGÍA.
          </div>
        `}
    </div>

    ${actionable.length > 20
      ? `
        <div class="product-meta">
          Se muestran 20 de ${actionable.length} recomendaciones.
        </div>
      `
      : ''}
  `;

  const layout = app.querySelector(
    '.replenish-layout-v2'
  );

  if (layout) {
    layout.insertAdjacentElement(
      'beforebegin',
      panel
    );
  }
}

function renderReportIntelligence(app, rows) {
  const learned = rows.filter(
    row => row.dynamicReady
  );
  const seasonal = rows.filter(
    row =>
      Number(row.seasonalityAppliedFactor || 1) !== 1
  );
  const protectedRows = rows.filter(
    row => Number(row.anomalyCount || 0) > 0
  );
  const attention = rows
    .filter(
      row =>
        Number(row.suggestedQuantity || 0) > 0 ||
        row.warningCodes?.length
    )
    .slice(0, 8);

  const panel = document.createElement('section');
  panel.className = 'card stack';
  panel.dataset.vigiaIntelligencePanel = 'reports';

  panel.innerHTML = `
    <div class="section-head">
      <div>
        <div class="product-meta" style="font-weight:800">
          VIGÍA Intelligence V4
        </div>
        <h3 style="margin:4px 0 0">Estado del aprendizaje</h3>
        <p>
          El stock sigue naciendo de movimientos; esta capa solo
          interpreta y recomienda.
        </p>
      </div>
      <span class="badge status-good">Solo lectura</span>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      ${metric(
        learned.length,
        'Con demanda aprendida',
        'forecast activo'
      )}
      ${metric(
        seasonal.length,
        'Con ajuste estacional',
        'época aplicada'
      )}
      ${metric(
        protectedRows.length,
        'Protegidos de anomalías',
        'sin reescribir historia'
      )}
      ${metric(
        rows.filter(row =>
          row.intelligenceConfidence === 'HIGH'
        ).length,
        'Confianza alta',
        'historial suficiente'
      )}
    </div>

    ${attention.length
      ? `
        <div class="stack">
          ${attention.map(renderCompactIntelligenceRow).join('')}
        </div>
      `
      : `
        <div class="empty compact-empty">
          No hay productos que requieran explicación adicional.
        </div>
      `}
  `;

  const table = app.querySelector(
    '.report-inventory-card'
  );

  if (table) {
    table.insertAdjacentElement(
      'beforebegin',
      panel
    );
  }
}

function renderHomeIntelligence(app, rows) {
  const learned = rows.filter(
    row => row.dynamicReady
  ).length;
  const needsAction = rows.filter(
    row => Number(row.suggestedQuantity || 0) > 0
  ).length;

  if (!rows.length) return;

  const panel = document.createElement('section');
  panel.className = 'card';
  panel.dataset.vigiaIntelligencePanel = 'home';

  panel.innerHTML = `
    <div class="section-head" style="margin-bottom:0">
      <div>
        <div class="product-meta" style="font-weight:800">
          VIGÍA Intelligence V4
        </div>
        <strong>
          ${learned} de ${rows.length} producto(s) ya tienen
          demanda aprendida
        </strong>
        <div class="product-meta">
          ${needsAction}
          requieren reposición según el objetivo dinámico actual.
        </div>
      </div>
      <span class="badge">
        Modelo ${escapeHtml(
          firstModelVersion(rows)
        )}
      </span>
    </div>
  `;

  const detailGrid = app.querySelector(
    '.dashboard-detail-grid'
  );

  if (detailGrid) {
    detailGrid.insertAdjacentElement(
      'beforebegin',
      panel
    );
  }
}

function renderIntelligenceCard(row) {
  const explanation =
    row.intelligenceExplanation || {};
  const warnings =
    explanation.warnings || [];
  const reasons =
    explanation.reasons || [];

  return `
    <article
      class="card"
      style="box-shadow:none;border-style:dashed"
    >
      <div class="section-head">
        <div>
          <strong>${escapeHtml(row.name)}</strong>
          <div class="product-meta">
            ${escapeHtml(
              explanation.modeLabel ||
              row.intelligenceMode ||
              'SEMILLA'
            )}
            · confianza
            ${escapeHtml(
              explanation.confidenceLabel ||
              row.intelligenceConfidence ||
              '—'
            )}
          </div>
        </div>

        <div style="text-align:right">
          <small class="product-meta">Reponer</small>
          <strong style="display:block;font-size:1.25rem">
            ${numberText(row.suggestedQuantity)}
          </strong>
        </div>
      </div>

      <div
        class="grid"
        style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px"
      >
        ${miniStat('Stock', row.stock)}
        ${miniStat('En camino', row.pendingInbound)}
        ${miniStat('Objetivo VIGÍA', row.vigiaTargetStock)}
        ${miniStat('Consumo/sem', row.forecastWeekly)}
        ${miniStat(
          'Mín. manual',
          row.minStock
        )}
        ${miniStat(
          'Máx. manual',
          Number(row.maxStock || 0) > 0
            ? row.maxStock
            : '—',
          true
        )}
      </div>

      <div class="product-meta">
        ${escapeHtml(
          explanation.trendLabel ||
          'Sin tendencia confiable'
        )}
        ·
        ${escapeHtml(
          explanation.seasonalityLabel ||
          'Sin patrón anual aplicado'
        )}
      </div>

      <details>
        <summary>
          <strong>Ver explicación de la recomendación</strong>
        </summary>

        <div class="stack" style="margin-top:10px">
          ${reasons.map(reason => `
            <div class="product-meta">
              • ${escapeHtml(reason)}
            </div>
          `).join('')}

          ${warnings.map(warning => `
            <div class="status-warning">
              ⚠ ${escapeHtml(warning)}
            </div>
          `).join('')}
        </div>
      </details>
    </article>
  `;
}

function renderCompactIntelligenceRow(row) {
  const explanation =
    row.intelligenceExplanation || {};

  return `
    <div class="dashboard-list-row">
      <div>
        <strong>${escapeHtml(row.name)}</strong>
        <div class="product-meta">
          Objetivo ${numberText(row.vigiaTargetStock)}
          · consumo ${numberText(row.forecastWeekly)}/sem
          · ${escapeHtml(
            explanation.trendLabel ||
            'sin tendencia'
          )}
        </div>
      </div>
      <div class="dashboard-list-end">
        <strong>
          ${numberText(row.suggestedQuantity)}
        </strong>
        <small>
          ${escapeHtml(
            explanation.confidenceLabel ||
            row.intelligenceConfidence ||
            '—'
          )}
        </small>
      </div>
    </div>
  `;
}

function metric(value, label, detail) {
  return `
    <div class="card" style="box-shadow:none">
      <strong style="font-size:1.3rem">
        ${numberText(value)}
      </strong>
      <div>${escapeHtml(label)}</div>
      <div class="product-meta">
        ${escapeHtml(detail)}
      </div>
    </div>
  `;
}

function miniStat(label, value, literal = false) {
  return `
    <div
      style="border:1px solid var(--border);border-radius:10px;padding:8px"
    >
      <small class="product-meta">
        ${escapeHtml(label)}
      </small>
      <strong style="display:block">
        ${literal
          ? escapeHtml(value)
          : numberText(value)}
      </strong>
    </div>
  `;
}

function firstModelVersion(rows) {
  return rows.find(
    row => row.modelVersion
  )?.modelVersion || 'V4';
}

function numberText(value) {
  if (value === '—') return '—';

  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';

  return new Intl.NumberFormat('es', {
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
