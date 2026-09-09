const BUSINESS_NAME_KEY = 'vigia.procurement.businessName';
const PRINTER_NAME_KEY = 'vigia.thermal.printerName';
const FONT_SIZE_KEY = 'vigia.thermal.fontSizePx';
const LINE_HEIGHT_KEY = 'vigia.thermal.lineHeight';
const PADDING_KEY = 'vigia.thermal.paddingMm';

const DEFAULTS = Object.freeze({
  businessName: 'NOMBRE DEL NEGOCIO',
  printerName: 'CAFETERIA',
  fontSizePx: 10,
  lineHeight: 1.25,
  paddingMm: 2
});

const app = document.getElementById('app');
let timer = null;

applyTicketVariables(readConfig());

if (app) {
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(app, { childList: true, subtree: true });
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  scheduleEnhance();
}

function scheduleEnhance() {
  clearTimeout(timer);
  timer = setTimeout(enhanceSettingsView, 40);
}

function enhanceSettingsView() {
  if (!isSettingsView()) return;

  const grid = app.querySelector('.settings-grid-v2');
  if (!grid || document.getElementById('v6ThermalPrinterSettings')) return;

  const config = readConfig();
  const card = document.createElement('section');
  card.id = 'v6ThermalPrinterSettings';
  card.className = 'card v6t-printer-settings';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <h3>Impresión 80mm</h3>
        <p>Encabezado y calibración de la comandera térmica de este dispositivo.</p>
      </div>
      <span class="badge">80 mm</span>
    </div>

    <form id="v6ThermalPrinterForm" class="v6t-printer-form">
      <label class="v6t-wide">
        Nombre del negocio en el ticket
        <input
          name="businessName"
          value="${esc(config.businessName)}"
          maxlength="80"
          autocomplete="organization"
          placeholder="Ej. MI NEGOCIO"
          required
        >
        <small>Este texto aparece centrado en el encabezado de Compras y Pedidos.</small>
      </label>

      <label class="v6t-wide">
        Impresora compartida / Windows
        <input
          name="printerName"
          value="${esc(config.printerName)}"
          maxlength="80"
          autocomplete="off"
          placeholder="CAFETERIA"
        >
        <small>Referencia para el operador. El navegador abre el diálogo de Windows; no selecciona impresoras silenciosamente.</small>
      </label>

      <label>
        Tamaño base
        <div class="v6t-inline-control">
          <input
            name="fontSizePx"
            type="number"
            min="8"
            max="16"
            step="0.5"
            value="${esc(config.fontSizePx)}"
          >
          <span>px</span>
        </div>
      </label>

      <label>
        Interlineado
        <input
          name="lineHeight"
          type="number"
          min="1"
          max="1.8"
          step="0.05"
          value="${esc(config.lineHeight)}"
        >
      </label>

      <label>
        Margen interno
        <div class="v6t-inline-control">
          <input
            name="paddingMm"
            type="number"
            min="0"
            max="6"
            step="0.5"
            value="${esc(config.paddingMm)}"
          >
          <span>mm</span>
        </div>
      </label>

      <div class="v6t-printer-actions v6t-wide">
        <button class="secondary" type="submit">Guardar configuración</button>
        <button
          class="primary"
          data-v6t-action="print-test"
          type="button"
        >🧾 Imprimir prueba de calibración</button>
      </div>
    </form>

    <div class="v6t-printer-note">
      <strong>Prueba de calibración.</strong>
      Úsala solo cuando cambies impresora o quieras ajustar tipografía, espacios y signos. Imprime, toma una foto del ticket y podremos afinar estos valores.
    </div>
  `;

  const saint = grid.querySelector('.settings-saint-card');
  if (saint) grid.insertBefore(card, saint);
  else grid.appendChild(card);
}

function isSettingsView() {
  const heading = [...(app?.querySelectorAll('h1,h2') || [])]
    .map(node => String(node.textContent || '').trim())
    .find(Boolean);
  return heading === 'Configuración';
}

function handleSubmit(event) {
  if (event.target.id !== 'v6ThermalPrinterForm') return;
  event.preventDefault();

  try {
    const config = saveFromForm(event.target);
    toast(`Impresión 80mm guardada · ${config.printerName || 'impresora de Windows'}`);
  } catch (error) {
    toast(error?.message || String(error));
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-v6t-action]');
  if (!button) return;

  if (button.dataset.v6tAction === 'print-test') {
    try {
      const form = document.getElementById('v6ThermalPrinterForm');
      const config = form ? saveFromForm(form) : readConfig();
      openCalibrationPrint(config);
    } catch (error) {
      toast(error?.message || String(error));
    }
    return;
  }

  if (button.dataset.v6tAction === 'close-test') {
    document.getElementById('v6pPrintModal')?.remove();
  }
}

function saveFromForm(form) {
  const data = new FormData(form);
  const config = normalizeConfig({
    businessName: data.get('businessName'),
    printerName: data.get('printerName'),
    fontSizePx: data.get('fontSizePx'),
    lineHeight: data.get('lineHeight'),
    paddingMm: data.get('paddingMm')
  });

  if (!config.businessName || config.businessName === DEFAULTS.businessName) {
    throw new Error('Escribe el nombre real del negocio para el encabezado del ticket');
  }

  writeStorage(BUSINESS_NAME_KEY, config.businessName);
  writeStorage(PRINTER_NAME_KEY, config.printerName);
  writeStorage(FONT_SIZE_KEY, String(config.fontSizePx));
  writeStorage(LINE_HEIGHT_KEY, String(config.lineHeight));
  writeStorage(PADDING_KEY, String(config.paddingMm));
  applyTicketVariables(config);
  return config;
}

function readConfig() {
  return normalizeConfig({
    businessName: readStorage(BUSINESS_NAME_KEY, DEFAULTS.businessName),
    printerName: readStorage(PRINTER_NAME_KEY, DEFAULTS.printerName),
    fontSizePx: readStorage(FONT_SIZE_KEY, DEFAULTS.fontSizePx),
    lineHeight: readStorage(LINE_HEIGHT_KEY, DEFAULTS.lineHeight),
    paddingMm: readStorage(PADDING_KEY, DEFAULTS.paddingMm)
  });
}

function normalizeConfig(input = {}) {
  return {
    businessName: String(input.businessName || DEFAULTS.businessName).trim().slice(0, 80),
    printerName: String(input.printerName || DEFAULTS.printerName).trim().slice(0, 80),
    fontSizePx: clampNumber(input.fontSizePx, 8, 16, DEFAULTS.fontSizePx),
    lineHeight: clampNumber(input.lineHeight, 1, 1.8, DEFAULTS.lineHeight),
    paddingMm: clampNumber(input.paddingMm, 0, 6, DEFAULTS.paddingMm)
  };
}

function applyTicketVariables(config) {
  const root = document.documentElement;
  if (!root) return;
  root.style.setProperty('--vigia-ticket-font-size', `${config.fontSizePx}px`);
  root.style.setProperty('--vigia-ticket-line-height', String(config.lineHeight));
  root.style.setProperty('--vigia-ticket-padding', `${config.paddingMm}mm`);
}

function openCalibrationPrint(config) {
  document.getElementById('v6pPrintModal')?.remove();

  const host = document.createElement('div');
  host.id = 'v6pPrintModal';
  host.className = 'v6p-backdrop is-open';
  host.innerHTML = `
    <div class="v6p-modal v6p-print-modal">
      <div class="v6p-modal-head">
        <div>
          <div class="v6p-eyebrow">PRUEBA 80MM</div>
          <h3>Calibración de comandera</h3>
          <p>Referencia configurada: ${esc(config.printerName || 'impresora de Windows')}</p>
        </div>
        <button class="v6p-ghost" data-v6t-action="close-test" type="button">Cerrar</button>
      </div>
      <div class="v6p-modal-body">
        <div class="v6t-test-warning">
          Se abrirá el cuadro de impresión de Windows. Selecciona <strong>${esc(config.printerName || 'tu comandera')}</strong> y usa escala 100%, sin encabezados ni pies del navegador.
        </div>
        <div class="v6p-ticket-preview">
          ${renderCalibrationTicket(config)}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(host);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => window.print(), 80);
    });
  });
}

