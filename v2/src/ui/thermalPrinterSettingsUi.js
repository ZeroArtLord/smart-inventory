import {
  getThermalPrinterConfig,
  saveThermalPrinterConfig,
  testThermalPrinterConnection,
  printThermalCalibration
} from '../printing/thermalPrinterClient.js';

const BUSINESS_NAME_KEY = 'vigia.procurement.businessName';
const app = document.getElementById('app');
let timer = null;
let loading = false;
let cachedConfig = null;

if (app) {
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(app, { childList: true, subtree: true });
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  scheduleEnhance();
}

function scheduleEnhance() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    enhanceSettingsView().catch(reportError);
  }, 50);
}

async function enhanceSettingsView() {
  if (!isSettingsView() || loading) return;

  const grid = app.querySelector('.settings-grid-v2');
  if (
    !grid ||
    document.getElementById('v6ThermalPrinterSettings')
  ) {
    return;
  }

  loading = true;

  try {
    const config =
      cachedConfig ||
      await getThermalPrinterConfig();

    cachedConfig = config;
    renderCard(grid, config);
  } catch (error) {
    renderUnavailableCard(grid, error);
  } finally {
    loading = false;
  }
}

function renderCard(grid, config) {
  const card = document.createElement('section');
  card.id = 'v6ThermalPrinterSettings';
  card.className = 'card v6t-printer-settings';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <h3>Impresión 80mm</h3>
        <p>
          RC-8002 por TCP/IP directo. VIGÍA habla ESC/POS y no usa
          el driver Generic / Text Only.
        </p>
      </div>
      <span class="badge status-good">
        ESC/POS directo · 80mm
      </span>
    </div>

    <form id="v6ThermalPrinterForm" class="v6t-printer-form">
      <label class="v6t-wide">
        Nombre del negocio en el ticket
        <input
          name="businessName"
          value="${esc(config.businessName)}"
          maxlength="80"
          autocomplete="organization"
          required
        >
        <small>
          Encabezado central para Compras, Pedidos y la prueba de calibración.
        </small>
      </label>

      <label class="v6t-wide">
        Referencia de la comandera
        <input
          name="printerName"
          value="${esc(config.printerName)}"
          maxlength="80"
          autocomplete="off"
          placeholder="CAFETERIA · RC-8002"
        >
        <small>
          Solo es una etiqueta visible. La impresión real usa la IP y el puerto RAW.
        </small>
      </label>

      <label>
        IP de la comandera
        <input
          name="host"
          value="${esc(config.host)}"
          inputmode="numeric"
          autocomplete="off"
          placeholder="192.168.1.165"
          required
        >
      </label>

      <label>
        Puerto RAW
        <input
          name="port"
          type="number"
          min="1"
          max="65535"
          step="1"
          value="${esc(config.port)}"
          required
        >
        <small>RC-8002 reportó 9100 en su self-test.</small>
      </label>

      <label>
        Caracteres por línea
        <input
          name="charsPerLine"
          type="number"
          min="38"
          max="48"
          step="1"
          value="${esc(config.charsPerLine)}"
        >
        <small>Calibrado actualmente en 44.</small>
      </label>

      <label>
        Margen izquierdo
        <div class="v6t-inline-control">
          <input
            name="leftMarginDots"
            type="number"
            min="0"
            max="72"
            step="1"
            value="${esc(config.leftMarginDots)}"
          >
          <span>dots</span>
        </div>
        <small>24 dots ≈ 3 mm en 203 dpi.</small>
      </label>

      <label>
        Ancho útil
        <div class="v6t-inline-control">
          <input
            name="printWidthDots"
            type="number"
            min="400"
            max="576"
            step="1"
            value="${esc(config.printWidthDots)}"
          >
          <span>dots</span>
        </div>
        <small>528 dots deja aire a ambos lados del papel.</small>
      </label>

      <label>
        Interlineado ESC/POS
        <div class="v6t-inline-control">
          <input
            name="lineSpacingDots"
            type="number"
            min="24"
            max="40"
            step="1"
            value="${esc(config.lineSpacingDots)}"
          >
          <span>dots</span>
        </div>
      </label>

      <label>
        Papel antes del corte
        <div class="v6t-inline-control">
          <input
            name="feedLines"
            type="number"
            min="3"
            max="12"
            step="1"
            value="${esc(config.feedLines)}"
          >
          <span>líneas</span>
        </div>
        <small>6 líneas protegen Firma de la cuchilla.</small>
      </label>

      <div class="v6t-printer-actions v6t-wide">
        <button
          class="secondary"
          data-v6t-action="connection-test"
          type="button"
        >Probar conexión</button>

        <button class="secondary" type="submit">
          Guardar configuración
        </button>

        <button
          class="primary"
          data-v6t-action="print-test"
          type="button"
        >🧾 Imprimir prueba de calibración</button>
      </div>
    </form>

    <div class="v6t-printer-note">
      <strong>Formato calibrado con la RC-8002 real.</strong>
      Encabezado centrado, columnas PRODUCTO / CANT. / OK, categorías entre líneas,
      observación pequeña por producto, margen de 24 dots, ancho útil de 528 dots
      y corte automático. El botón de prueba vive solo aquí porque no forma parte
      del trabajo diario.
    </div>
  `;

  const saint = grid.querySelector('.settings-saint-card');
  if (saint) grid.insertBefore(card, saint);
  else grid.appendChild(card);
}

function renderUnavailableCard(grid, error) {
  const card = document.createElement('section');
  card.id = 'v6ThermalPrinterSettings';
  card.className = 'card v6t-printer-settings';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <h3>Impresión 80mm</h3>
        <p>Configuración central de la comandera térmica.</p>
      </div>
      <span class="badge status-warning">No disponible</span>
    </div>
    <div class="status-warning">
      ${esc(
        error?.message ||
        'No se pudo leer la configuración térmica del servidor.'
      )}
    </div>
  `;
  grid.appendChild(card);
}

