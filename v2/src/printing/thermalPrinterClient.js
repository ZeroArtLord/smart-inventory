import { apiRequest } from '../api/apiClient.js';
import {
  procurementCategoryOf,
  procurementDisplayQuantity
} from '../replenishment/procurementListService.js';
import { isProcurementExtra } from '../replenishment/warehouseProcurementService.js';

export async function getThermalPrinterConfig() {
  const data = await apiRequest('/api/v1/thermal-printer/config');
  return data.config;
}

export async function saveThermalPrinterConfig(config) {
  const data = await apiRequest('/api/v1/thermal-printer/config', {
    method: 'PUT',
    body: config
  });
  return data.config;
}

export async function testThermalPrinterConnection() {
  return apiRequest('/api/v1/thermal-printer/connection-test', {
    method: 'POST',
    body: {}
  });
}

export async function printThermalCalibration() {
  return apiRequest('/api/v1/thermal-printer/test', {
    method: 'POST',
    body: {}
  });
}

export async function printThermalProcurementList(list) {
  const payload = buildThermalPrintPayload(list);
  return apiRequest('/api/v1/thermal-printer/ticket', {
    method: 'POST',
    body: { list: payload }
  });
}

export function buildThermalPrintPayload(list = {}) {
  const items = (Array.isArray(list.items) ? list.items : [])
    .filter(
      item =>
        String(item?.status || '').toUpperCase() !== 'CANCELLED'
    )
    .map(item => {
      const display = procurementDisplayQuantity(item);

      return {
        status: item.status || null,
        name: item.productName || item.productId || 'Producto',
        quantityText:
          `${formatNumber(display.quantity)} ${shortUnit(display.unit)}`,
        category: procurementCategoryOf(item),
        note: item.notes || '',
        extra: isProcurementExtra(item)
      };
    });

  return {
    id: list.id || '',
    code: list.code || list.id || 'LISTA',
    kind: list.kind === 'ORDER' ? 'ORDER' : 'PURCHASE',
    dateLabel: list.dateLabel || formatDate(list.createdAt),
    ownerLabel: list.ownerLabel || 'Usuario VIGÍA',
    items
  };
}

function shortUnit(unit) {
  const value = String(unit || 'UND').toUpperCase();

  return ({
    CAJA: 'CJ',
    CAJAS: 'CJ',
    BULTO: 'BUL',
    BULTOS: 'BUL',
    PAQUETE: 'PAQ',
    PAQUETES: 'PAQ',
    UNIDAD: 'UND',
    UNIDADES: 'UND'
  })[value] || value;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';

  return Number.isInteger(number)
    ? String(number)
    : new Intl.NumberFormat('es-VE', {
        maximumFractionDigits: 3
      }).format(number);
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