function renderCalibrationTicket(config) {
  const now = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date());

  return `
    <section class="v6p-ticket v6t-calibration-ticket">
      <header class="v6p-ticket-head">
        <small>VIGÍA · Inventory Intelligence</small>
        <strong>${esc(config.businessName)}</strong>
        <b>PRUEBA DE IMPRESIÓN 80MM</b>
        <span>CALIBRACIÓN</span>
      </header>

      <div class="v6p-ticket-meta">
        <div><b>Fecha:</b> ${esc(now)}</div>
        <div><b>Impresora:</b> ${esc(config.printerName || 'Windows')}</div>
        <div><b>Ajuste:</b> ${esc(config.fontSizePx)}px · LH ${esc(config.lineHeight)} · ${esc(config.paddingMm)}mm</div>
      </div>

      <div class="v6p-ticket-rule"></div>
      <div class="v6t-ruler">1234567890123456789012345678901234567890</div>
      <div class="v6t-symbols">ÁÉÍÓÚ Ñ ñ / - + ( ) [ ] # * % &amp;</div>
      <div class="v6p-ticket-rule"></div>

      <div class="v6p-ticket-legend"><span>PRODUCTO</span><span>CANT.</span><span>OK</span></div>

      <section class="v6p-ticket-category">
        <h4>VÍVERES</h4>
        ${testRow('MAYONESA KRAFT SACHETS', '1 CJ')}
        ${testRow('PRODUCTO CON NOMBRE MUY LARGO PARA PROBAR SALTO DE LÍNEA', '2 BUL')}
      </section>

      <section class="v6p-ticket-category">
        <h4>HORTALIZAS</h4>
        ${testRow('AGUACATE', '30 KG', 'verdes para guasacaca')}
      </section>

      <section class="v6p-ticket-category">
        <h4>BEBIDAS</h4>
        ${testRow('REFRESCO DE LATA 355ML DIETA Y ZERO', '4 CJ')}
      </section>

      <section class="v6p-ticket-category">
        <h4>EXTRAS</h4>
        ${testRow('TEIPE ELÉCTRICO NEGRO', '3 UND', 'EXTRA · prueba de observación')}
      </section>

      <div class="v6p-ticket-notes"><b>Observaciones:</b><i></i><i></i></div>
      <div class="v6p-ticket-rule is-solid"></div>
      <footer>PRUEBA VIGÍA 80MM<br>Firma: __________________</footer>
    </section>
  `;
}

function testRow(name, quantity, note = '') {
  return `
    <div class="v6p-ticket-row">
      <div><strong>${esc(name)}</strong>${note ? `<span>(${esc(note)})</span>` : ''}</div>
      <b>${esc(quantity)}</b>
      <i></i>
    </div>
  `;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    throw new Error('El navegador no permitió guardar la configuración de impresión');
  }
}

function toast(message) {
  const save = document.getElementById('saveStatus');
  if (save) save.textContent = String(message || 'Listo');

  const node = document.createElement('div');
  node.className = 'v6p-toast';
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