function isSettingsView() {
  return [...(app?.querySelectorAll('h1,h2') || [])]
    .some(
      node =>
        String(node.textContent || '').trim() ===
        'Configuración'
    );
}

async function handleSubmit(event) {
  if (event.target.id !== 'v6ThermalPrinterForm') return;
  event.preventDefault();

  try {
    setBusy(true);
    const config = await saveForm(event.target);
    toast(
      `Comandera guardada · ${config.host}:${config.port}`
    );
  } catch (error) {
    reportError(error);
  } finally {
    setBusy(false);
  }
}

async function handleClick(event) {
  const button = event.target.closest('[data-v6t-action]');
  if (!button) return;

  try {
    if (
      button.dataset.v6tAction ===
      'connection-test'
    ) {
      setBusy(true);
      const form = document.getElementById(
        'v6ThermalPrinterForm'
      );
      if (form) await saveForm(form);

      const result =
        await testThermalPrinterConnection();

      toast(
        `Conexión OK · ${result.printer.host}:${result.printer.port}`
      );
      return;
    }

    if (button.dataset.v6tAction === 'print-test') {
      setBusy(true);
      const form = document.getElementById(
        'v6ThermalPrinterForm'
      );
      if (form) await saveForm(form);

      const result = await printThermalCalibration();
      toast(
        `Prueba enviada · ${result.bytes} bytes · corte automático`
      );
    }
  } catch (error) {
    reportError(error);
  } finally {
    setBusy(false);
  }
}

async function saveForm(form) {
  const data = new FormData(form);
  const config = await saveThermalPrinterConfig({
    businessName: data.get('businessName'),
    printerName: data.get('printerName'),
    host: data.get('host'),
    port: Number(data.get('port')),
    charsPerLine: Number(data.get('charsPerLine')),
    leftMarginDots: Number(data.get('leftMarginDots')),
    printWidthDots: Number(data.get('printWidthDots')),
    lineSpacingDots: Number(data.get('lineSpacingDots')),
    feedLines: Number(data.get('feedLines')),
    cut: true
  });

  cachedConfig = config;

  try {
    localStorage.setItem(
      BUSINESS_NAME_KEY,
      config.businessName
    );
  } catch (_) {}

  return config;
}

function setBusy(busy) {
  document
    .querySelectorAll('#v6ThermalPrinterSettings button')
    .forEach(button => {
      button.disabled = Boolean(busy);
    });
}

function reportError(error) {
  console.error(error);
  toast(error?.message || String(error));
}

function toast(message) {
  const save = document.getElementById('saveStatus');
  if (save) save.textContent = String(message || 'Listo');

  const node = document.createElement('div');
  node.className = 'v6p-toast';
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3000);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
